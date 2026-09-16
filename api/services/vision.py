"""Screen an evidence photo: is it usable, and what is in it. No model judgement.

Two deterministic layers, and neither one decides compliance:

  1. photo_quality - can this photograph prove anything at all? Too dark,
     blank, too blurred. Arithmetic on pixels, calibrated on this project's
     own evidence store. See services/photo_quality.py.
  2. YOLOv8n - what objects are in it, with WHERE as well as what. The box is
     kept so the dashboard can draw it on the photo; a label and a confidence
     with nothing to point at is a claim a reviewer cannot check.

What the photo MEANS - whether it shows the duty being done, what looks
unsafe - is language work, and the on-device model does it at capture time.
The backend runs no language model; that line is the project's.

`pass` used to be hardcoded True. It could not fail, and three of the eight
photographs in the evidence store - a flat colour and two black frames - had
been stored as passing. It is now False exactly when the photo cannot be
verified, and `problems` says why in words.

Weights download on first use (~6 MB). Cache before travelling.
Ultralytics is AGPL - fine for a hackathon demo. Swap for NanoDet if this ever
ships closed-source.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from config import settings
from services.photo_quality import (
    MAX_DARK_FRACTION,
    MIN_CONTRAST,
    MIN_SHARPNESS,
    PROBLEM_TEXT,
    check_photo,
)

CONF = 0.35

# Honest scope: COCO gives people and machinery. It does not give helmets.
# Do not claim PPE detection unless a hard-hat model is actually loaded.
SCOPE = "COCO pretrained - people, vehicles and common objects. No PPE detection."


@lru_cache(maxsize=1)
def _model():
    from ultralytics import YOLO

    return YOLO(settings.vision_model)


def _detect(path: Path) -> tuple[list[dict], str | None]:
    """YOLO detections with normalised boxes. Never raises."""
    try:
        results = _model().predict(str(path), conf=CONF, verbose=False)
    except Exception as exc:  # noqa: BLE001
        return [], str(exc)

    detections = []
    for r in results:
        names = r.names
        h, w = r.orig_shape
        for box in r.boxes:
            x1, y1, x2, y2 = (float(v) for v in box.xyxy[0])
            detections.append({
                "label": names[int(box.cls)],
                "conf": round(float(box.conf), 3),
                # 0-1 of the image, so the dashboard can draw it at any size
                # without knowing the resolution the phone uploaded.
                "box": [round(x1 / w, 4), round(y1 / h, 4),
                        round(x2 / w, 4), round(y2 / h, 4)],
            })
    detections.sort(key=lambda d: d["conf"], reverse=True)
    return detections, None


def explain(quality: dict) -> list[dict]:
    """Each problem as a sentence, with the measurement that caused it.

    "Too dark" on its own is an assertion. "99.7% of the frame is near-black,
    against a limit of 85%" is something a reviewer can check against the
    photo in front of them, which is the difference between a verdict and an
    explanation.
    """
    m = quality.get("metrics") or {}
    why = {
        "too_dark": lambda: (
            f"{m['dark_fraction'] * 100:.1f}% of the frame is near-black "
            f"(limit {MAX_DARK_FRACTION * 100:.0f}%)"),
        "blank": lambda: (
            f"brightness varies by only {m['contrast']} across the whole frame "
            f"(a real scene measures well above {MIN_CONTRAST:.0f})"),
        "too_blurry": lambda: (
            f"sharpness measures {m['sharpness']} "
            f"(a usable photo measures above {MIN_SHARPNESS:.0f})"),
        "unreadable": lambda: quality.get("error") or "not a decodable image",
    }
    out = []
    for code in quality.get("problems", []):
        try:
            because = why[code]()
        except (KeyError, TypeError):
            because = None
        out.append({"code": code, "text": PROBLEM_TEXT.get(code, code),
                    "because": because, "source": "measured"})
    return out


def screen_photo(path: Path) -> dict:
    """Quality check plus detection. Never raises - screening must not block capture."""
    quality = check_photo(path)
    problems = explain(quality)

    # No point asking what is in a photo that has nothing in it. It also keeps
    # a black frame from reporting "no people" as if that were a finding.
    if problems:
        detections, det_error = [], None
    else:
        detections, det_error = _detect(path)

    result = {
        # False exactly when the photo cannot be verified. Not "non-compliant":
        # a sharp, well-lit photo of the wrong thing still passes here, and it
        # is the on-device description that says so.
        "pass": not problems,
        "problems": problems,
        "metrics": quality.get("metrics"),
        "detections": detections,
        "people": sum(1 for d in detections if d["label"] == "person"),
        "scope": SCOPE,
    }
    if det_error:
        result["error"] = det_error
    return result
