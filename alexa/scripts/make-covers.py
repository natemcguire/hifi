#!/usr/bin/env python3
"""Cover art for the Echo Show and the skill's store icons.

Draws the same cover the app draws (app.js coverPNG): a dark gradient, three bars in the
station colour, the name and the genre. On the Echo Show the cover also carries a dark strip
along the bottom with a left and a right arrow and "Next or Back to change stations", so it is
plain from across the room that the stations change. Writes alexa/assets/covers/<id>.png at
512x512 (the player's art), alexa/assets/backgrounds/<id>.png at 1280x800 (the player's
background, which the Echo Show fills the screen with) and the skill icons from the app icon.
    python3 alexa/scripts/make-covers.py
"""
import json, pathlib
from PIL import Image, ImageDraw, ImageFont

root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'alexa/assets'
for folder in ('covers', 'backgrounds'): (out / folder).mkdir(parents=True, exist_ok=True)
catalog = json.loads((root / 'stations.json').read_text())

def font(size, bold=True):
    for path in (['/System/Library/Fonts/Supplemental/Arial Bold.ttf'] if bold else ['/System/Library/Fonts/Supplemental/Arial.ttf']) + ['/System/Library/Fonts/Helvetica.ttc']:
        try: return ImageFont.truetype(path, size)
        except OSError: pass
    return ImageFont.load_default()

def fit(draw, text, size, max_width, bold=True):
    while size > 8:
        f = font(size, bold)
        if draw.textlength(text, font=f) <= max_width: return f
        size -= 1
    return font(size, bold)

def rgb(hex_color):
    h = hex_color.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))

HINT = 'Next or Back to change stations'
STRIP, INK = (0x0b, 0x0d, 0x0f), (255, 255, 255)

def gradient(w, h):
    im = Image.new('RGB', (w, h))
    top, bottom = (0x3d, 0x47, 0x4e), (0x1b, 0x20, 0x24)
    d = ImageDraw.Draw(im)
    for y in range(h):
        t = y / (h - 1); d.line([(0, y), (w, y)], fill=tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3)))
    return im

def arrows(d, x0, x1, cy, size):
    """A filled left arrow at x0 and a right arrow ending at x1, each size high, centred on cy."""
    w = size * 0.8
    d.polygon([(x0, cy), (x0 + w, cy - size / 2), (x0 + w, cy + size / 2)], fill=INK)
    d.polygon([(x1, cy), (x1 - w, cy - size / 2), (x1 - w, cy + size / 2)], fill=INK)
    return w

def cover(s, color):
    """The 512 cover: the bars, name and genre raised, the strip with the arrows below them."""
    S, u = 512, 16  # 32 units, like the app
    im = gradient(S, S); d = ImageDraw.Draw(im)
    for x, y0 in ((6, 7), (14, 3), (22, 5)): d.rectangle([x * u, y0 * u, (x + 4) * u - 1, 14 * u - 1], fill=color)
    d.text((16 * u, 17.6 * u), s['name'], font=fit(d, s['name'], round(2.9 * u), 28 * u), fill=color, anchor='mm')
    genre = s.get('genre', '')
    d.text((16 * u, 20.4 * u), genre, font=fit(d, genre, round(1.5 * u), 28 * u, bold=False), fill=(200, 205, 208), anchor='mm')
    top = 23 * u; d.rectangle([0, top, S, S], fill=STRIP)
    cy = (top + S) / 2
    w = arrows(d, 1.2 * u, S - 1.2 * u, cy, 4.2 * u)
    # The label in two lines between the arrows, as large as the room allows.
    room = S - 2 * (1.2 * u + w + 0.9 * u)
    lines = ('Next or Back', 'to change stations')
    f = fit(d, lines[1], round(2.3 * u), room)
    d.text((S / 2, cy - 0.15 * f.size), lines[0], font=f, fill=INK, anchor='md')
    d.text((S / 2, cy + 0.15 * f.size), lines[1], font=f, fill=INK, anchor='ma')
    return im

def background(s, color):
    """The 1280x800 background: the bars and name on the gradient, the strip with the arrows
    and the label in one line along the bottom."""
    W, H = 1280, 800
    im = gradient(W, H); d = ImageDraw.Draw(im)
    for dx, y0 in ((-170, 190), (0, 90), (170, 150)): d.rectangle([W / 2 + dx - 50, y0, W / 2 + dx + 49, 449], fill=color)
    d.text((W / 2, 545), s['name'], font=fit(d, s['name'], 72, W - 160), fill=color, anchor='mm')
    top = H - 170; d.rectangle([0, top, W, H], fill=STRIP)
    cy = (top + H) / 2
    w = arrows(d, 60, W - 60, cy, 110)
    f = fit(d, HINT, 66, W - 2 * (60 + w + 40))
    d.text((W / 2, cy), HINT, font=f, fill=INK, anchor='mm')
    return im

for s in catalog['stations']:
    if not (s.get('stream') or s.get('tracks')): continue
    color = rgb(s.get('color', '#ffffff'))
    cover(s, color).save(out / 'covers' / f"{s['id']}.png", optimize=True)
    background(s, color).save(out / 'backgrounds' / f"{s['id']}.png", optimize=True)

icon = Image.open(root / 'ios/Resources/Assets.xcassets/AppIcon.appiconset/icon.png').convert('RGB')
for size in (108, 512): icon.resize((size, size), Image.LANCZOS).save(out / f'icon-{size}.png', optimize=True)
print(f"Covers in {out / 'covers'}, backgrounds in {out / 'backgrounds'}, icons icon-108.png and icon-512.png.")
