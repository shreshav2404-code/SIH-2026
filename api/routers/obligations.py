"""The ledger. Every clause a tracked duty with an owner and a deadline."""

from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Evidence, Obligation, RiskScore, Statute, User
from schemas import (
    ObligationCreate,
    ObligationDetail,
    ObligationOut,
    ObligationPatch,
    Page,
)

router = APIRouter(prefix="/obligations", tags=["obligations"])


def _latest_risk_subq():
    """Most recent risk score per obligation."""
    return (
        select(
            RiskScore.obligation_id.label("obligation_id"),
            func.max(RiskScore.computed_at).label("latest"),
        )
        .where(RiskScore.obligation_id.is_not(None))
        .group_by(RiskScore.obligation_id)
        .subquery()
    )


@router.get("", response_model=Page[ObligationOut])
def list_obligations(
    mine_id: int | None = None,
    status: str | None = None,
    owner_role: str | None = None,
    due_before: date | None = None,
    sort: str = Query("due_date", pattern="^(due_date|risk)$"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> Page[ObligationOut]:
    mine = resolve_mine_id(user, mine_id)

    latest = _latest_risk_subq()
    ev_count = (
        select(
            Evidence.obligation_id.label("obligation_id"),
            func.count(Evidence.id).label("n"),
            func.max(Evidence.captured_at).label("last_at"),
        )
        .group_by(Evidence.obligation_id)
        .subquery()
    )

    stmt = (
        select(
            Obligation,
            Statute.clause_ref,
            Statute.act,
            RiskScore.score,
            func.coalesce(ev_count.c.n, 0),
            ev_count.c.last_at,
        )
        .join(Statute, Statute.id == Obligation.statute_id)
        .outerjoin(latest, latest.c.obligation_id == Obligation.id)
        .outerjoin(
            RiskScore,
            (RiskScore.obligation_id == Obligation.id)
            & (RiskScore.computed_at == latest.c.latest),
        )
        .outerjoin(ev_count, ev_count.c.obligation_id == Obligation.id)
        .where(Obligation.mine_id == mine)
    )

    if status:
        stmt = stmt.where(Obligation.status == status)
    if owner_role:
        stmt = stmt.where(Obligation.owner_role == owner_role)
    if due_before:
        stmt = stmt.where(Obligation.due_date <= due_before)

    total = db.scalar(
        select(func.count()).select_from(stmt.subquery())
    ) or 0

    if sort == "risk":
        stmt = stmt.order_by(RiskScore.score.desc().nullslast(), Obligation.due_date)
    else:
        stmt = stmt.order_by(Obligation.due_date.asc().nullslast(), Obligation.id)

    rows = db.execute(stmt.limit(limit).offset(offset)).all()

    items = [
        ObligationOut(
            id=o.id,
            mine_id=o.mine_id,
            title=o.title,
            clause_ref=ref,
            act=act,
            owner_role=o.owner_role,
            frequency=o.frequency,
            evidence_type=o.evidence_type,
            due_date=o.due_date,
            status=o.status,
            risk_score=score,
            evidence_count=n,
            last_evidence_at=last_at,
        )
        for o, ref, act, score, n, last_at in rows
    ]
    return Page(items=items, total=total, limit=limit, offset=offset)


@router.get("/{obligation_id}", response_model=ObligationDetail)
def get_obligation(
    obligation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ObligationDetail:
    row = db.execute(
        select(Obligation, Statute)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Obligation.id == obligation_id)
    ).first()
    if not row:
        raise HTTPException(status_code=404, detail="obligation not found")

    ob, st = row
    resolve_mine_id(user, ob.mine_id)

    risk = db.scalar(
        select(RiskScore)
        .where(RiskScore.obligation_id == ob.id)
        .order_by(RiskScore.computed_at.desc())
        .limit(1)
    )
    evidence = db.scalars(
        select(Evidence)
        .where(Evidence.obligation_id == ob.id)
        .order_by(Evidence.captured_at.desc())
    ).all()

    return ObligationDetail(
        id=ob.id,
        mine_id=ob.mine_id,
        title=ob.title,
        clause_ref=st.clause_ref,
        act=st.act,
        owner_role=ob.owner_role,
        frequency=ob.frequency,
        evidence_type=ob.evidence_type,
        due_date=ob.due_date,
        status=ob.status,
        risk_score=risk.score if risk else None,
        evidence_count=len(evidence),
        last_evidence_at=evidence[0].captured_at if evidence else None,
        clause_text=st.text,
        evidence=evidence,
        risk=(
            {"score": risk.score, "top_features": (risk.features or {}).get("top", [])}
            if risk
            else None
        ),
    )


@router.post("", response_model=ObligationOut, status_code=201)
def create_obligation(
    body: ObligationCreate,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ObligationOut:
    resolve_mine_id(user, body.mine_id)
    st = db.get(Statute, body.statute_id)
    if not st:
        raise HTTPException(status_code=404, detail="statute not found")

    ob = Obligation(**body.model_dump(), status="pending")
    db.add(ob)
    db.commit()
    db.refresh(ob)

    return ObligationOut(
        id=ob.id,
        mine_id=ob.mine_id,
        title=ob.title,
        clause_ref=st.clause_ref,
        act=st.act,
        owner_role=ob.owner_role,
        frequency=ob.frequency,
        evidence_type=ob.evidence_type,
        due_date=ob.due_date,
        status=ob.status,
    )


@router.patch("/{obligation_id}", response_model=ObligationOut)
def patch_obligation(
    obligation_id: int,
    body: ObligationPatch,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ObligationOut:
    ob = db.get(Obligation, obligation_id)
    if not ob:
        raise HTTPException(status_code=404, detail="obligation not found")
    resolve_mine_id(user, ob.mine_id)

    for field, value in body.model_dump(exclude_unset=True).items():
        setattr(ob, field, value)
    db.commit()
    db.refresh(ob)

    st = db.get(Statute, ob.statute_id)
    return ObligationOut(
        id=ob.id,
        mine_id=ob.mine_id,
        title=ob.title,
        clause_ref=st.clause_ref,
        act=st.act,
        owner_role=ob.owner_role,
        frequency=ob.frequency,
        evidence_type=ob.evidence_type,
        due_date=ob.due_date,
        status=ob.status,
    )
