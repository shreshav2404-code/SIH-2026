"""Hash chain over evidence. Cryptography, not a model — verified or not.

    chain_hash = sha256(prev_hash + photo_sha256 + lat + lon
                        + captured_at + obligation_id)

`prev_hash` is the previous evidence row's chain_hash FOR THAT MINE, so each
mine has its own chain. Editing any row breaks every link after it.
"""

from __future__ import annotations

import hashlib
from datetime import datetime

GENESIS = "0" * 64


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical(
    prev_hash: str,
    photo_sha256: str | None,
    lat: float,
    lon: float,
    captured_at: datetime,
    obligation_id: int,
) -> str:
    """One canonical string. Any change to this format invalidates every stored
    chain, so treat it as frozen once data exists."""
    return "|".join(
        [
            prev_hash or GENESIS,
            photo_sha256 or "",
            f"{lat:.6f}",
            f"{lon:.6f}",
            captured_at.astimezone().isoformat(),
            str(obligation_id),
        ]
    )


def compute_chain_hash(
    prev_hash: str | None,
    photo_sha256: str | None,
    lat: float,
    lon: float,
    captured_at: datetime,
    obligation_id: int,
) -> str:
    payload = _canonical(
        prev_hash or GENESIS, photo_sha256, lat, lon, captured_at, obligation_id
    )
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def verify_chain(rows) -> tuple[bool, int, dict | None]:
    """Walk a mine's evidence in insertion order.

    Returns (ok, checked, first_broken). This endpoint IS the demo — edit one
    row in DBeaver, re-run it, watch it fail.
    """
    prev = GENESIS
    checked = 0

    for r in rows:
        expected = compute_chain_hash(
            prev, r.photo_sha256, r.lat, r.lon, r.captured_at, r.obligation_id
        )
        checked += 1
        if expected != r.chain_hash:
            return (
                False,
                checked,
                {"evidence_id": r.id, "expected": expected, "found": r.chain_hash},
            )
        prev = r.chain_hash

    return True, checked, None
