"""Photo usability checks - the part of "problem detection" that is arithmetic.

Built from a measured failure: three of the eight photographs in this
project's evidence store could not prove anything - one flat colour, one
black frame with only a timestamp showing, one fully black - and every one had
been screened and stored as `pass: True`, because the old check could not fail.

Synthetic images rather than stored photos, so these run on a CI runner with
no evidence store and pin the thresholds rather than one camera's output.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from services.photo_quality import (  # noqa: E402
    PROBLEM_TEXT,
    check_photo,
    measure,
    problems_from,
)


def scene(seed: int = 0) -> np.ndarray:
    """A textured, well-lit frame: edges, gradients and noise, like a real scene."""
    rng = np.random.default_rng(seed)
    h, w = 480, 640
    y, x = np.mgrid[0:h, 0:w]
    base = 90 + 60 * np.sin(x / 23.0) * np.cos(y / 31.0)
    blocks = ((x // 40 + y // 40) % 2) * 40
    noise = rng.normal(0, 12, (h, w))
    grey = np.clip(base + blocks + noise, 0, 255).astype(np.uint8)
    return np.dstack([grey, grey, grey])


def test_a_real_looking_scene_has_no_problems():
    assert problems_from(measure(scene())) == []


def test_black_frame_is_too_dark_not_blank():
    """The 5.jpg case. Flat AND black, and "too dark" is the fixable cause."""
    black = np.zeros((480, 640, 3), np.uint8)
    assert problems_from(measure(black)) == ["too_dark"]


def test_lamp_off_scene_is_too_dark():
    """The 3.jpg case: a real scene with almost no light on it."""
    dim = (scene() * 0.08).astype(np.uint8)
    assert problems_from(measure(dim)) == ["too_dark"]


def test_flat_fill_is_blank():
    """The 2.jpg case: one RGB value across the whole frame."""
    flat = np.full((480, 640, 3), (145, 129, 113), np.uint8)
    assert problems_from(measure(flat)) == ["blank"]


def test_heavy_blur_is_too_blurry():
    import cv2

    blurred = cv2.GaussianBlur(scene(), (0, 0), 8)
    assert problems_from(measure(blurred)) == ["too_blurry"]


def test_only_one_problem_is_reported():
    """Every failure also trips the checks after it; reporting all of them
    buries the one the officer can act on."""
    for img in (np.zeros((480, 640, 3), np.uint8),
                np.full((480, 640, 3), 200, np.uint8)):
        assert len(problems_from(measure(img))) == 1


def test_resolution_does_not_change_the_verdict():
    """Measured at a fixed edge, so a 4000 px camera and a 640 px one agree."""
    import cv2

    small = scene()
    large = cv2.resize(small, (2560, 1920), interpolation=cv2.INTER_CUBIC)
    assert problems_from(measure(small)) == problems_from(measure(large)) == []


def test_unreadable_file_is_a_problem_not_an_exception(tmp_path):
    bad = tmp_path / "not-a-photo.jpg"
    bad.write_bytes(b"this is not a jpeg")
    result = check_photo(bad)
    assert result["problems"] == ["unreadable"]


def test_every_problem_code_has_words():
    """The dashboard shows the sentence, never the code."""
    for code in ("blank", "too_dark", "too_blurry", "unreadable"):
        assert PROBLEM_TEXT[code]
