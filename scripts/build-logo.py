"""Turn brand/logo-source.png into the assets the app needs.

Run with `python3 scripts/build-logo.py` after changing the source artwork.

The source is dark ink on an opaque white card. Three things have to happen:
  1. the white has to become transparent, or the logo sits in a white box on the
     dark theme;
  2. the icon and the wordmark need different treatments — the icon has white
     *inside* it (the face) that must stay, so its background is flood-filled
     from the corners rather than keyed by colour;
  3. the wordmark's navy end is invisible on a dark background, so a second
     variant lifts its lightness while keeping the hue.
"""

import colorsys
import pathlib
from PIL import Image, ImageDraw
import numpy as np

SRC = str(pathlib.Path(__file__).parent.parent / 'brand' / 'logo-source.png')
OUT = str(pathlib.Path(__file__).parent.parent / 'public')

# Measured from the source: the first wide column gap separates the two parts.
ICON_BOX = (97, 370, 406, 680)
WORD_BOX = (475, 370, 1371, 680)

im = Image.open(SRC).convert('RGB')


def unpremultiply_white(rgb: np.ndarray) -> np.ndarray:
    """Key an opaque white background out of anti-aliased artwork.

    A pixel is `ink * a + white * (1 - a)`. The darkest channel gives `a`, and
    the original ink colour follows — which keeps edges smooth instead of the
    ragged cut a plain threshold would leave.
    """
    a = 1.0 - rgb.min(axis=2) / 255.0
    out = np.zeros(rgb.shape[:2] + (4,), dtype=np.uint8)
    safe = a > 0.004
    ink = np.zeros_like(rgb, dtype=float)
    ink[safe] = (rgb[safe] - 255.0 * (1 - a[safe])[:, None]) / a[safe][:, None]
    out[..., :3] = np.clip(ink, 0, 255).astype(np.uint8)
    out[..., 3] = np.clip(a * 255, 0, 255).astype(np.uint8)
    return out


def icon_rgba() -> Image.Image:
    """The icon, with only the outside-the-rounded-square white removed."""
    icon = im.crop(ICON_BOX).convert('RGBA')
    w, h = icon.size
    a = np.asarray(icon).astype(int)
    near_white = a[..., :3].min(axis=2) > 232

    # Flood fill from the four corners so the white face inside survives.
    seen = np.zeros((h, w), bool)
    stack = [(0, 0), (0, w - 1), (h - 1, 0), (h - 1, w - 1)]
    while stack:
        y, x = stack.pop()
        if not (0 <= y < h and 0 <= x < w) or seen[y, x] or not near_white[y, x]:
            continue
        seen[y, x] = True
        stack.extend([(y + 1, x), (y - 1, x), (y, x + 1), (y, x - 1)])

    px = np.asarray(icon).copy()
    px[seen, 3] = 0
    return Image.fromarray(px, 'RGBA')


def wordmark_rgba(lighten: bool) -> Image.Image:
    word = np.asarray(im.crop(WORD_BOX)).astype(float)
    rgba = unpremultiply_white(word)
    if not lighten:
        return Image.fromarray(rgba, 'RGBA')

    # Keep the hue, raise the lightness: navy becomes periwinkle, purple lilac.
    rgb = rgba[..., :3].astype(float) / 255.0
    flat = rgb.reshape(-1, 3)
    out = np.empty_like(flat)
    for i, (r, g, b) in enumerate(flat):
        hue, light, sat = colorsys.rgb_to_hls(r, g, b)
        out[i] = colorsys.hls_to_rgb(hue, 0.70 + 0.25 * light, min(1.0, sat * 1.1))
    rgba[..., :3] = np.clip(out.reshape(rgb.shape) * 255, 0, 255).astype(np.uint8)
    return Image.fromarray(rgba, 'RGBA')


def lockup(lighten: bool, height: int) -> Image.Image:
    icon = icon_rgba()
    word = wordmark_rgba(lighten)
    gap = WORD_BOX[0] - ICON_BOX[2]
    canvas = Image.new('RGBA', (icon.width + gap + word.width, icon.height), (0, 0, 0, 0))
    canvas.paste(icon, (0, 0), icon)
    canvas.paste(word, (icon.width + gap, 0), word)
    scale = height / canvas.height
    return canvas.resize(
        (round(canvas.width * scale), height), Image.LANCZOS
    )


def maskable(size: int) -> Image.Image:
    """Full-bleed variant for Android, which crops icons to its own shape."""
    icon = icon_rgba()
    # Sample the gradient's two ends from inside the rounded square.
    a = np.asarray(icon)
    top = a[int(icon.height * 0.12), int(icon.width * 0.5)][:3]
    bottom = a[int(icon.height * 0.88), int(icon.width * 0.5)][:3]

    bg = Image.new('RGB', (size, size))
    draw = ImageDraw.Draw(bg)
    for y in range(size):
        t = y / (size - 1)
        draw.line(
            [(0, y), (size, y)],
            fill=tuple(round(top[c] + (bottom[c] - top[c]) * t) for c in range(3)),
        )

    inner = round(size * 0.62)
    face = icon.resize((inner, inner), Image.LANCZOS)
    out = bg.convert('RGBA')
    out.paste(face, ((size - inner) // 2, (size - inner) // 2), face)
    return out


icon = icon_rgba()
for name, size in [
    ('icons/icon-512.png', 512),
    ('icons/icon-192.png', 192),
    ('icons/apple-touch-icon.png', 180),
    ('icons/favicon-32.png', 32),
]:
    icon.resize((size, size), Image.LANCZOS).save(f'{OUT}/{name}')

maskable(512).save(f'{OUT}/icons/icon-maskable-512.png')
def slim(img: Image.Image, path: str) -> None:
    """A logo is not a photograph: a small palette costs nothing visible and
    turns 50 kB of gradient into under 10 kB."""
    img.quantize(colors=192, method=Image.FASTOCTREE).save(path, optimize=True)


slim(icon.resize((128, 128), Image.LANCZOS), f'{OUT}/logo-mark.png')
slim(lockup(False, 96), f'{OUT}/logo-lockup.png')
slim(lockup(True, 96), f'{OUT}/logo-lockup-dark.png')

print('mark', icon.size)
print('lockup', lockup(False, 96).size)
