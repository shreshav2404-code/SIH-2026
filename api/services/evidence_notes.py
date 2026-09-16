"""Turn a capture's annotations into something a reviewer can read.

Pure functions over plain values - no database, no model - so they run on a
CI runner and say exactly what the dashboard will say.

Three jobs:
  clean_*    accept what the phone sends without trusting it
  summarise  one plain sentence for every photo, including old ones
  review     whether a person needs to look, and each reason with its source

The source on every reason matters as much as the reason. "measured" and
"geometry" are arithmetic and can be checked. "model" is the on-device vision
model's reading of the photo - useful, and wrong often enough at 450M
parameters that it must never be presented as a finding of fact.
"""

from __future__ import annotations

import json
import re
from collections import Counter

PLACE_KEYS = ("full", "name", "street", "area", "district", "city", "state",
              "pincode", "country", "source")
MAX_FIELD = 120
# The formatted one-line address runs longer than any single part of it.
MAX_FULL = 240
MAX_PROBLEMS = 5
MAX_PROBLEM_LEN = 200
MAX_DESCRIPTION = 600

# An Indian PIN is six digits and never starts with 0. Anything else is a
# geocoder guess dressed as a pincode, and a wrong PIN on evidence is worse
# than none.
PINCODE = re.compile(r"^[1-9]\d{5}$")


def _loads(raw):
    if raw is None or raw == "":
        return None
    if isinstance(raw, (dict, list)):
        return raw
    try:
        return json.loads(raw)
    except (TypeError, ValueError):
        return None


def clean_place(raw) -> dict | None:
    """Known keys, trimmed strings, and a pincode only if it is a real one."""
    data = _loads(raw)
    if not isinstance(data, dict):
        return None
    out = {}
    for key in PLACE_KEYS:
        value = data.get(key)
        if value is None:
            continue
        value = str(value).strip()[:MAX_FULL if key == "full" else MAX_FIELD]
        if not value:
            continue
        if key == "pincode":
            value = value.replace(" ", "")
            if not PINCODE.match(value):
                continue
        out[key] = value
    # "source" alone is not a place.
    return out if set(out) - {"source"} else None


def clean_problems(raw) -> list[str] | None:
    data = _loads(raw)
    if not isinstance(data, list):
        return None
    out = [str(p).strip()[:MAX_PROBLEM_LEN] for p in data if str(p).strip()]
    return out[:MAX_PROBLEMS] or None


def clean_description(raw) -> str | None:
    if raw is None:
        return None
    text = str(raw).strip()
    return text[:MAX_DESCRIPTION] or None


def format_place(place: dict | None) -> str | None:
    """One line, most specific first: "Gevra Project, Korba, Chhattisgarh 495452".

    Android's own formatted address is used when the phone sent one - it knows
    local address order better than a join of parts does - with the PIN added
    if it was left off.
    """
    if not place:
        return None
    pin = place.get("pincode")
    full = place.get("full")
    if full:
        return full if not pin or pin in full else f"{full} {pin}"
    parts = []
    for key in ("name", "street", "area", "city", "district", "state"):
        value = place.get(key)
        # Geocoders repeat themselves - city and district are often the same.
        if value and value not in parts:
            parts.append(value)
    line = ", ".join(parts)
    if pin:
        line = f"{line} {pin}".strip()
    return line or None


PLURAL = {"person": "people", "bus": "buses", "knife": "knives"}


def _count(label: str, n: int) -> str:
    if n == 1:
        return f"1 {label}"
    return f"{n} {PLURAL.get(label, label + 's')}"


def summarise(vision_result: dict | None, has_photo: bool) -> str:
    """A plain sentence for every capture, built from measurements only.

    This exists because descriptions from the on-device model only arrive for
    captures taken after it was wired in. Every older photo still deserves a
    sentence, and a sentence assembled from counted detections cannot invent
    anything that was not detected.
    """
    if not has_photo:
        return "Written observation only - no photograph attached."
    if not vision_result:
        return "Photograph not screened yet."

    problems = vision_result.get("problems") or []
    if problems:
        first = problems[0]
        return first.get("text", "This photograph cannot be verified.")

    detections = vision_result.get("detections") or []
    if not detections:
        return ("Usable photograph. No people, vehicles or common objects "
                "were detected in it.")

    counts = Counter(d.get("label", "object") for d in detections)
    ordered = sorted(counts.items(), key=lambda kv: (-kv[1], kv[0]))
    items = [_count(label, n) for label, n in ordered]
    if len(items) == 1:
        listed = items[0]
    else:
        listed = ", ".join(items[:-1]) + " and " + items[-1]
    return f"Usable photograph. Detected: {listed}."


def review(
    vision_result: dict | None,
    ai_problems: list[str] | None,
    inside_lease: bool | None,
) -> dict:
    """Does a person need to look at this, and why - each reason with its source."""
    reasons = []
    for p in (vision_result or {}).get("problems") or []:
        text = p.get("text", "")
        if p.get("because"):
            text = f"{text} - {p['because']}"
        reasons.append({"text": text, "source": "measured"})
    if inside_lease is False:
        reasons.append({
            "text": "Captured outside the sanctioned lease boundary",
            "source": "geometry",
        })
    for p in ai_problems or []:
        reasons.append({"text": p, "source": "model"})
    return {"needed": bool(reasons), "reasons": reasons}
