"""Risk scoring. XGBoost — never an LLM.

A number an auditor can challenge and you can explain feature by feature. The
on-device model narrates it; it does not decide it.
"""

from __future__ import annotations

from datetime import UTC, date, datetime, timedelta

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import (
    Alert,
    Evidence,
    Mine,
    Obligation,
    RiskScore,
    SensorReading,
    Statute,
    User,
)
from schemas import FeatureContribution, RiskOut
from services import risk_model
from services.hazard import threshold_for

router = APIRouter(prefix="/risk", tags=["risk"])


def _require_model() -> None:
    if not risk_model.is_trained():
        raise HTTPException(
            status_code=503,
            detail=(
                "risk model not trained — run `python api/seed/seed.py` "
                "once the ML stack is installed"
            ),
        )


# How long a duty of each cadence may go uninspected before it is worrying.
# Used when a duty has NO evidence at all: "never inspected" means something
# very different for a daily check than for an annual return, and treating both
# as a flat 60 days made the feature a constant that lifted every score
# equally instead of separating them.
CADENCE_DAYS = {
    "continuous": 1, "daily": 1, "4x_weekly": 2, "weekly": 7,
    "fortnightly": 14, "monthly": 30, "quarterly": 91,
    "half_yearly": 182, "annual": 365, "event_driven": 30, "one_time": 365,
}


def _hazard_by_clause(db: Session, mine_id: int) -> dict[str, float]:
    """Worst recent reading per sensor, as a fraction of its threshold, keyed by
    the CLAUSE that sensor protects.

    Per clause, not per mine. A methane excursion threatens the ventilation
    duty under Reg. 46; it says nothing about the overtime register. Applying
    one mine-wide hazard number to all 42 duties was both wrong and the main
    reason every score landed in the seventies.
    """
    since = datetime.now(UTC) - timedelta(hours=6)
    rows = db.execute(
        select(SensorReading.sensor_type, func.max(SensorReading.value))
        .where(SensorReading.mine_id == mine_id, SensorReading.recorded_at >= since)
        .group_by(SensorReading.sensor_type)
    ).all()

    by_clause: dict[str, float] = {}
    for sensor_type, peak in rows:
        cfg = threshold_for(sensor_type)
        if not cfg or not cfg.get("threshold"):
            continue
        ratio = float(peak) / float(cfg["threshold"])
        ref = cfg["clause_ref"]
        by_clause[ref] = max(by_clause.get(ref, 0.0), round(ratio, 3))
    return by_clause


def _features_for(
    db: Session,
    ob: Obligation,
    mine: Mine,
    hazard_by_clause: dict[str, float],
    clause_ref: str,
) -> dict:
    today = date.today()
    days_overdue = (today - ob.due_date).days if ob.due_date else 0

    last_ev = db.scalar(
        select(func.max(Evidence.captured_at)).where(Evidence.obligation_id == ob.id)
    )
    if last_ev:
        days_since = (datetime.now(UTC) - last_ev).days
    else:
        # Never inspected. Express that against the duty's own cadence rather
        # than a flat constant: two cadence periods of silence.
        days_since = CADENCE_DAYS.get(ob.frequency, 30) * 2

    # Only the duties governed by a breaching sensor carry its hazard.
    hazard = hazard_by_clause.get(clause_ref, 0.0)

    violations = db.scalar(
        select(func.count(Alert.id)).where(
            Alert.obligation_id == ob.id, Alert.severity == "critical"
        )
    ) or 0

    return risk_model.build_features(
        days_overdue=days_overdue,
        past_violations=violations,
        days_since_last_inspection=days_since,
        hazard_reading_ratio=hazard,
        on=today,
        is_underground=mine.type in ("underground", "mixed"),
    )


@router.post("/recompute", status_code=202)
def recompute(
    mine_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    _require_model()
    mine_id_r = resolve_mine_id(user, mine_id)
    mine = db.get(Mine, mine_id_r)
    hazard_by_clause = _hazard_by_clause(db, mine_id_r)

    rows = db.execute(
        select(Obligation, Statute.clause_ref)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Obligation.mine_id == mine_id_r)
    ).all()
    obligations = [ob for ob, _ in rows]

    now = datetime.now(UTC)
    for ob, clause_ref in rows:
        feats = _features_for(db, ob, mine, hazard_by_clause, clause_ref)
        result = risk_model.predict(feats)
        db.add(
            RiskScore(
                mine_id=mine_id_r,
                obligation_id=ob.id,
                score=result["score"],
                features={"inputs": feats, "top": result["top_features"]},
                computed_at=now,
            )
        )

    # Mine-level score = the worst duty. A mine is as compliant as its weakest
    # obligation, not its average one.
    #
    # flush() is required: the session is autoflush=False, so without it the
    # MAX below cannot see the rows just added and silently returns None,
    # scoring every mine 0.0 while its duties sit at 98.
    if obligations:
        db.flush()
        worst = db.scalar(
            select(func.max(RiskScore.score)).where(
                RiskScore.mine_id == mine_id_r, RiskScore.computed_at == now
            )
        )
        db.add(
            RiskScore(
                mine_id=mine_id_r,
                obligation_id=None,
                score=float(worst or 0),
                features={"method": "max of obligation scores"},
                computed_at=now,
            )
        )

    db.commit()
    return {"recomputed": len(obligations), "mine_id": mine_id_r}


@router.get("/mine/{mine_id}", response_model=RiskOut)
def mine_risk(
    mine_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RiskOut:
    resolve_mine_id(user, mine_id)
    row = db.scalar(
        select(RiskScore)
        .where(RiskScore.mine_id == mine_id, RiskScore.obligation_id.is_(None))
        .order_by(RiskScore.computed_at.desc())
        .limit(1)
    )
    if not row:
        raise HTTPException(
            status_code=404, detail="no score yet — POST /risk/recompute first"
        )
    return RiskOut(
        mine_id=mine_id,
        score=row.score,
        band=risk_model.band(row.score),
        computed_at=row.computed_at,
    )


@router.get("/obligation/{obligation_id}", response_model=RiskOut)
def obligation_risk(
    obligation_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> RiskOut:
    ob = db.get(Obligation, obligation_id)
    if not ob:
        raise HTTPException(status_code=404, detail="obligation not found")
    resolve_mine_id(user, ob.mine_id)

    row = db.scalar(
        select(RiskScore)
        .where(RiskScore.obligation_id == obligation_id)
        .order_by(RiskScore.computed_at.desc())
        .limit(1)
    )
    if not row:
        raise HTTPException(
            status_code=404, detail="no score yet — POST /risk/recompute first"
        )

    top = (row.features or {}).get("top", [])
    return RiskOut(
        obligation_id=obligation_id,
        mine_id=ob.mine_id,
        score=row.score,
        band=risk_model.band(row.score),
        top_features=[FeatureContribution(**f) for f in top],
        computed_at=row.computed_at,
    )
