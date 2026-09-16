"""Evidence capture. Geo-tagged, vision-screened, hash-chained.

Coordinates, timestamp and hash are captured by the device, not typed by a
person. That is what makes evidence impossible to back-date.
"""

from __future__ import annotations

from datetime import datetime

from fastapi import (
    APIRouter,
    BackgroundTasks,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
)
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from auth import current_user, resolve_mine_id
from config import settings
from db import SessionLocal, get_db
from models import Evidence, Mine, Obligation, Statute, User
from schemas import EvidenceOut, VerifyOut
from services.chain import GENESIS, compute_chain_hash, sha256_bytes, verify_chain
from services.evidence_notes import (
    clean_description,
    clean_place,
    clean_problems,
    format_place,
    review,
    summarise,
)

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


def _fill_address(evidence_id: int, lat: float, lon: float) -> None:
    """Look an address up after the response has gone, and store it if none arrived.

    A background task, not part of the upload: OpenStreetMap is a network call
    with a one-a-second rate limit, and an officer's sync should not wait on
    it. Its own session, because the request's session is closed by now.
    """
    from services.geocode import reverse

    place = clean_place(reverse(lat, lon))
    if not place:
        return
    db = SessionLocal()
    try:
        ev = db.get(Evidence, evidence_id)
        if ev and not ev.place:
            ev.place = place
            db.commit()
    finally:
        db.close()


def _fill_annotations(ev: Evidence, **values) -> bool:
    """Set each annotation that is currently empty. Returns whether any changed."""
    changed = False
    for field, value in values.items():
        if value in (None, "", [], {}):
            continue
        if getattr(ev, field) in (None, "", [], {}):
            setattr(ev, field, value[:64] if field == "ai_model" else value)
            changed = True
    return changed


class AnnotationsIn(BaseModel):
    place: dict | None = None
    ai_description: str | None = None
    ai_problems: list[str] | None = None
    ai_model: str | None = None


@router.patch("/{evidence_id}/annotations")
def add_annotations(
    evidence_id: int,
    body: AnnotationsIn,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> dict:
    """Attach an address or a description that arrived after the upload.

    The on-device vision model can take longer to read a photo than the
    officer takes to press Save and sync, so a description may finish after
    its capture is already on the server. This is how it catches up.

    Annotations only. There is no field here for the photo, the coordinates,
    the time, the duty or the observation - the hashed facts cannot be
    changed through this route because it has no way to name them. And it
    fills gaps rather than overwriting, so what a reviewer saw stays what was
    stored.
    """
    ev = db.get(Evidence, evidence_id)
    if not ev:
        raise HTTPException(status_code=404, detail="evidence not found")
    resolve_mine_id(user, ev.mine_id)

    changed = _fill_annotations(
        ev,
        place=clean_place(body.place),
        ai_description=clean_description(body.ai_description),
        ai_problems=clean_problems(body.ai_problems),
        ai_model=body.ai_model,
    )
    db.commit()
    return {"id": ev.id, "updated": changed}


@router.post("", response_model=EvidenceOut, status_code=201)
async def upload_evidence(
    response: Response,
    background: BackgroundTasks,
    obligation_id: int = Form(...),
    lat: float = Form(...),
    lon: float = Form(...),
    captured_at: datetime = Form(...),
    observation: str | None = Form(None),
    client_id: str | None = Form(None),
    photo: UploadFile | None = File(None),
    # Annotations. All optional, so an app that predates them still uploads.
    # place and ai_problems arrive as JSON strings because this is a
    # multipart form, which has no nested fields.
    gps_accuracy_m: float | None = Form(None),
    place: str | None = Form(None),
    ai_description: str | None = Form(None),
    ai_problems: str | None = Form(None),
    ai_model: str | None = Form(None),
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
            #
            # A retry may carry annotations the first attempt did not have -
            # the address looked up once signal returned, a description that
            # finished after the first upload. Fill gaps, never overwrite: the
            # first value stored is the one a reviewer may already have seen.
            _fill_annotations(
                existing,
                place=clean_place(place),
                ai_description=clean_description(ai_description),
                ai_problems=clean_problems(ai_problems),
                ai_model=ai_model,
            )
            if existing.gps_accuracy_m is None and gps_accuracy_m is not None:
                existing.gps_accuracy_m = gps_accuracy_m
            db.commit()
            if not existing.place:
                background.add_task(_fill_address, existing.id, existing.lat, existing.lon)
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
        prev or GENESIS, photo_sha, lat, lon, captured_at, obligation_id,
        observation,
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
        gps_accuracy_m=gps_accuracy_m,
        place=clean_place(place),
        ai_description=clean_description(ai_description),
        ai_problems=clean_problems(ai_problems),
        ai_model=(ai_model or "")[:64] or None,
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
    # The phone could not name the place - no signal underground, or its
    # geocoder failed. Ask OpenStreetMap once the response is on its way.
    if not ev.place:
        background.add_task(_fill_address, ev.id, ev.lat, ev.lon)
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

    # The duty and clause come back WITH the photo. This used to return only
    # obligation_id, so the dashboard could show a photograph but not say
    # what it was evidence OF - which is the first thing anyone reviewing it
    # asks.
    rows = db.execute(
        select(Evidence, Obligation, Statute, Mine)
        .join(Obligation, Evidence.obligation_id == Obligation.id)
        .join(Statute, Obligation.statute_id == Statute.id)
        .join(Mine, Evidence.mine_id == Mine.id)
        .where(Evidence.mine_id == scoped)
        .order_by(Evidence.captured_at.desc())
        .limit(min(limit, 200))
    ).all()
    return [
        {
            "id": e.id,
            "mine_id": e.mine_id,
            "mine_name": m.name,
            "obligation_id": e.obligation_id,
            "duty_title": o.title,
            "clause_ref": st.clause_ref,
            "act": st.act,
            "evidence_type": o.evidence_type,
            "observation": e.observation,
            "lat": e.lat,
            "lon": e.lon,
            "gps_accuracy_m": e.gps_accuracy_m,
            "place": e.place,
            "place_line": format_place(e.place),
            "captured_at": e.captured_at,
            "inside_lease": e.inside_lease,
            "vision_result": e.vision_result,
            "summary": summarise(e.vision_result, bool(e.photo_path)),
            "ai_description": e.ai_description,
            "ai_problems": e.ai_problems,
            "ai_model": e.ai_model,
            "review": review(e.vision_result, e.ai_problems, e.inside_lease),
            "photo_sha256": e.photo_sha256,
            "prev_hash": e.prev_hash,
            "chain_hash": e.chain_hash,
            "has_photo": bool(e.photo_path),
        }
        for e, o, st, m in rows
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
