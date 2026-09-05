"""Instructions from the control room to the people underground.

An alert is arithmetic - a threshold was crossed. A directive is a human
decision about that alert: stop work, ventilate, evacuate. Keeping them apart
is the point. An alert nobody acted on and an alert somebody stood down look
identical in a sensor table and completely different in an inquiry, and only
this table records which of the two happened, who decided, and who received it.

The loop closes on the handset: until an officer acknowledges, the directive
keeps showing. Acknowledgement records a person and a time, so "we told them"
becomes a fact with a name against it rather than a claim.

Deliberately polled, not pushed. Push notifications need FCM, a Google project
and a network the demo does not have; the handset already polls for duties, so
one more poll costs nothing and works in the same places the rest of the app
works.
"""

from __future__ import annotations

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.orm import Session

from auth import current_user, require_roles, resolve_mine_id
from db import get_db
from models import Alert, Directive, User
from schemas import DirectiveCreate, DirectiveOut
from services import locations

router = APIRouter(prefix="/directives", tags=["directives"])

ACTIONS = {"STOP_WORK", "EVACUATE", "VENTILATE", "INSPECT", "WITHDRAW_MEN"}


def _name(db: Session, uid: int | None) -> str | None:
    if uid is None:
        return None
    u = db.get(User, uid)
    return u.full_name if u else None


def _out(db: Session, d: Directive) -> DirectiveOut:
    return DirectiveOut(
        id=d.id,
        mine_id=d.mine_id,
        alert_id=d.alert_id,
        severity=d.severity,
        location=d.location,
        location_label=locations.label_for(d.location),
        message=d.message,
        action=d.action,
        created_at=d.created_at,
        issued_by_name=_name(db, d.issued_by),
        acknowledged_at=d.acknowledged_at,
        acknowledged_by_name=_name(db, d.acknowledged_by),
    )


@router.post("", response_model=DirectiveOut, status_code=201)
def raise_directive(
    body: DirectiveCreate,
    db: Session = Depends(get_db),
    # A regulator observes; they do not run the mine. Issuing an instruction to
    # people underground is a line-management act.
    user: User = Depends(require_roles("mine_manager", "safety_officer")),
) -> DirectiveOut:
    mine_id = resolve_mine_id(user, None)

    if body.action and body.action not in ACTIONS:
        raise HTTPException(
            status_code=400,
            detail=f"action must be one of {sorted(ACTIONS)}",
        )

    location = body.location
    alert = None
    if body.alert_id is not None:
        alert = db.get(Alert, body.alert_id)
        if not alert or alert.mine_id != mine_id:
            raise HTTPException(status_code=404, detail="alert not found")
        # The alert already knows where it fired; carrying that through means
        # the officer's banner names the same place the reading did.
        location = location or alert.location

    d = Directive(
        mine_id=mine_id,
        alert_id=body.alert_id,
        issued_by=user.id,
        severity=body.severity,
        location=location,
        message=body.message.strip(),
        action=body.action,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return _out(db, d)


@router.get("", response_model=list[DirectiveOut])
def list_directives(
    open_only: bool = Query(False, description="only those not yet acknowledged"),
    limit: int = Query(50, le=200),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[DirectiveOut]:
    """What the handset polls, and what the dashboard shows.

    Regulators may read them - seeing which alerts were acted on is most of
    what an inspection is - but resolve_mine_id keeps everyone else to their
    own mine.
    """
    mine_id = resolve_mine_id(user, user.mine_id if user.role != "regulator" else None)

    stmt = select(Directive).where(Directive.mine_id == mine_id)
    if open_only:
        stmt = stmt.where(Directive.acknowledged_at.is_(None))
    stmt = stmt.order_by(Directive.created_at.desc()).limit(limit)

    return [_out(db, d) for d in db.scalars(stmt).all()]


@router.post("/{directive_id}/ack", response_model=DirectiveOut)
def acknowledge(
    directive_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> DirectiveOut:
    """The officer on site confirms receipt.

    First acknowledgement wins and is not overwritten. Re-acknowledging would
    replace the name and time of the person who actually stood in front of the
    hazard with whoever opened the app last, which is exactly backwards for a
    record whose whole purpose is saying who was told.
    """
    d = db.get(Directive, directive_id)
    if not d:
        raise HTTPException(status_code=404, detail="directive not found")
    resolve_mine_id(user, d.mine_id)

    if d.acknowledged_at is None:
        d.acknowledged_by = user.id
        d.acknowledged_at = datetime.now(UTC)
        db.commit()
        db.refresh(d)
    return _out(db, d)
