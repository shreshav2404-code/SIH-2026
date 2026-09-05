"""Regulation-as-Code.

Two steps on purpose. MiniLM retrieval finds the relevant clauses cheaply here;
the on-device model extracts the structured duty in the app, reasoning only over
text we handed it. There is NO LLM in this file — the backend does no LLM work.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Obligation, Statute, User
from schemas import (
    ClauseMatch,
    DutiesIn,
    DutiesOut,
    ObligationOut,
    RetrieveChunk,
    RetrieveIn,
    RetrieveOut,
)
from services import embeddings

router = APIRouter(prefix="/rulebook", tags=["rulebook"])

MAX_CHUNKS = 6


@router.post("/retrieve", response_model=RetrieveOut)
def retrieve(
    body: RetrieveIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RetrieveOut:
    """Ground the model. Retrieve first, pass the clause in, require the
    citation back."""
    if not embeddings.corpus_is_embedded(db):
        raise HTTPException(
            status_code=503,
            detail=(
                "clause corpus is not embedded yet — run "
                "`python api/seed/seed.py --reset` once the ML stack is installed"
            ),
        )

    chunks = embeddings.chunk(body.text)[:MAX_CHUNKS]
    if not chunks:
        return RetrieveOut(chunks=[])

    vectors = embeddings.encode(chunks)

    out = []
    for chunk_text, vec in zip(chunks, vectors, strict=True):
        matches = [
            ClauseMatch(
                statute_id=st.id,
                clause_ref=st.clause_ref,
                act=st.act,
                text=st.text,
                similarity=round(sim, 4),
            )
            for st, sim in embeddings.nearest(db, vec, k=body.k)
        ]
        out.append(RetrieveChunk(query_chunk=chunk_text, matches=matches))

    return RetrieveOut(chunks=out)


@router.post("/duties", response_model=DutiesOut, status_code=201)
def store_duties(
    body: DutiesIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> DutiesOut:
    """Store what the on-device model extracted.

    A duty with no clause_ref is REJECTED. That rule is the answer to the
    liability question, so it lives in code, not in a promise. An answer with
    no citation is rejected by the system.
    """
    mine = resolve_mine_id(user, body.mine_id)

    created: list[ObligationOut] = []
    rejected: list[dict] = []

    for i, duty in enumerate(body.duties):
        ref = (duty.clause_ref or "").strip()
        if not ref:
            rejected.append(
                {"index": i, "title": duty.title, "reason": "CITATION_REQUIRED"}
            )
            continue

        statute = db.scalar(
            select(Statute).where(Statute.clause_ref == ref).limit(1)
        )
        if not statute:
            # Cited something not in the corpus — a hallucinated regulation
            # number is exactly what this check exists to catch.
            rejected.append(
                {
                    "index": i,
                    "title": duty.title,
                    "clause_ref": ref,
                    "reason": "CLAUSE_NOT_IN_CORPUS",
                }
            )
            continue

        ob = Obligation(
            statute_id=statute.id,
            mine_id=mine,
            title=duty.title,
            owner_role=duty.owner_role,
            frequency=duty.frequency,
            evidence_type=duty.evidence_type,
            status="pending",
        )
        db.add(ob)
        db.flush()

        created.append(
            ObligationOut(
                id=ob.id,
                mine_id=ob.mine_id,
                title=ob.title,
                clause_ref=statute.clause_ref,
                act=statute.act,
                owner_role=ob.owner_role,
                frequency=ob.frequency,
                evidence_type=ob.evidence_type,
                due_date=ob.due_date,
                status=ob.status,
            )
        )

    db.commit()
    return DutiesOut(created=created, rejected=rejected)


@router.get("/statutes")
def list_statutes(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict]:
    """The clause corpus, for pickers.

    Text is deliberately omitted - this feeds a dropdown, and shipping 50 full
    clause bodies to render 50 <option> labels is bandwidth spent on nothing.
    Fetch the clause itself from /rulebook/retrieve when it is actually read.
    """
    rows = db.scalars(select(Statute).order_by(Statute.act, Statute.clause_ref)).all()
    return [
        {"id": r.id, "act": r.act, "clause_ref": r.clause_ref, "title": r.title}
        for r in rows
    ]
