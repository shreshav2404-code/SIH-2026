"""Evidence capture. Geo-tagged, vision-screened, hash-chained.

Coordinates, timestamp and hash are captured by the device, not typed by a
person. That is what makes evidence impossible to back-date.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from config import settings
from db import get_db
from models import Evidence, Obligation, User
from schemas import EvidenceOut, VerifyOut
from services.chain import GENESIS, compute_chain_hash, sha256_bytes, verify_chain

router = APIRouter(prefix="/evidence", tags=["evidence"])

ALLOWED = {"image/jpeg", "image/png", "image/webp"}
MAX_BYTES = 12 * 1024 * 1024


def _inside_lease(db: Session, mine_id: int, lat: float, lon: float) -> bool | None:
    """PostGIS ST_Contains. A geometric fact, not an opinion."""
    row = db.execute(
        text(
            "SELECT ST_Contains(lease_geom, ST_SetSRID(ST_Point(:lon, :lat), 4326)) "
            "FROM mine WHERE id = :mid"
        ),
        {"lon": lon, "lat": lat, "mid": mine_id},
    ).first()
    return bool(row[0]) if row and row[0] is not None else None


@router.post("", response_model=EvidenceOut, status_code=201)
async def upload_evidence(
    response: Response,
    obligation_id: int = Form(...),
    lat: float = Form(...),
    lon: float = Form(...),
    captured_at: datetime = Form(...),
    observation: str | None = Form(None),
    client_id: str | None = Form(None),
    photo: UploadFile | None = File(None),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ob = db.get(Obligation, obligation_id)
    if not ob:
        raise HTTPException(status_code=404, detail="obligation not found")
    mine_id = resolve_mine_id(user, ob.mine_id)

    # Idempotency — the offline queue retries, so this must be safe.
    if client_id:
        existing = db.scalar(
            select(Evidence).where(
                Evidence.mine_id == mine_id, Evidence.client_id == client_id
            )
        )
        if existing:
            # Already stored. 200, not 201 — the contract promises the mobile
            # queue can retry safely and tell the difference.
            response.status_code = 200
            return existing

    photo_bytes: bytes | None = None
    photo_sha: str | None = None
    if photo is not None:
        if photo.content_type not in ALLOWED:
            raise HTTPException(status_code=400, detail=f"unsupported type {photo.content_type}")
        photo_bytes = await photo.read()
        if len(photo_bytes) > MAX_BYTES:
            raise HTTPException(status_code=400, detail="photo too large (max 12 MB)")
        photo_sha = sha256_bytes(photo_bytes)

    prev = db.scalar(
        select(Evidence.chain_hash)
        .where(Evidence.mine_id == mine_id)
        .order_by(Evidence.id.desc())
        .limit(1)
    )

    chain_hash = compute_chain_hash(
        prev or GENESIS, photo_sha, lat, lon, captured_at, obligation_id
    )

    ev = Evidence(
        obligation_id=obligation_id,
        mine_id=mine_id,
        client_id=client_id,
        photo_sha256=photo_sha,
        observation=observation,
        lat=lat,
        lon=lon,
        captured_at=captured_at,
        inside_lease=_inside_lease(db, mine_id, lat, lon),
        prev_hash=prev or GENESIS,
        chain_hash=chain_hash,
    )
    db.add(ev)
    db.flush()

    if photo_bytes is not None:
        mine_dir = settings.storage_dir / str(mine_id)
        mine_dir.mkdir(parents=True, exist_ok=True)
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}[
            photo.content_type
        ]
        path = mine_dir / f"{ev.id}.{ext}"
        path.write_bytes(photo_bytes)
        ev.photo_path = f"storage/{mine_id}/{path.name}"

        try:
            from services.vision import screen_photo

            ev.vision_result = screen_photo(path)
        except Exception as exc:  # noqa: BLE001 — vision must never block capture
            ev.vision_result = {"pass": None, "error": str(exc)}

    ob.status = "submitted"
    db.commit()
    db.refresh(ev)
    return ev


@router.get("")
def list_evidence(
    mine_id: int | None = None,
    limit: int = 50,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> list[dict]:
    """Evidence for the dashboard, newest first.

    Captures were being stored, hash-chained and vision-screened, and then
    shown to nobody: there was no way to list them, so the photograph, the
    YOLO verdict and the chain hash all existed only in the database. A
    regulator has to be able to look at the evidence.

    `vision_result` is returned verbatim rather than reduced to a pass/flag
    flag, so the dashboard can show WHICH objects were detected. A verdict
    without its reasons is not auditable.
    """
    # Raises rather than returning None: a regulator must name a mine, and
    # everyone else is pinned to their own.
    scoped = resolve_mine_id(user, mine_id)

    rows = db.scalars(
        select(Evidence)
        .where(Evidence.mine_id == scoped)
        .order_by(Evidence.captured_at.desc())
        .limit(min(limit, 200))
    ).all()
    return [
        {
            "id": e.id,
            "mine_id": e.mine_id,
            "obligation_id": e.obligation_id,
            "observation": e.observation,
            "lat": e.lat,
            "lon": e.lon,
            "captured_at": e.captured_at,
            "inside_lease": e.inside_lease,
            "vision_result": e.vision_result,
            "photo_sha256": e.photo_sha256,
            "prev_hash": e.prev_hash,
            "chain_hash": e.chain_hash,
            "has_photo": bool(e.photo_path),
        }
        for e in rows
    ]


@router.get("/verify", response_model=VerifyOut)
def verify(
    mine_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> VerifyOut:
    mine = resolve_mine_id(user, mine_id)
    rows = db.scalars(
        select(Evidence).where(Evidence.mine_id == mine).order_by(Evidence.id)
    ).all()
    ok, checked, broken = verify_chain(rows)
    return VerifyOut(ok=ok, checked=checked, first_broken=broken)


@router.get("/{evidence_id}/photo")
def get_photo(
    evidence_id: int,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
):
    ev = db.get(Evidence, evidence_id)
    if not ev or not ev.photo_path:
        raise HTTPException(status_code=404, detail="no photo for this evidence")
    resolve_mine_id(user, ev.mine_id)

    path = settings.storage_dir.parent / ev.photo_path
    if not path.exists():
        raise HTTPException(status_code=404, detail="photo file missing")
    return FileResponse(path)
