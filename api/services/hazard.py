"""Threshold breach detection. Rolling mean + z-score against a static table.

NO MODEL HERE, AND THAT IS THE POINT. A statutory safety alert cannot depend on
a probabilistic system. Detection is arithmetic; only the wording of the alert
is AI, and that happens on-device afterwards.

Do not reach for an LSTM.
"""

from __future__ import annotations

import json
import statistics
from pathlib import Path

SEED = Path(__file__).parent.parent / "seed" / "mines.json"
THRESHOLDS: dict[str, dict] = json.loads(SEED.read_text(encoding="utf-8"))[
    "sensor_thresholds"
]

Z_TRIGGER = 3.0      # standard deviations above the window mean
MIN_SAMPLES = 12     # below this a z-score is meaningless

# The rising-trend trigger only applies once a reading is already approaching
# the statutory limit. Without this floor, ordinary sensor noise well below the
# trigger produces "CRITICAL — methane rising sharply, 0.98%" against a 1.25%
# limit: a compliance alert on a compliant reading. That is worse than no
# alert, because it teaches the officer to ignore the ones that matter.
APPROACH_FRACTION = 0.75


def threshold_for(sensor_type: str) -> dict | None:
    t = THRESHOLDS.get(sensor_type)
    return t if isinstance(t, dict) else None


def evaluate(sensor_type: str, values: list[float]) -> dict:
    """Return the window statistics and whether it breaches.

    Two triggers, either is enough:
      1. absolute — latest value crosses the statutory threshold
      2. relative — latest value is Z_TRIGGER sigma above the window mean AND
         has already reached APPROACH_FRACTION of the threshold. Both halves
         are required: the sigma test alone fires on noise, and noise at half
         the statutory limit is not a hazard.
    """
    cfg = threshold_for(sensor_type)
    if not cfg or not values:
        return {
            "mean": 0.0, "max": 0.0, "z_max": 0.0,
            "threshold": 0.0, "breaching": False, "reason": None,
        }

    threshold = float(cfg["threshold"])
    latest = values[-1]
    mean = statistics.fmean(values)
    peak = max(values)

    if len(values) >= MIN_SAMPLES:
        sigma = statistics.pstdev(values)
        z = (latest - mean) / sigma if sigma > 1e-9 else 0.0
    else:
        z = 0.0

    over_absolute = latest >= threshold
    over_relative = z >= Z_TRIGGER and latest >= threshold * APPROACH_FRACTION

    reason = None
    if over_absolute:
        reason = "absolute"
    elif over_relative:
        reason = "rising"

    return {
        "mean": round(mean, 3),
        "max": round(peak, 3),
        "z_max": round(z, 2),
        "threshold": threshold,
        "breaching": bool(over_absolute or over_relative),
        "reason": reason,
        "latest": round(latest, 3),
    }


def alert_message(sensor_type: str, stats: dict, unit: str) -> str:
    """Plain wording. The on-device model elaborates; this must stand alone."""
    cfg = threshold_for(sensor_type) or {}
    label = sensor_type.replace("_", " ")
    latest = stats.get("latest", stats.get("max", 0))

    if stats.get("reason") == "absolute":
        return (
            f"{label} {latest}{unit} exceeds the {cfg.get('threshold')}{unit} "
            f"trigger"
        )
    return (
        f"{label} rising sharply — {latest}{unit}, "
        f"{stats.get('z_max')} sigma above the hour mean "
        f"(trigger {cfg.get('threshold')}{unit})"
    )
