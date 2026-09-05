"""The hash chain, which is the one claim this project cannot get wrong.

These tests exist because the chain was WRONG in a way nobody noticed until it
was measured: the canonical string covered the photograph, the coordinates, the
timestamp and the obligation, but not the officer's written observation. So
`update evidence set observation = '...'` passed verification cleanly - the
substance of a compliance record was the one part not protected by the hash
over it.

That regression must never come back quietly, so every field is asserted
individually. A test that only checked "tampering is detected" would have
passed against the broken version, because tampering with a COVERED field was
always detected. The bug lived in the gap between fields, which is exactly what
`test_every_field_is_covered` walks.

No database. The chain is pure arithmetic over strings and should be testable
without Postgres, PostGIS or a running API.
"""

from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.chain import (  # noqa: E402
    GENESIS,
    compute_chain_hash,
    sha256_bytes,
    verify_chain,
)


class Row:
    """The subset of an Evidence row that verify_chain reads."""

    def __init__(self, **kw) -> None:
        self.id = kw["id"]
        self.photo_sha256 = kw.get("photo_sha256")
        self.lat = kw["lat"]
        self.lon = kw["lon"]
        self.captured_at = kw["captured_at"]
        self.obligation_id = kw["obligation_id"]
        self.observation = kw.get("observation")
        self.chain_hash = kw["chain_hash"]


BASE = dict(
    photo_sha256="a" * 64,
    lat=22.353984,
    lon=82.579366,
    captured_at=datetime(2026, 9, 5, 11, 27, 0, tzinfo=UTC),
    obligation_id=16,
    observation="Overtime register checked against the attendance board.",
)


def chain(*rows: dict) -> list[Row]:
    """Build a correctly linked chain from field dicts."""
    out: list[Row] = []
    prev = GENESIS
    for i, r in enumerate(rows, start=1):
        fields = {**BASE, **r}
        h = compute_chain_hash(
            prev,
            fields["photo_sha256"],
            fields["lat"],
            fields["lon"],
            fields["captured_at"],
            fields["obligation_id"],
            fields["observation"],
        )
        out.append(Row(id=i, chain_hash=h, **fields))
        prev = h
    return out


def test_intact_chain_verifies():
    rows = chain({}, {"observation": "second"}, {"observation": "third"})
    ok, checked, broken = verify_chain(rows)
    assert ok is True
    assert checked == 3
    assert broken is None


@pytest.mark.parametrize(
    "field,tampered",
    [
        ("observation", "Overtime register checked - NO discrepancies found."),
        ("lat", 13.1756048),
        ("lon", 77.5543605),
        ("photo_sha256", "b" * 64),
        ("obligation_id", 91),
        ("captured_at", datetime(2026, 9, 5, 11, 28, 0, tzinfo=UTC)),
    ],
)
def test_every_field_is_covered(field, tampered):
    """Changing ANY hashed field must break verification.

    `observation` is the one that was missing. It is parametrised alongside the
    others rather than given its own test so that adding a field to the record
    without adding it to the hash shows up here as an obvious omission.
    """
    rows = chain({}, {}, {})
    setattr(rows[1], field, tampered)

    ok, checked, broken = verify_chain(rows)
    assert ok is False, f"tampering with {field!r} was not detected"
    assert broken is not None
    assert broken["evidence_id"] == rows[1].id
    # Verification stops at the first bad link rather than walking past it.
    assert checked == 2


def test_break_is_reported_at_the_first_bad_link():
    """Editing row 2 must name row 2, not row 3.

    Every hash after a tampered row is also wrong, because each one feeds the
    next. Reporting the last mismatch instead of the first would point an
    investigator at the wrong record.
    """
    rows = chain({}, {}, {}, {})
    rows[1].observation = "edited"

    ok, _, broken = verify_chain(rows)
    assert ok is False
    assert broken["evidence_id"] == 2


def test_empty_chain_is_vacuously_intact():
    ok, checked, broken = verify_chain([])
    assert (ok, checked, broken) == (True, 0, None)


def test_first_row_links_to_genesis():
    rows = chain({})
    assert rows[0].chain_hash == compute_chain_hash(
        GENESIS,
        BASE["photo_sha256"],
        BASE["lat"],
        BASE["lon"],
        BASE["captured_at"],
        BASE["obligation_id"],
        BASE["observation"],
    )


def test_timestamp_is_pinned_to_utc():
    """The same instant in two zones must hash identically.

    A bare `.astimezone()` converts to whatever the SERVER's local zone happens
    to be, so every stored hash became unverifiable if the box moved zones or
    ran elsewhere. A chain that only holds while the clock agrees is not a
    chain.
    """
    ist = timezone(timedelta(hours=5, minutes=30))
    utc_time = datetime(2026, 9, 5, 11, 27, 0, tzinfo=UTC)
    same_instant_ist = utc_time.astimezone(ist)

    a = compute_chain_hash(GENESIS, None, 1.0, 2.0, utc_time, 1, "x")
    b = compute_chain_hash(GENESIS, None, 1.0, 2.0, same_instant_ist, 1, "x")
    assert a == b


def test_absent_and_empty_observation_hash_alike():
    """None and "" are the same absence, and must not fork the chain.

    The API stores an empty string when an officer submits no text while older
    rows hold NULL. If those hashed differently, a column default change would
    invalidate historical records for no reason.
    """
    a = compute_chain_hash(GENESIS, None, 1.0, 2.0, BASE["captured_at"], 1, None)
    b = compute_chain_hash(GENESIS, None, 1.0, 2.0, BASE["captured_at"], 1, "")
    assert a == b


def test_photo_hash_is_the_file_not_the_name():
    assert sha256_bytes(b"evidence") != sha256_bytes(b"evidence ")
    assert len(sha256_bytes(b"")) == 64
