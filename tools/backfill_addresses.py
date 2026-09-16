"""Give existing evidence an address, from OpenStreetMap.

    python tools/backfill_addresses.py

Captures stored before addresses were recorded have coordinates and nothing
else. This looks each one up once, at OpenStreetMap's one-request-a-second
limit, and fills the gap. Rows that already have an address are left alone -
what a reviewer may already have seen is not replaced.

Safe to re-run. `place` is derived from the hashed coordinates and is not part
of the hash chain; the script verifies the chain before and after rather than
asking you to take that on trust.
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent / "api"
sys.path.insert(0, str(API))
os.chdir(API)

from sqlalchemy import select  # noqa: E402

from db import SessionLocal  # noqa: E402
from models import Evidence  # noqa: E402
from services.chain import verify_chain  # noqa: E402
from services.evidence_notes import clean_place, format_place  # noqa: E402
from services.geocode import reverse  # noqa: E402


def main() -> int:
    db = SessionLocal()
    try:
        rows = db.scalars(select(Evidence).order_by(Evidence.id)).all()
        mines = sorted({r.mine_id for r in rows})

        def chains():
            return {
                m: verify_chain(db.scalars(
                    select(Evidence).where(Evidence.mine_id == m).order_by(Evidence.id)
                ).all())[0]
                for m in mines
            }

        before = chains()
        filled = 0
        for ev in rows:
            if ev.place:
                continue
            place = clean_place(reverse(ev.lat, ev.lon))
            if place:
                ev.place = place
                filled += 1
                print(f"  #{ev.id:<3} {format_place(place)}")
            else:
                print(f"  #{ev.id:<3} no address found at {ev.lat:.5f}, {ev.lon:.5f}")
        db.commit()

        after = chains()
        print(f"  filled {filled}; chain "
              + ", ".join(f"mine {m} {'intact' if after[m] else 'BROKEN'}" for m in mines))
        return 0 if before == after else 1
    finally:
        db.close()


if __name__ == "__main__":
    raise SystemExit(main())
