"""Re-run photo screening on evidence already in the database.

    python tools/rescreen_evidence.py            # every photo
    python tools/rescreen_evidence.py --only-bad # only rows with no usable result

Why this exists. Screening runs once, at upload, inside the API process, and
whatever it produced was kept. On this laptop that was often not a result:
rows carry "[WinError 4551] An Application Control policy has blocked this
file" (Windows Smart App Control refusing a PyTorch DLL) and "operator
torchvision::nms does not exist" (a torch / torchvision version mismatch), and
several photos were never screened at all. And every row screened before
problem detection existed says `pass: true` by construction.

Safe to run at any time. vision_result is derived from the stored photo and is
NOT part of the hash chain - the chain covers the photo's bytes, not what a
detector said about them - so rewriting it cannot break verification. The
script checks that claim at the end instead of asking you to trust it.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

API = Path(__file__).resolve().parent.parent / "api"
sys.path.insert(0, str(API))
# The API resolves its settings - the YOLO weights path, the storage directory
# - relative to api/. Run from anywhere else and ultralytics does not find
# yolov8n.pt, silently downloads a second copy into the current directory, and
# carries on. Run from the repo root, that is exactly what happened.
os.chdir(API)

from sqlalchemy import select  # noqa: E402

from db import SessionLocal  # noqa: E402
from models import Evidence  # noqa: E402
from services.chain import verify_chain  # noqa: E402
from services.vision import screen_photo  # noqa: E402


def usable(result: dict | None) -> bool:
    return bool(result) and "problems" in result and not result.get("error")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--only-bad", action="store_true",
                    help="skip rows that already have a clean current result")
    args = ap.parse_args()

    db = SessionLocal()
    try:
        rows = db.scalars(select(Evidence).order_by(Evidence.id)).all()
        mines = sorted({r.mine_id for r in rows})
        before = {m: verify_chain(_chain_rows(db, m))[0] for m in mines}

        for ev in rows:
            if not ev.photo_path:
                print(f"  #{ev.id:<3} no photo - written observation, skipped")
                continue
            if args.only_bad and usable(ev.vision_result):
                continue
            path = API / ev.photo_path
            if not path.exists():
                print(f"  #{ev.id:<3} photo file missing at {ev.photo_path}")
                continue

            result = screen_photo(path)
            ev.vision_result = result
            if result["problems"]:
                what = "; ".join(p["text"] for p in result["problems"])
            elif result.get("error"):
                what = f"detector error: {result['error'][:70]}"
            else:
                labels = [d["label"] for d in result["detections"]]
                what = f"usable, detected {labels or 'nothing'}"
            print(f"  #{ev.id:<3} pass={str(result['pass']):<5} {what}")

        db.commit()

        after = {m: verify_chain(_chain_rows(db, m))[0] for m in mines}
        for m in mines:
            print(f"  chain for mine {m}: {'intact' if after[m] else 'BROKEN'}"
                  f" (was {'intact' if before[m] else 'broken'})")
        return 0 if before == after else 1
    finally:
        db.close()


def _chain_rows(db, mine_id: int):
    return db.scalars(
        select(Evidence).where(Evidence.mine_id == mine_id).order_by(Evidence.id)
    ).all()


if __name__ == "__main__":
    raise SystemExit(main())
