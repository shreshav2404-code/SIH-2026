"""Generate the app's artwork.

Original, generated here, committed alongside the code that made it. That is
the point: a government-facing compliance tool should not ship photographs
whose provenance and licence nobody can account for, and "we found it online"
is not an answer anyone wants to give a judge. Re-run this and you get exactly
the same files.

    python tools/make_art.py

Palette is taken from the app theme so the artwork and the UI agree.
"""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

OUT_MOBILE = Path(__file__).parent.parent / "mobile" / "assets"
OUT_WEB = Path(__file__).parent.parent / "web" / "src" / "assets"

INK = (15, 41, 66)
HEADER = (18, 49, 79)
ACCENT = (20, 83, 154)
COAL = (26, 30, 36)

# Deterministic: the same seed gives the same grain every run, so a rebuild
# never produces a gratuitous diff.
random.seed(1952)  # the Mines Act


def _lerp(a: tuple[int, ...], b: tuple[int, ...], t: float) -> tuple[int, ...]:
    return tuple(int(round(x + (y - x) * t)) for x, y in zip(a, b))


def _sky(w: int, h: int) -> Image.Image:
    """Vertical gradient, deep blue at the top down to near-black at the seam."""
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(h - 1, 1)
        # Ease the curve so the dark half occupies more of the frame; a linear
        # ramp reads as a washed-out grey through the middle.
        d.line([(0, y), (w, y)], fill=_lerp(HEADER, COAL, t**1.35))
    return img


def _strata(img: Image.Image, top: int) -> None:
    """Geological banding. Coal is a seam between other rock, so it is drawn as
    layers rather than a single flat mass - it is the difference between
    something that reads as a mine and something that reads as a dark box."""
    d = ImageDraw.Draw(img, "RGBA")
    w, h = img.size
    y = top
    band = 0
    while y < h:
        thickness = random.randint(14, 46)
        # Alternate darker coal against lighter overburden.
        base = COAL if band % 2 == 0 else _lerp(COAL, INK, 0.55)
        shade = _lerp(base, (0, 0, 0), random.uniform(0.0, 0.25))

        # A slight dip across the frame; perfectly level strata look synthetic.
        pts = []
        for x in range(0, w + 40, 40):
            wobble = math.sin((x / w) * math.pi * 1.4 + band) * 6
            pts.append((x, y + wobble))
        pts += [(w, h), (0, h)]
        d.polygon(pts, fill=(*shade, 255))
        y += thickness
        band += 1


def _headframe(img: Image.Image, cx: int, base_y: int, scale: float) -> None:
    """A pit headframe in silhouette - the winding tower over a shaft.

    Recognisably mining without being a clip-art pickaxe, and it sits in
    silhouette so it never competes with the text laid over it.
    """
    d = ImageDraw.Draw(img, "RGBA")
    s = scale
    ink = (10, 14, 20, 235)

    tower_h = int(300 * s)
    half = int(52 * s)
    top_y = base_y - tower_h

    # Legs, splayed slightly.
    d.line([(cx - half, base_y), (cx - int(half * 0.45), top_y)], fill=ink, width=max(2, int(7 * s)))
    d.line([(cx + half, base_y), (cx + int(half * 0.45), top_y)], fill=ink, width=max(2, int(7 * s)))

    # Cross-bracing.
    steps = 7
    for i in range(steps):
        t0 = i / steps
        t1 = (i + 1) / steps
        y0 = base_y - tower_h * t0
        y1 = base_y - tower_h * t1
        l0 = cx - half + (half - half * 0.45) * t0
        l1 = cx - half + (half - half * 0.45) * t1
        r0 = cx + half - (half - half * 0.45) * t0
        r1 = cx + half - (half - half * 0.45) * t1
        d.line([(l0, y0), (r1, y1)], fill=ink, width=max(1, int(2.5 * s)))
        d.line([(r0, y0), (l1, y1)], fill=ink, width=max(1, int(2.5 * s)))
        d.line([(l1, y1), (r1, y1)], fill=ink, width=max(1, int(2.5 * s)))

    # Sheave wheel at the head, and the hoist rope running down to the drum.
    r = int(30 * s)
    d.ellipse([cx - r, top_y - r, cx + r, top_y + r], outline=ink, width=max(2, int(6 * s)))
    d.line([(cx, top_y), (cx + int(150 * s), base_y - int(30 * s))], fill=ink, width=max(1, int(3 * s)))
    d.rectangle(
        [cx + int(130 * s), base_y - int(46 * s), cx + int(186 * s), base_y],
        fill=ink,
    )


def _grain(img: Image.Image, strength: int = 7) -> Image.Image:
    """Fine noise. Flat gradients band badly on cheap phone panels, and a
    little grain hides it."""
    w, h = img.size
    noise = Image.new("L", (w, h))
    noise.putdata([random.randint(0, strength * 2) for _ in range(w * h)])
    noise = noise.filter(ImageFilter.GaussianBlur(0.4))
    return Image.blend(img, Image.merge("RGB", (noise, noise, noise)), 0.045)


def build(w: int, h: int) -> Image.Image:
    horizon = int(h * 0.62)
    img = _sky(w, h)
    _strata(img, horizon)
    _headframe(img, int(w * 0.70), horizon + int(h * 0.02), scale=w / 1080 * 1.1)
    _headframe(img, int(w * 0.26), horizon - int(h * 0.01), scale=w / 1080 * 0.62)
    return _grain(img)


def main() -> None:
    OUT_MOBILE.mkdir(parents=True, exist_ok=True)
    OUT_WEB.mkdir(parents=True, exist_ok=True)

    # Portrait, for the phone's sign-in screen.
    build(1080, 1920).save(OUT_MOBILE / "mine-bg.png", optimize=True)
    # Landscape strip, for the dashboard sign-in panel.
    build(1600, 900).save(OUT_WEB / "mine-bg.png", optimize=True)

    for p in (OUT_MOBILE / "mine-bg.png", OUT_WEB / "mine-bg.png"):
        print(f"  {p.relative_to(Path(__file__).parent.parent)}  {p.stat().st_size / 1024:.0f} KB")


if __name__ == "__main__":
    main()
