"""YOLOv8n on evidence photos. Detection, not description.

YOLO gives a countable, thresholdable detection — "person, 0.91". The on-device
model gives the sentence about what is wrong. Different jobs.

Weights download on first use (~6 MB). Cache before travelling.
Ultralytics is AGPL — fine for a hackathon demo. Swap for NanoDet or E4B-vision
if this ever ships closed-source.
"""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from config import settings

CONF = 0.35

# Honest scope: COCO gives people and machinery. It does not give helmets.
# Do not claim PPE detection unless a hard-hat model is actually loaded.
INTEREST = {"person", "truck", "car", "bus", "train", "motorcycle", "backpack"}


@lru_cache(maxsize=1)
def _model():
    from ultralytics import YOLO

    return YOLO(settings.vision_model)


def screen_photo(path: Path) -> dict:
    """Run detection. Never raises — vision must not block evidence capture."""
    try:
        model = _model()
        results = model.predict(str(path), conf=CONF, verbose=False)
    except Exception as exc:  # noqa: BLE001
        return {"pass": None, "detections": [], "error": str(exc)}

    detections = []
    for r in results:
        names = r.names
        for box in r.boxes:
            label = names[int(box.cls)]
            detections.append({"label": label, "conf": round(float(box.conf), 3)})

    people = [d for d in detections if d["label"] == "person"]

    return {
        # `pass` means "nothing here needs a human to look twice", not "compliant".
        "pass": True,
        "detections": detections,
        "people": len(people),
        "scope": "COCO pretrained — people and machinery only, no PPE detection",
    }
