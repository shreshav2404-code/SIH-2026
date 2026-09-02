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
from models import Alert, Evidence, Mine, Obligation, RiskScore, SensorReading, User
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


def _hazard_ratio(db: Session, mine_id: int) -> float:
    """Worst recent reading as a fraction of its threshold. 1.0 = at the line."""
    since = datetime.now(UTC) - timedelta(hours=6)
    rows = db.execute(
        select(SensorReading.sensor_type, func.max(SensorReading.value))
        .where(SensorReading.mine_id == mine_id, SensorReading.recorded_at >= since)
        .group_by(SensorReading.sensor_type)
    ).all()

    worst = 0.0
    for sensor_type, peak in rows:
        cfg = threshold_for(sensor_type)
        if cfg and cfg["threshold"]:
            worst = max(worst, float(peak) / float(cfg["threshold"]))
    return round(worst, 3)


def _features_for(db: Session, ob: Obligation, mine: Mine, hazard: float) -> dict:
    today = date.today()
    days_overdue = (today - ob.due_date).days if ob.due_date else 0

    last_ev = db.scalar(
        select(func.max(Evidence.captured_at)).where(Evidence.obligation_id == ob.id)
    )
    days_since = (
        (datetime.now(UTC) - last_ev).days if last_ev else 60
    )

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
    hazard = _hazard_ratio(db, mine_id_r)

    obligations = db.scalars(
        select(Obligation).where(Obligation.mine_id == mine_id_r)
    ).all()

    now = datetime.now(UTC)
    for ob in obligations:
        feats = _features_for(db, ob, mine, hazard)
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
