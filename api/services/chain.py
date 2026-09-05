"""Hash chain over evidence. Cryptography, not a model — verified or not.

    chain_hash = sha256(prev_hash + photo_sha256 + lat + lon
                        + captured_at + obligation_id + observation)

`prev_hash` is the previous evidence row's chain_hash FOR THAT MINE, so each
mine has its own chain. Editing any row breaks every link after it.
"""

from __future__ import annotations

import hashlib
from datetime import datetime, timezone

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
    observation: str | None,
) -> str:
    """One canonical string. Any change to this format invalidates every stored
    chain, so treat it as frozen once data exists."""
    return "|".join(
        [
            prev_hash or GENESIS,
            photo_sha256 or "",
            f"{lat:.6f}",
            f"{lon:.6f}",
            # UTC explicitly. A bare .astimezone() converts to whatever the
            # SERVER's local zone happens to be, so every stored hash became
            # unverifiable if the box moved zones or ran elsewhere - a chain
            # that only holds while the clock agrees is not a chain.
            captured_at.astimezone(timezone.utc).isoformat(),
            str(obligation_id),
            # The officer's written finding, and the reason this list changed.
            # Without it, `update evidence set observation=...` passed
            # verification cleanly - measured, not assumed. The substance of a
            # compliance record was the one part not covered by the hash over
            # it, which is precisely backwards.
            observation or "",
        ]
    )


def compute_chain_hash(
    prev_hash: str | None,
    photo_sha256: str | None,
    lat: float,
    lon: float,
    captured_at: datetime,
    obligation_id: int,
    observation: str | None = None,
) -> str:
    payload = _canonical(
        prev_hash or GENESIS, photo_sha256, lat, lon, captured_at,
        obligation_id, observation
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
            prev, r.photo_sha256, r.lat, r.lon, r.captured_at,
            r.obligation_id, r.observation,
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
