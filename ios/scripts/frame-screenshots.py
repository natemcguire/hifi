#!/usr/bin/env python3
"""Turns the raw simulator captures in Screenshots/raw/{iphone,ipad} into App Store
screenshots in Screenshots/{iphone,ipad}: a headline on a colored backdrop with the
app's screen in a rounded frame below. Same pixel sizes as the captures, so App
Store Connect takes them as-is. Needs Pillow.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter, ImageFont

SHOTS = Path(__file__).parent.parent / "Screenshots"
FONT = "/System/Library/Fonts/SFNS.ttf"

# name: (headline, subline, top color, bottom color)
SLIDES = {
    "1-main": ("Little radio.\nVery big mood.", "Free, listener-supported radio on a click wheel.", "#2b2d42", "#11121c"),
    "2-tv": ("Radio with\nthe TV on.", "Every station plays its own old-TV clips, under clear glass.", "#3a5bd9", "#1d2a73"),
    "3-radio": ("Free radio,\nlistener supported.", "Live from Radio Paradise and SomaFM, straight from the stations.", "#e5484d", "#9b1c2a"),
    "4-live": ("Heart it.\nKeep it.", "Tap the heart and the song lands in your Spotify Liked Songs.", "#1db954", "#0d6b30"),
    "5-synth": ("Original synth\nstations.", "Made by us, for working, coding and drifting off.", "#7b4fd6", "#3b1f7a"),
    "6-connect": ("Free. No ads.\nNo account.", "Spotify is optional. The radio just plays.", "#f2a33a", "#b5601a"),
}


def font(size, weight):
    f = ImageFont.truetype(FONT, size)
    f.set_variation_by_name(weight)
    return f


def gradient(size, top, bottom):
    w, h = size
    a, b = Image.new("RGB", (1, 1), top).getpixel((0, 0)), Image.new("RGB", (1, 1), bottom).getpixel((0, 0))
    column = Image.new("RGB", (1, h))
    for y in range(h):
        t = y / (h - 1)
        column.putpixel((0, y), tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3)))
    return column.resize((w, h))


def wrap(draw, text, face, width):
    words, lines, line = text.split(), [], ""
    for word in words:
        trial = (line + " " + word).strip()
        if draw.textlength(trial, font=face) <= width or not line:
            line = trial
        else:
            lines.append(line)
            line = word
    return lines + [line]


def frame(raw, out, slide):
    headline, subline, top, bottom = slide
    shot = Image.open(raw).convert("RGB")
    W, H = shot.size
    tablet = W / H > 0.6
    canvas = gradient((W, H), top, bottom)
    draw = ImageDraw.Draw(canvas)

    # Headline and subline, centered at the top.
    big = font(round(W * (0.085 if tablet else 0.105)), "Heavy")
    small = font(round(W * (0.03 if tablet else 0.04)), "Medium")
    y = round(H * 0.06)
    for line in headline.split("\n"):
        draw.text((W / 2, y), line, font=big, fill="white", anchor="ma")
        y += round(big.size * 1.08)
    y += round(H * 0.012)
    for line in wrap(draw, subline, small, W * (0.92 if tablet else 0.82)):
        draw.text((W / 2, y), line, font=small, fill=(255, 255, 255, 230), anchor="ma")
        y += round(small.size * 1.3)

    # The app's screen, scaled to fit the rest, rounded and lifted with a shadow.
    space_top = y + round(H * 0.035)
    scale = min(0.80 * W / W, (H - space_top - H * 0.02) / H)
    sw, sh = round(W * scale), round(H * scale)
    screen = shot.resize((sw, sh), Image.LANCZOS)
    radius = round(sw * (0.05 if tablet else 0.11))
    mask = Image.new("L", (sw, sh), 0)
    ImageDraw.Draw(mask).rounded_rectangle((0, 0, sw - 1, sh - 1), radius, fill=255)
    x = (W - sw) // 2
    border = round(sw * 0.018)
    shadow = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shadow).rounded_rectangle((x - border, space_top - border + 30, x + sw + border, space_top + sh + border + 30), radius + border, fill=150)
    canvas.paste((0, 0, 0), (0, 0), shadow.filter(ImageFilter.GaussianBlur(40)))
    ImageDraw.Draw(canvas).rounded_rectangle((x - border, space_top - border, x + sw + border, space_top + sh + border), radius + border, fill="#0b0b0f")
    canvas.paste(screen, (x, space_top), mask)
    canvas.save(out, optimize=True)


for kind in ("iphone", "ipad"):
    (SHOTS / kind).mkdir(exist_ok=True)
    for raw in sorted((SHOTS / "raw" / kind).glob("*.png")):
        frame(raw, SHOTS / kind / raw.name, SLIDES[raw.stem])
        print("framed", kind, raw.name)
