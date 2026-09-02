"""Sensor simulator — posts readings to the API every 2 seconds.

    python tools/sensor_sim.py
    python tools/sensor_sim.py --mine 2 --interval 1

Keys while running:
    m   inject a METHANE spike        (demo moment 3)
    s   inject a STRATA convergence spike
    w   inject a WATER level spike
    q   quit

Deliberately not MQTT. MQTT looks impressive and adds a failure point; the demo
is identical either way.
"""

from __future__ import annotations

import argparse
import json
import random
import sys
import threading
import time
from datetime import UTC, datetime
from pathlib import Path

import httpx

THRESHOLDS = json.loads(
    (Path(__file__).parent.parent / "api" / "seed" / "mines.json").read_text(
        encoding="utf-8"
    )
)["sensor_thresholds"]

# baseline (mean, sigma) per sensor — comfortably under threshold
BASELINE = {
    "methane":            (0.62, 0.13, "%"),
    "water_level":        (1.70, 0.22, "m"),
    "strata_convergence": (1.20, 0.35, "mm/24h"),
    "vibration":          (3.10, 0.80, "mm/s"),
    "pm10":               (58.0, 12.0, "ug/m3"),
}

SPIKE_KEYS = {"m": "methane", "s": "strata_convergence", "w": "water_level"}

_spike: dict[str, int] = {}
_stop = threading.Event()


def keyboard_listener() -> None:
    """Windows-friendly keypress loop. Falls back to line input elsewhere."""
    try:
        import msvcrt

        while not _stop.is_set():
            if msvcrt.kbhit():
                ch = msvcrt.getch().decode(errors="ignore").lower()
                handle_key(ch)
            time.sleep(0.05)
    except ImportError:
        for line in sys.stdin:
            if _stop.is_set():
                break
            handle_key(line.strip().lower()[:1])


def handle_key(ch: str) -> None:
    if ch == "q":
        _stop.set()
    elif ch in SPIKE_KEYS:
        sensor = SPIKE_KEYS[ch]
        _spike[sensor] = 6          # ~12 s of elevated readings
        print(f"\n  >> SPIKE INJECTED: {sensor}\n", flush=True)


def reading(mine_id: int, sensor: str) -> dict:
    mean, sigma, unit = BASELINE[sensor]
    value = random.gauss(mean, sigma)

    if _spike.get(sensor, 0) > 0:
        _spike[sensor] -= 1
        thr = THRESHOLDS[sensor]["threshold"]
        value = thr * random.uniform(1.10, 1.45)

    return {
        "mine_id": mine_id,
        "sensor_type": sensor,
        "value": round(max(value, 0.0), 3),
        "unit": unit,
        "recorded_at": datetime.now(UTC).isoformat(),
    }


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", default="http://localhost:8000")
    ap.add_argument("--mine", type=int, default=1)
    ap.add_argument("--interval", type=float, default=2.0)
    args = ap.parse_args()

    print(f"\nsensor_sim -> {args.api}  mine {args.mine}  every {args.interval}s")
    print("  m = methane spike   s = strata spike   w = water spike   q = quit\n")

    threading.Thread(target=keyboard_listener, daemon=True).start()

    sent = fails = 0
    with httpx.Client(timeout=5.0) as client:
        while not _stop.is_set():
            batch = [reading(args.mine, s) for s in BASELINE]
            try:
                r = client.post(
                    f"{args.api}/sensors/readings", json={"readings": batch}
                )
                sent += len(batch)
                fired = []
                if r.status_code < 300:
                    fired = r.json().get("alerts_fired", [])
                line = f"\r  sent {sent}   failed {fails}"
                if fired:
                    refs = ", ".join(a.get("clause_ref", "?") for a in fired)
                    line += f"   ALERT: {refs}        "
                print(line + "   ", end="", flush=True)
            except httpx.HTTPError:
                fails += 1
                print(
                    f"\r  sent {sent}   failed {fails}   (API not up?)   ",
                    end="",
                    flush=True,
                )

            _stop.wait(args.interval)

    print(f"\n\n  stopped. {sent} readings sent, {fails} failures.\n")


if __name__ == "__main__":
    main()
