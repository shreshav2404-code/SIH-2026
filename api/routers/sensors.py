"""Sensor ingest and window interpretation.

We are not asking Coal India to buy a single sensor. ETMS, methane detectors,
strata monitors and geo-fenced vehicle tracking are already deployed and named
in the Ministry's own annual report. That data exists. It sits in silos.
This endpoint is where we read it.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends, Query
from sqlalchemy import desc, select
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from db import get_db
from models import Alert, Mine, Obligation, SensorReading, Statute, User
from schemas import ReadingOut, ReadingsIn, WindowOut, WindowStats
from services.hazard import alert_message, evaluate, threshold_for

router = APIRouter(prefix="/sensors", tags=["sensors"])

WINDOW_MINUTES = 60
# Do not re-fire the same breach every 2 seconds.
COOLDOWN_MINUTES = 5


def _obligation_for_clause(db: Session, mine_id: int, clause_ref: str) -> int | None:
    return db.scalar(
        select(Obligation.id)
        .join(Statute, Statute.id == Obligation.statute_id)
        .where(Obligation.mine_id == mine_id, Statute.clause_ref == clause_ref)
        .limit(1)
    )


@router.post("/readings", status_code=202)
def ingest(body: ReadingsIn, db: Session = Depends(get_db)) -> dict:
    """No auth — this is the simulator and, in production, a plant gateway.

    Detection is arithmetic. A statutory safety alert cannot depend on a
    probabilistic system.
    """
    fired: list[dict] = []
    touched: set[tuple[int, str]] = set()

    for r in body.readings:
        db.add(
            SensorReading(
                mine_id=r.mine_id,
                sensor_type=r.sensor_type,
                value=r.value,
                unit=r.unit,
                recorded_at=r.recorded_at,
            )
        )
        touched.add((r.mine_id, r.sensor_type))
    db.flush()

    now = datetime.now(UTC)
    since = now - timedelta(minutes=WINDOW_MINUTES)

    for mine_id, sensor_type in touched:
        cfg = threshold_for(sensor_type)
        if not cfg:
            continue

        rows = db.scalars(
            select(SensorReading)
            .where(
                SensorReading.mine_id == mine_id,
                SensorReading.sensor_type == sensor_type,
                SensorReading.recorded_at >= since,
            )
            .order_by(SensorReading.recorded_at)
        ).all()
        if not rows:
            continue

        stats = evaluate(sensor_type, [r.value for r in rows])
        if not stats["breaching"]:
            continue

        clause_ref = cfg["clause_ref"]
        recent = db.scalar(
            select(Alert)
            .where(
                Alert.mine_id == mine_id,
                Alert.message.like(f"%{sensor_type.replace('_', ' ')}%"),
                Alert.created_at >= now - timedelta(minutes=COOLDOWN_MINUTES),
            )
            .limit(1)
        )
        if recent:
            continue

        alert = Alert(
            mine_id=mine_id,
            obligation_id=_obligation_for_clause(db, mine_id, clause_ref),
            clause_ref=clause_ref,
            severity=cfg.get("severity", "warning"),
            message=alert_message(sensor_type, stats, rows[-1].unit),
            source="rule",
        )
        db.add(alert)
        db.flush()
        fired.append(
            {"id": alert.id, "severity": alert.severity, "clause_ref": clause_ref}
        )

    db.commit()
    return {"accepted": len(body.readings), "alerts_fired": fired}


@router.get("/readings")
def list_readings(
    mine_id: int | None = None,
    sensor_type: str | None = None,
    since: datetime | None = None,
    limit: int = Query(200, ge=1, le=5000),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    mine = resolve_mine_id(user, mine_id)
    stmt = select(SensorReading).where(SensorReading.mine_id == mine)
    if sensor_type:
        stmt = stmt.where(SensorReading.sensor_type == sensor_type)
    if since:
        stmt = stmt.where(SensorReading.recorded_at >= since)

    rows = db.scalars(
        stmt.order_by(desc(SensorReading.recorded_at)).limit(limit)
    ).all()
    return {"items": [ReadingOut.model_validate(r) for r in reversed(rows)]}


@router.get("/window", response_model=WindowOut)
def window(
    sensor_type: str,
    mine_id: int | None = None,
    window_minutes: int = Query(60, ge=5, le=1440),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> WindowOut:
    """Readings PLUS the governing clause.

    This is where sensor data meets the model — interpretation, not arithmetic.
    The clause travels with the readings so the on-device model is never asked
    to recall statute from memory.
    """
    mine = resolve_mine_id(user, mine_id)
    since = datetime.now(UTC) - timedelta(minutes=window_minutes)

    rows = db.scalars(
        select(SensorReading)
        .where(
            SensorReading.mine_id == mine,
            SensorReading.sensor_type == sensor_type,
            SensorReading.recorded_at >= since,
        )
        .order_by(SensorReading.recorded_at)
    ).all()

    stats = evaluate(sensor_type, [r.value for r in rows])

    clause = None
    cfg = threshold_for(sensor_type)
    if cfg:
        st = db.scalar(
            select(Statute).where(Statute.clause_ref == cfg["clause_ref"]).limit(1)
        )
        if st:
            clause = {"clause_ref": st.clause_ref, "act": st.act, "text": st.text}

    return WindowOut(
        mine_id=mine,
        sensor_type=sensor_type,
        window_minutes=window_minutes,
        readings=[ReadingOut.model_validate(r) for r in rows],
        stats=WindowStats(**{k: stats[k] for k in ("mean", "max", "z_max", "threshold", "breaching")}),
        clause=clause,
    )
