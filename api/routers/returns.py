"""Statutory returns. The system drafts; a certificated officer signs.

THERE IS NO ENDPOINT THAT FILES A RETURN TO A REGULATOR, and that is
deliberate. The AI never files, so it never carries liability. Drafting and
signing are separate calls, and only a mine_manager can sign.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import current_user, require_roles, resolve_mine_id
from db import get_db
from models import Evidence, Obligation, Statute, StatutoryReturn, User
from schemas import DraftIn, ReturnOut, SignIn

router = APIRouter(prefix="/returns", tags=["returns"])

# Which acts feed which return. Keeps the draft grounded in the right corpus.
RETURN_SCOPE = {
    "EIA_HALF_YEARLY": ("EIA Notification 2006", "Environment (Protection) Act 1986"),
    "CMR_ANNUAL": ("Coal Mines Regulations 2017",),
    "MINES_RULES_ANNUAL": ("Mines Rules 1955",),
}


@router.post("/draft", response_model=ReturnOut, status_code=201)
def draft(
    body: DraftIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> StatutoryReturn:
    """Assemble the draft from collected evidence. Every figure carries the
    clause it relied on and the evidence records behind it — a section with no
    citation is a bug, not a style choice."""
    mine = resolve_mine_id(user, body.mine_id)

    existing = db.scalar(
        select(StatutoryReturn).where(
            StatutoryReturn.mine_id == mine,
            StatutoryReturn.period == body.period,
            StatutoryReturn.return_type == body.return_type,
        )
    )
    if existing and existing.locked:
        raise HTTPException(
            status_code=409, detail="a signed return already exists for this period"
        )

    acts = RETURN_SCOPE.get(body.return_type)
    stmt = (
        select(
            Statute.clause_ref,
            Statute.act,
            Obligation.id,
            Obligation.title,
            Obligation.status,
            func.count(Evidence.id),
        )
        .select_from(Obligation)
        .join(Statute, Statute.id == Obligation.statute_id)
        .outerjoin(Evidence, Evidence.obligation_id == Obligation.id)
        .where(Obligation.mine_id == mine)
        .group_by(
            Statute.clause_ref, Statute.act,
            Obligation.id, Obligation.title, Obligation.status,
        )
        .order_by(Statute.clause_ref)
    )
    if acts:
        stmt = stmt.where(Statute.act.in_(acts))

    rows = db.execute(stmt).all()

    sections = []
    total_evidence = 0
    for clause_ref, act, ob_id, title, status, ev_count in rows:
        total_evidence += ev_count
        ev_ids = db.scalars(
            select(Evidence.id).where(Evidence.obligation_id == ob_id).limit(10)
        ).all()

        sections.append(
            {
                "heading": title,
                "body": (
                    f"Status: {status}. {ev_count} evidence record(s) on file "
                    f"for the period."
                ),
                "citations": [
                    {
                        "clause_ref": clause_ref,
                        "act": act,
                        "evidence_ids": list(ev_ids),
                        "figure": f"{ev_count} record(s)",
                    }
                ],
            }
        )

    draft_json = {
        "sections": sections,
        "evidence_count": total_evidence,
        "obligations_covered": len(sections),
        "generated_at": datetime.now(UTC).isoformat(),
        "note": (
            "Drafted from collected evidence. Every figure cites its clause and "
            "source records. Requires signature by a certificated officer."
        ),
    }

    if existing:
        existing.draft_json = draft_json
        db.commit()
        db.refresh(existing)
        return existing

    ret = StatutoryReturn(
        mine_id=mine,
        period=body.period,
        return_type=body.return_type,
        draft_json=draft_json,
        locked=False,
    )
    db.add(ret)
    db.commit()
    db.refresh(ret)
    return ret


@router.get("")
def list_returns(
    mine_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    mine = resolve_mine_id(user, mine_id)
    rows = db.scalars(
        select(StatutoryReturn)
        .where(StatutoryReturn.mine_id == mine)
        .order_by(StatutoryReturn.created_at.desc())
    ).all()
    return {"items": [ReturnOut.model_validate(r) for r in rows]}


@router.post("/{return_id}/sign", response_model=ReturnOut)
def sign(
    return_id: int,
    body: SignIn,
    db: Session = Depends(get_db),
    user: User = Depends(require_roles("mine_manager")),
) -> StatutoryReturn:
    """A certificated officer signs, and it locks. This is the same
    accountability chain the Mines Act already sets out."""
    ret = db.get(StatutoryReturn, return_id)
    if not ret:
        raise HTTPException(status_code=404, detail="return not found")
    resolve_mine_id(user, ret.mine_id)

    if ret.locked:
        raise HTTPException(
            status_code=409, detail="return already signed and locked"
        )

    ret.signed_by = user.id
    ret.signature_name = body.signature_name
    ret.certificate_no = body.certificate_no
    ret.signed_at = datetime.now(UTC)
    ret.locked = True
    db.commit()
    db.refresh(ret)
    return ret
