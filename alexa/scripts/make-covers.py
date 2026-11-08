#!/usr/bin/env python3
"""Cover art for the Echo Show and the skill's store icons.

Draws the same cover the app draws (app.js coverPNG): a dark gradient, three bars in the
station colour, the name and the genre. Writes alexa/assets/covers/<id>.png at 512x512 and
the skill icons from the app icon.
    python3 alexa/scripts/make-covers.py
"""
import json, pathlib
from PIL import Image, ImageDraw, ImageFont

root = pathlib.Path(__file__).resolve().parents[2]
out = root / 'alexa/assets'
(out / 'covers').mkdir(parents=True, exist_ok=True)
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

S, u = 512, 16  # 32 units, like the app
for s in catalog['stations']:
    if not (s.get('stream') or s.get('tracks')): continue
    im = Image.new('RGB', (S, S))
    top, bottom = (0x3d, 0x47, 0x4e), (0x1b, 0x20, 0x24)
    px = im.load()
    for y in range(S):
        t = y / (S - 1); c = tuple(round(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        for x in range(S): px[x, y] = c
    d = ImageDraw.Draw(im)
    color = rgb(s.get('color', '#ffffff'))
    for x, y0 in ((6, 9), (14, 4), (22, 7)): d.rectangle([x * u, y0 * u, (x + 4) * u - 1, 17 * u - 1], fill=color)
    name_font = fit(d, s['name'], round(2.9 * u), 28 * u)
    d.text((16 * u, 22.2 * u), s['name'], font=name_font, fill=color, anchor='mm')
    genre_font = fit(d, s.get('genre', ''), round(1.5 * u), 28 * u, bold=False)
    d.text((16 * u, 25.2 * u), s.get('genre', ''), font=genre_font, fill=(255, 255, 255, 166), anchor='mm')
    im.save(out / 'covers' / f"{s['id']}.png", optimize=True)

icon = Image.open(root / 'ios/Resources/Assets.xcassets/AppIcon.appiconset/icon.png').convert('RGB')
for size in (108, 512): icon.resize((size, size), Image.LANCZOS).save(out / f'icon-{size}.png', optimize=True)
print(f"Covers in {out / 'covers'}, icons icon-108.png and icon-512.png.")
