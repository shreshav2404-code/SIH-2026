"""Turn the compliance ledger into training data, and track runs against it.

WHAT THIS DOES AND DOES NOT DO. It builds a dataset from the mine's own
records and keeps a register of fine-tuning runs. It does NOT train anything.
Training a 1.7B model needs a GPU; the intended route is free Colab, and the
laptop running Postgres and a dev server is not going to do it. A job here is
prepared, then advanced by whoever actually ran it.

That division is deliberate. A dashboard button claiming to fine-tune a model,
which then does nothing observable, is worse than no button at all.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Evidence, FineTuneJob, Obligation, Statute, User

router = APIRouter(prefix="/finetune", tags=["finetune"])


DATASET_KINDS = {"duties", "observations"}


def _duty_examples(db: Session, mine_id: int) -> list[dict]:
    """Clause text in, structured duty out.

    This is exactly the task the app performs live in Regulation-as-Code, so
    the training pairs match the inference prompt shape. Anything else teaches
    the model a job it will never be asked to do.
    """
    rows = db.execute(
        select(Obligation, Statute)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Obligation.mine_id == mine_id)
    ).all()

    out = []
    for o, s in rows:
        if not (s.text and s.clause_ref):
            continue
        out.append(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Extract the statutory duty from the clause. Reply with "
                            "JSON only. clause_ref must be copied exactly from the "
                            "clause; never invent one."
                        ),
                    },
                    {"role": "user", "content": s.text},
                    {
                        "role": "assistant",
                        "content": json.dumps(
                            {
                                "title": o.title,
                                "owner_role": o.owner_role,
                                "frequency": o.frequency,
                                "evidence_type": o.evidence_type,
                                "clause_ref": s.clause_ref,
                            },
                            ensure_ascii=False,
                        ),
                    },
                ]
            }
        )
    return out


def _observation_examples(db: Session, mine_id: int) -> list[dict]:
    """Field observations written by officers, paired with the duty they cite.

    Smaller and slower-growing than the duty set, and the more valuable of the
    two: it is the only place the model can learn how THIS organisation words
    an inspection note.
    """
    rows = db.execute(
        select(Evidence, Obligation, Statute)
        .join(Obligation, Obligation.id == Evidence.obligation_id)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Evidence.mine_id == mine_id, Evidence.observation.isnot(None))
    ).all()

    out = []
    for e, o, s in rows:
        text = (e.observation or "").strip()
        if len(text) < 10:
            continue
        out.append(
            {
                "messages": [
                    {
                        "role": "system",
                        "content": (
                            "Write one factual inspection observation for the duty "
                            "below, under 40 words, third person, ending with the "
                            "clause reference."
                        ),
                    },
                    {
                        "role": "user",
                        "content": f"{o.title} [{s.clause_ref}]",
                    },
                    {"role": "assistant", "content": text},
                ]
            }
        )
    return out


def _build(db: Session, mine_id: int, kind: str) -> list[dict]:
    if kind == "duties":
        return _duty_examples(db, mine_id)
    if kind == "observations":
        return _observation_examples(db, mine_id)
    raise HTTPException(status_code=400, detail=f"unknown dataset kind: {kind}")


@router.get("/preview")
def preview(
    kind: str = "duties",
    mine_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """How many examples exist, and one of them, before anyone downloads."""
    if kind not in DATASET_KINDS:
        raise HTTPException(status_code=400, detail=f"unknown dataset kind: {kind}")
    scoped = resolve_mine_id(user, mine_id)
    rows = _build(db, scoped, kind)
    return {
        "kind": kind,
        "examples": len(rows),
        "sample": rows[0] if rows else None,
    }


@router.get("/dataset", response_class=PlainTextResponse)
def dataset(
    kind: str = "duties",
    mine_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> PlainTextResponse:
    """JSONL, one training example per line.

    JSONL rather than a bespoke format because every trainer worth using -
    Unsloth, axolotl, TRL - reads it directly, so this file needs no conversion
    step that could silently corrupt it.
    """
    if kind not in DATASET_KINDS:
        raise HTTPException(status_code=400, detail=f"unknown dataset kind: {kind}")
    scoped = resolve_mine_id(user, mine_id)
    rows = _build(db, scoped, kind)
    body = "\n".join(json.dumps(r, ensure_ascii=False) for r in rows)
    return PlainTextResponse(
        body,
        media_type="application/x-ndjson",
        headers={
            "Content-Disposition": f'attachment; filename="anupalan-{kind}.jsonl"'
        },
    )


class JobIn(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    base_model: str = Field(min_length=1, max_length=64)
    dataset_kind: str = "duties"
    mine_id: int | None = None
    notes: str | None = None


class JobPatch(BaseModel):
    status: str | None = None
    notes: str | None = None
    metrics: dict | None = None


@router.get("/jobs")
def list_jobs(
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict]:
    rows = db.scalars(
        select(FineTuneJob).order_by(FineTuneJob.created_at.desc()).limit(50)
    ).all()
    return [
        {
            "id": j.id,
            "name": j.name,
            "base_model": j.base_model,
            "dataset_kind": j.dataset_kind,
            "examples": j.examples,
            "status": j.status,
            "notes": j.notes,
            "metrics": j.metrics,
            "created_at": j.created_at,
            "updated_at": j.updated_at,
        }
        for j in rows
    ]


@router.post("/jobs", status_code=201)
def create_job(
    body: JobIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Register a run and snapshot how many examples it was built from.

    The count is stored rather than recomputed later, because the ledger keeps
    growing: a job trained on 41 examples must not appear to have used 300
    simply because more evidence arrived afterwards.
    """
    if body.dataset_kind not in DATASET_KINDS:
        raise HTTPException(status_code=400, detail="unknown dataset kind")
    scoped = resolve_mine_id(user, body.mine_id)
    rows = _build(db, scoped, body.dataset_kind)

    job = FineTuneJob(
        mine_id=scoped,
        name=body.name,
        base_model=body.base_model,
        dataset_kind=body.dataset_kind,
        examples=len(rows),
        status="prepared",
        notes=body.notes,
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return {"id": job.id, "examples": job.examples, "status": job.status}


@router.patch("/jobs/{job_id}")
def update_job(
    job_id: int,
    body: JobPatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Advance a job. Called by whoever ran the training, not by this server."""
    job = db.get(FineTuneJob, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="no such job")

    allowed = {"prepared", "running", "finished", "failed"}
    if body.status is not None:
        if body.status not in allowed:
            raise HTTPException(status_code=400, detail=f"status must be one of {allowed}")
        job.status = body.status
    if body.notes is not None:
        job.notes = body.notes
    if body.metrics is not None:
        job.metrics = body.metrics

    job.updated_at = datetime.now(timezone.utc)
    db.commit()
    return {"id": job.id, "status": job.status}
