"""Can this photograph prove anything at all? Arithmetic, not a model.

A capture is evidence only if a person looking at it could verify the duty.
These checks answer the narrower, deterministic question underneath that one:
is there a usable picture here? They do not judge what the picture shows -
that is language work, and the on-device model does it.

Calibrated on the eight photographs in this project's own evidence store,
not chosen in the abstract. Measured on a 640 px greyscale copy:

    photo   brightness  dark px   sharpness   what it was
    1.jpg        99.1     16.4%       749.0   real photo
    6-9          91-122   8-21%     351-541   real photos
    2.jpg       126.0      0.0%         0.0   ONE flat colour, a placeholder
    3.jpg         1.4     99.7%       167.2   black frame, timestamp overlay only
    5.jpg         1.0    100.0%         0.0   fully black

and on the good ones deliberately darkened (99.8-100% dark) and blurred
(sharpness 0.1-4.9). Every one of the three unusable captures had been
screened and marked `pass: True`, because the old check could not fail.

The thresholds sit in the wide gap between those groups rather than at its
edge. Underground photographs will be darker and flatter than these, so a
real site should re-measure before tightening anything.
"""

from __future__ import annotations

from pathlib import Path

# A pixel this dark carries no detail a reviewer could use.
DARK_PIXEL = 30
# Good photos measured at most 20.7% dark pixels; unusable ones at 99.7%.
MAX_DARK_FRACTION = 0.85
# Laplacian variance. Good photos 351-749; blurred copies 0.1-4.9.
MIN_SHARPNESS = 50.0
# Greyscale standard deviation. A real scene varies; a flat fill does not.
MIN_CONTRAST = 4.0
# Everything is measured at this width so scores compare across cameras.
MEASURE_EDGE = 640

PROBLEM_TEXT = {
    "blank": "Blank image - a single flat colour, not a photograph of anything",
    "too_dark": "Too dark to verify - almost nothing in the frame is visible",
    "too_blurry": "Too blurred to verify - no detail a reviewer could check",
    "unreadable": "The file could not be opened as an image",
}


def measure(image) -> dict:
    """Brightness, dark fraction, sharpness and contrast of a BGR image array."""
    import cv2

    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if image.ndim == 3 else image
    h, w = grey.shape[:2]
    scale = MEASURE_EDGE / max(h, w)
    if scale < 1:
        grey = cv2.resize(
            grey, (max(1, int(w * scale)), max(1, int(h * scale))),
            interpolation=cv2.INTER_AREA,
        )
    return {
        "brightness": round(float(grey.mean()), 1),
        "dark_fraction": round(float((grey < DARK_PIXEL).mean()), 3),
        "sharpness": round(float(cv2.Laplacian(grey, cv2.CV_64F).var()), 1),
        "contrast": round(float(grey.std()), 1),
    }


def problems_from(m: dict) -> list[str]:
    """Problem codes for a measurement, the actionable cause first.

    Only one of dark / blank / blurry is reported, because each failure also
    trips the checks after it: a black frame is flat AND unsharp. Reporting
    all three would bury the one thing the officer can fix.

    Dark comes before blank on purpose. 5.jpg is a fully black frame, and it
    IS a single flat colour - but "blank image" does not tell anyone to switch
    the cap lamp on or uncover the lens, and "too dark" does. Blank is kept for
    a flat fill that is not dark, which is what 2.jpg is.
    """
    if m["dark_fraction"] > MAX_DARK_FRACTION:
        return ["too_dark"]
    if m["contrast"] < MIN_CONTRAST:
        return ["blank"]
    if m["sharpness"] < MIN_SHARPNESS:
        return ["too_blurry"]
    return []


def check_photo(path: Path) -> dict:
    """Measure a stored photograph. Never raises - a check must not block capture."""
    try:
        import cv2

        image = cv2.imread(str(path))
        if image is None:
            return {"problems": ["unreadable"], "metrics": None,
                    "error": "the file could not be decoded as an image"}
        m = measure(image)
        return {"problems": problems_from(m), "metrics": m}
    except Exception as exc:  # noqa: BLE001
        return {"problems": [], "metrics": None, "error": str(exc)}
