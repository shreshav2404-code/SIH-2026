"""Alerts. Every one names the clause it threatens — that link is what makes
this a compliance alert rather than a generic sensor dashboard."""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Alert, Obligation, Statute, User
from schemas import AlertOut

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
def list_alerts(
    mine_id: int | None = None,
    severity: str | None = None,
    acknowledged: bool | None = None,
    limit: int = Query(50, ge=1, le=500),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    mine = resolve_mine_id(user, mine_id)

    stmt = (
        select(Alert, Statute.clause_ref)
        .outerjoin(Obligation, Obligation.id == Alert.obligation_id)
        .outerjoin(Statute, Statute.id == Obligation.statute_id)
        .where(Alert.mine_id == mine)
    )
    if severity:
        stmt = stmt.where(Alert.severity == severity)
    if acknowledged is True:
        stmt = stmt.where(Alert.acknowledged_by.is_not(None))
    elif acknowledged is False:
        stmt = stmt.where(Alert.acknowledged_by.is_(None))

    rows = db.execute(stmt.order_by(desc(Alert.created_at)).limit(limit)).all()

    items = []
    for a, joined_ref in rows:
        out = AlertOut.model_validate(a)
        # Prefer the stored ref; fall back to the obligation's clause.
        out.clause_ref = a.clause_ref or joined_ref
        items.append(out)
    return {"items": items}


@router.post("/{alert_id}/acknowledge", response_model=AlertOut)
def acknowledge(
    alert_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> AlertOut:
    alert = db.get(Alert, alert_id)
    if not alert:
        raise HTTPException(status_code=404, detail="alert not found")
    resolve_mine_id(user, alert.mine_id)

    alert.acknowledged_by = user.id
    alert.acknowledged_at = datetime.now(UTC)
    db.commit()
    db.refresh(alert)
    return AlertOut.model_validate(alert)
