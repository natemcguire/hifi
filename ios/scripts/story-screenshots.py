#!/usr/bin/env python3
"""The story App Store screenshots: six slides that read as one strip, in an ink-and-paper
style. Free live radio in your hand; no ads; stations from everywhere; your own country's
stations in your own language, still free; built by a music lover for music lovers; that's
why it's free. The station and country counts come from stations.json.

Inputs: the raw simulator captures in Screenshots/story/raw/{iphone,ipad} (capture with
HIFI_SHOTS_RAW=Screenshots/story/raw scripts/capture-screenshots.sh) and the ink drawings in
Screenshots/story/art (scripts/story-art.py). Output: Screenshots/story/{iphone,ipad}, the
same pixel sizes as the captures (1320x2868 and 2064x2752), plus strip.jpg in each, the
whole run side by side.
Run as: python3 ios/scripts/story-screenshots.py [iphone] [ipad] Needs Pillow. Light work; fine on the mini.
"""
import json, math, random, sys
from pathlib import Path
from PIL import Image, ImageChops, ImageDraw, ImageFilter, ImageFont

STORY = Path(__file__).parent.parent / "Screenshots" / "story"
STATIONS = Path(__file__).parent.parent.parent / "stations.json"
SERIF, SERIF_IT = "/System/Library/Fonts/NewYork.ttf", "/System/Library/Fonts/NewYorkItalic.ttf"
SANS = "/System/Library/Fonts/SFNS.ttf"
HAND = "/System/Library/Fonts/Supplemental/Bradley Hand Bold.ttf"

PAPER = (246, 241, 231)
INK = (23, 23, 26)
BLUE = (47, 91, 255)
MUTED = (96, 92, 86)

# The counts in the copy, from the catalog the apps read.
_CATALOG = json.loads(STATIONS.read_text())["stations"]
TOTAL = len(_CATALOG)
WORLD = sum(1 for x in _CATALOG if x.get("country"))
COUNTRIES = len({x["country"] for x in _CATALOG if x.get("country")})

# The copy, in order. Each headline is lines of (text, mark); mark is None, "circle" or "strike".
SLIDES = [
    {"raw": "1-main", "head": [[("Free", "circle"), (" live radio", None)], [("in the palm", None)], [("of your hand.", None)]],
     "sub": f"{TOTAL} stations, live, from all over the world."},
    {"raw": "2-tv", "head": [[("No ", None), ("ads.", "strike")], [("No sign-up.", None)], [("Just music.", None)]],
     "sub": "HIFI never plays an ad of its own. Press play and it plays."},
    {"raw": "3-radio", "head": [[("From Seattle", None)], [("to Sydney", None)], [("to ", None), ("Lagos.", "under")]],
     "sub": f"Listener-supported favorites and the big hit stations of {COUNTRIES} countries."},
    {"raw": "7-world", "head": [[("Your country.", None)], [("Your language.", None)], [("Still ", None), ("free.", "circle")]],
     "sub": f"{WORLD} stations from {COUNTRIES} countries, each country its own row, in its own language."},
    {"raw": None, "head": [[("Built by a", None)], [("music lover,", None)], [("for ", None), ("music lovers.", "under")]],
     "sub": "Made by one person who loves radio, not by an ad company."},
    {"raw": "4-live", "head": [[("That’s why", None)], [("it’s ", None), ("free.", "circle")]],
     "sub": "No account. No ads. No catch. Just good radio."},
]


def serif(size, weight="Semibold", italic=False):
    f = ImageFont.truetype(SERIF_IT if italic else SERIF, size)
    f.set_variation_by_name(weight + (" Italic" if italic else ""))
    return f


def sans(size, weight="Medium"):
    f = ImageFont.truetype(SANS, size)
    f.set_variation_by_name(weight)
    return f


def wobble(points, rnd, amount):
    return [(x + rnd.uniform(-amount, amount), y + rnd.uniform(-amount, amount)) for x, y in points]


def pen(draw, points, width, color=BLUE):
    """A marker stroke: a polyline with round joins and caps."""
    draw.line(points, fill=color, width=width, joint="curve")
    r = width / 2
    for x, y in (points[0], points[-1]):
        draw.ellipse((x - r, y - r, x + r, y + r), fill=color)


def scribble_circle(draw, box, width, seed):
    """A hand-drawn loop around box: a bit more than one turn, slightly off."""
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    cx, cy, rx, ry = (x0 + x1) / 2, (y0 + y1) / 2, (x1 - x0) / 2, (y1 - y0) / 2
    start, tilt = rnd.uniform(2.6, 3.4), rnd.uniform(-0.06, 0.06)
    pts = []
    for i in range(121):
        t = start + i / 120 * 2 * math.pi * 1.12
        grow = 1 + 0.06 * i / 120
        x, y = rx * grow * math.cos(t), ry * grow * math.sin(t)
        pts.append((cx + x * math.cos(tilt) - y * math.sin(tilt), cy + x * math.sin(tilt) + y * math.cos(tilt)))
    pen(draw, wobble(pts, rnd, width * 0.12), width)


def scribble_strike(draw, box, width, seed):
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    ym = (y0 + y1) / 2
    pen(draw, wobble([(x0 - width, ym + width * 0.8), (x1 + width, ym - width * 0.6)], rnd, 2), width)
    pen(draw, wobble([(x0, ym - width * 0.4), ((x0 + x1) / 2, ym + width * 0.3), (x1 + width * 0.5, ym - width * 1.2)], rnd, 2), round(width * 0.8))


def scribble_under(draw, box, width, seed):
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    pts = [(x0 + (x1 - x0) * i / 40, y1 + width * 0.6 + math.sin(i / 40 * math.pi * 3) * width * 0.35) for i in range(41)]
    pen(draw, wobble(pts, rnd, 1.5), width)


def headline(canvas, slide, x, y, size, width, seed):
    """Draws the headline at (x, y) left-aligned, with its marks; returns the bottom y."""
    draw = ImageDraw.Draw(canvas)
    face = serif(size)
    marks = []
    for line in slide["head"]:
        cx = x
        for text, mark in line:
            w = draw.textlength(text, font=face)
            if mark:
                l, t, r, b = draw.textbbox((cx, y), text.strip(), font=face, anchor="la")
                lead = draw.textlength(text[: len(text) - len(text.lstrip())], font=face)
                marks.append((mark, (l + lead, t, r + lead, b)))
            draw.text((cx, y), text, font=face, fill=INK, anchor="la")
            cx += w
        y += round(size * 1.06)
    stroke = max(6, round(size * 0.07))
    for i, (mark, (l, t, r, b)) in enumerate(marks):
        pad = size * 0.16
        if mark == "circle":
            hw, hh = (r - l) / 2 * 1.16 + pad * 0.6, (b - t) / 2 * 1.32 + pad * 0.5
            cx, cy = (l + r) / 2, (t + b) / 2
            scribble_circle(draw, (cx - hw, cy - hh, cx + hw, cy + hh), stroke, seed + i)
        elif mark == "strike":
            scribble_strike(draw, (l, t, r, b), stroke, seed + i)
        elif mark == "under":
            scribble_under(draw, (l, t, r, b), stroke, seed + i)
    return y


def subline(canvas, text, x, y, size, width):
    draw = ImageDraw.Draw(canvas)
    face = sans(size)
    words, line = text.split(), ""
    for word in words:
        trial = (line + " " + word).strip()
        if draw.textlength(trial, font=face) > width and line:
            draw.text((x, y), line, font=face, fill=MUTED, anchor="la")
            y += round(size * 1.32)
            line = word
        else:
            line = trial
    draw.text((x, y), line, font=face, fill=MUTED, anchor="la")
    return y + round(size * 1.32)


def ink(canvas, art, box_xy):
    """Lays an ink drawing on the paper by multiplying, so its white disappears."""
    x, y = box_xy
    region = (max(0, x), max(0, y), min(canvas.width, x + art.width), min(canvas.height, y + art.height))
    if region[2] <= region[0] or region[3] <= region[1]:
        return
    under = canvas.crop(region)
    piece = art.crop((region[0] - x, region[1] - y, region[2] - x, region[3] - y))
    canvas.paste(ImageChops.multiply(under, piece), region[:2])


def load_art(name, height):
    art = Image.open(STORY / "art" / f"{name}.jpg").convert("RGB")
    w = round(art.width * height / art.height)
    art = art.resize((w, height), Image.LANCZOS)
    if height > 2368:  # scaled up: crisp the ink edges back
        art = art.filter(ImageFilter.UnsharpMask(radius=2, percent=120, threshold=2))
    return art


def hand_with_screen(shot, height, name="hand"):
    """The hand drawing holding the app: the green screen replaced by the capture."""
    art = load_art(name, height)
    px = art.load()
    mask = Image.new("L", art.size, 0)
    mp = mask.load()
    for yy in range(0, art.height):
        for xx in range(0, art.width):
            r, g, b = px[xx, yy]
            if g > 150 and r < 140 and b < 140 and g - max(r, b) > 60:
                mp[xx, yy] = 255
    box = mask.getbbox()
    mask = mask.filter(ImageFilter.MaxFilter(5))
    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = max(bw / shot.width, bh / shot.height)
    screen = shot.resize((round(shot.width * scale), round(shot.height * scale)), Image.LANCZOS)
    left = (screen.width - bw) // 2
    screen = screen.crop((left, 0, left + bw, bh))
    layer = art.copy()
    layer.paste(screen, box[:2], mask.crop(box))
    return layer, mask


def phone(shot, width):
    """The capture in a plain black phone body, the way the reference draws its devices."""
    h = round(shot.height * width / shot.width)
    screen = shot.resize((width, h), Image.LANCZOS)
    radius = round(width * 0.12)
    bezel = round(width * 0.035)
    body = Image.new("RGBA", (width + 2 * bezel, h + 2 * bezel), (0, 0, 0, 0))
    d = ImageDraw.Draw(body)
    d.rounded_rectangle((0, 0, body.width - 1, body.height - 1), radius + bezel, fill=INK)
    m = Image.new("L", screen.size, 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, width - 1, h - 1), radius, fill=255)
    body.paste(screen, (bezel, bezel), m)
    return body


def lifted(canvas, item, xy, angle=0, shadow=0.22):
    """Pastes an RGBA item, rotated, with a soft paper shadow."""
    if angle:
        item = item.rotate(angle, resample=Image.BICUBIC, expand=True)
    x, y = xy
    blur = max(item.width, item.height) // 30
    sh = Image.new("L", (canvas.width, canvas.height), 0)
    alpha = item.split()[3].point(lambda a: round(a * shadow))
    sh.paste(alpha, (x + blur // 2, y + blur), alpha)
    sh = sh.filter(ImageFilter.GaussianBlur(blur))
    canvas.paste((60, 50, 40), (0, 0), sh)
    canvas.paste(item, (x, y), item)


def card(width, title, line, tag, color):
    """A station row pulled out of the Radio list, as a little paper card."""
    h = round(width * 0.27)
    c = Image.new("RGBA", (width, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    r = round(h * 0.2)
    d.rounded_rectangle((0, 0, width - 1, h - 1), r, fill=(255, 255, 255, 255))
    dot = round(h * 0.34)
    d.ellipse((round(h * 0.26), (h - dot) // 2, round(h * 0.26) + dot, (h + dot) // 2), fill=color)
    tx = round(h * 0.26) + dot + round(h * 0.2)
    d.text((tx, round(h * 0.24)), title, font=sans(round(h * 0.26), "Semibold"), fill=INK, anchor="la")
    d.text((tx, round(h * 0.58)), line, font=sans(round(h * 0.18), "Regular"), fill=MUTED, anchor="la")
    tf = sans(round(h * 0.15), "Bold")
    tw = d.textlength(tag, font=tf)
    px, py = width - round(h * 0.22) - tw - round(h * 0.18), round(h * 0.36)
    d.rounded_rectangle((px, py, px + tw + round(h * 0.36), py + round(h * 0.28)), round(h * 0.14), fill=(232, 238, 255))
    d.text((px + round(h * 0.18), py + round(h * 0.14)), tag, font=tf, fill=BLUE, anchor="lm")
    return c


def sticker(width, text, small):
    """A torn-off 'what other apps do' label, to be crossed out."""
    h = round(width * 0.36)
    c = Image.new("RGBA", (width, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    d.rounded_rectangle((0, 0, width - 1, h - 1), round(h * 0.16), fill=(255, 255, 255, 255), outline=INK, width=max(3, h // 60))
    big = sans(round(h * 0.2), "Heavy")
    while d.textlength(text, font=big) > width * 0.86:
        big = sans(big.size - 2, "Heavy")
    d.text((width // 2, round(h * 0.38)), text, font=big, fill=INK, anchor="mm")
    d.text((width // 2, round(h * 0.68)), small, font=sans(round(h * 0.12), "Regular"), fill=MUTED, anchor="mm")
    return c


def cross(canvas, box, width, seed):
    d = ImageDraw.Draw(canvas)
    rnd = random.Random(seed)
    x0, y0, x1, y1 = box
    pen(d, wobble([(x0, y0), ((x0 + x1) / 2, (y0 + y1) / 2 + 6), (x1, y1)], rnd, 4), width)
    pen(d, wobble([(x1, y0 + 10), ((x0 + x1) / 2 + 8, (y0 + y1) / 2), (x0 + 6, y1 - 4)], rnd, 4), width)


def note(canvas, text, xy, size, angle=-4):
    """Handwriting in blue, slightly tilted."""
    f = ImageFont.truetype(HAND, size)
    d0 = ImageDraw.Draw(canvas)
    lines = text.split("\n")
    w = max(d0.textlength(l, font=f) for l in lines) + size
    h = round(size * 1.25 * len(lines)) + size // 2
    layer = Image.new("RGBA", (round(w), h), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i, l in enumerate(lines):
        d.text((size // 4, round(i * size * 1.25)), l, font=f, fill=BLUE + (255,))
    layer = layer.rotate(angle, resample=Image.BICUBIC, expand=True)
    canvas.paste(layer, xy, layer)
    return layer.size


def arrow(canvas, pts, width, seed):
    d = ImageDraw.Draw(canvas)
    rnd = random.Random(seed)
    pts = wobble(pts, rnd, 2)
    pen(d, pts, width)
    (x0, y0), (x1, y1) = pts[-2], pts[-1]
    a = math.atan2(y1 - y0, x1 - x0)
    for side in (-1, 1):
        b = a + math.pi + side * 0.5
        pen(d, [(x1, y1), (x1 + math.cos(b) * width * 5, y1 + math.sin(b) * width * 5)], width)


def stations_for_cards():
    """(name as the app shows it, where, color) for the cards, only stations in stations.json."""
    data = {x["id"]: x for x in json.loads(STATIONS.read_text())["stations"]}
    picks = [("kexp", "KEXP", "Seattle"), ("triple-j", "triple j", "Sydney"), ("cool-fm", "Cool FM", "Lagos"),
             ("1live", "1LIVE", "Cologne"), ("radio-paradise", "Radio Paradise", "California")]
    return [(name, place, data[sid].get("color") or "#2f5bff") for sid, name, place in picks if sid in data]


# Hello in the languages the world stations speak, each with a real station in stations.json:
# (greeting, script, station id, the station as it's known, city).
HELLOS = [("Bonjour", "latin", "nrj", "NRJ", "Paris"), ("Hallo", "latin", "1live", "1LIVE", "Cologne"),
          ("Hola", "latin", "los40", "LOS40", "Madrid"), ("Ciao", "latin", "radio-105", "Radio 105", "Milan"),
          ("Olá", "latin", "antena-1", "Antena 1", "São Paulo"), ("Hej", "latin", "sr-p3", "P3", "Stockholm"),
          ("Merhaba", "latin", "power-turk", "Power Türk", "Istanbul"), ("שלום", "hebrew", "galgalatz", "Galgalatz", "Tel Aviv"),
          ("สวัสดี", "thai", "cool-fahrenheit", "Cool Fahrenheit", "Bangkok"), ("Kumusta", "latin", "love-radio", "Love Radio", "Manila"),
          ("Cześć", "latin", "rmf-fm", "RMF FM", "Kraków"), ("Halo", "latin", "prambors", "Prambors", "Jakarta"),
          ("Hoi", "latin", "qmusic", "Qmusic", "Amsterdam"), ("مرحبا", "arabic", "hit-radio", "Hit Radio", "Rabat"),
          ("Moi", "latin", "ylex", "YleX", "Helsinki"), ("Hei", "latin", "nrk-p3", "NRK P3", "Oslo")]


def hello_face(script, size):
    if script == "hebrew":
        f = ImageFont.truetype("/System/Library/Fonts/SFHebrew.ttf", size)
        f.set_variation_by_name("Bold")
        return f
    if script == "thai":
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/Thonburi.ttc", size, index=1)
    if script == "arabic":
        return ImageFont.truetype("/System/Library/Fonts/Supplemental/GeezaPro.ttc", size, index=1)
    return serif(size, "Bold", italic=True)


def hellos():
    """The HELLOS whose station is still in the catalog."""
    ids = {x["id"] for x in _CATALOG}
    return [(g, sc, name, city) for g, sc, sid, name, city in HELLOS if sid in ids]


def bubble(height, greeting, script, station, city, tail_left=True):
    """A speech bubble on paper: the hello big in blue, the station and city small under it."""
    gf = hello_face(script, round(height * 0.4))
    lf = sans(round(height * 0.15), "Semibold")
    d0 = ImageDraw.Draw(Image.new("RGB", (1, 1)))
    label = f"{station} · {city}"
    w = round(max(d0.textlength(greeting, font=gf), d0.textlength(label, font=lf)) + height * 0.6)
    tail = round(height * 0.22)
    c = Image.new("RGBA", (w, height + tail), (0, 0, 0, 0))
    d = ImageDraw.Draw(c)
    line = max(3, height // 45)
    tx = round(w * (0.26 if tail_left else 0.74))
    d.polygon([(tx - tail * 0.6, height - line * 2), (tx + tail * 0.5, height - line * 2), (tx - tail * 0.2 * (1 if tail_left else -1) - tail * 0.5, height + tail - line)],
              fill=(255, 255, 255, 255), outline=INK, width=line)
    d.rounded_rectangle((0, 0, w - 1, height - 1), round(height * 0.3), fill=(255, 255, 255, 255), outline=INK, width=line)
    d.line([(tx - tail * 0.6 + line, height - line), (tx + tail * 0.5 - line, height - line)], fill=(255, 255, 255, 255), width=line * 2)
    d.text((w // 2, round(height * 0.42)), greeting, font=gf, fill=BLUE, anchor="mm")
    d.text((w // 2, round(height * 0.78)), label, font=lf, fill=MUTED, anchor="mm")
    return c


def render(kind):
    raw_dir = STORY / "raw" / kind
    shots = {p.stem: Image.open(p).convert("RGB") for p in raw_dir.glob("*.png")}
    W, H = next(iter(shots.values())).size
    tablet = W / H > 0.6
    N = len(SLIDES)
    strip = Image.new("RGB", (W * N, H), PAPER)
    # Element scale: the iPhone layout is the design; the iPad keeps it about as tall.
    s = min(W / 1320, H / 2868) if not tablet else H / 2868 * 1.02
    margin = round(W * (0.075 if not tablet else 0.08))
    head = round(150 * W / 1320) if not tablet else round(215 * H / 2752)
    sub = round(head * 0.3)
    tops = []
    for i, slide in enumerate(SLIDES):
        x0 = i * W
        y = headline(strip, slide, x0 + margin, round(H * 0.06), head, W - 2 * margin, seed=i * 10)
        y = subline(strip, slide["sub"], x0 + margin, y + round(head * 0.25), sub, W - 2 * margin)
        tops.append(y)

    # 1. The hand holding the app's home screen, big.
    # the tablet drawing's screen is 0.47 of its height: size it so screen and hand fit under the headline
    art_h = round(3300 * s) if not tablet else round((H - tops[0] - H * 0.2) / 0.47)
    layer, mask = hand_with_screen(shots["1-main"], art_h, "hand-tablet" if tablet else "hand")
    box = mask.getbbox()
    ax = round(W / 2 - (box[0] + box[2]) / 2)
    ay = tops[0] + round(H * 0.04) - box[1]
    ink(strip, layer, (ax, ay))
    # the screenshot itself must not be multiplied with the paper: paste it straight
    strip.paste(layer.crop(box), (ax + box[0], ay + box[1]), mask.crop(box))

    # 2. Now Playing on a commercial-free station; the things HIFI does not do, crossed out.
    x0 = W
    ph = phone(shots["2-tv"], round(W * 0.56 if not tablet else W * 0.5))
    lifted(strip, ph, (x0 + W - ph.width - round(W * 0.1), tops[1] + round(H * 0.05)), angle=-4)
    for j, (text, small, angle, fx, fy) in enumerate([("COMMERCIAL BREAK", "back after these messages", 6, 0.04, 0.30),
                                                       ("SIGN UP TO LISTEN", "create an account to continue", -5, 0.10, 0.50)]):
        st = sticker(round(640 * s), text, small).rotate(angle, resample=Image.BICUBIC, expand=True)
        sx, sy = x0 + round(W * fx), tops[1] + round(H * fy)
        lifted(strip, st, (sx, sy))
        cross(strip, (sx + 40 * s, sy + 20 * s, sx + st.width - 40 * s, sy + st.height - 20 * s), round(17 * s), 21 + j)

    # 3. The Radio list, with stations flying out of it across the seam into slide 4.
    x0 = 2 * W
    ph = phone(shots["3-radio"], round(W * 0.56 if not tablet else W * 0.5))
    px, py = x0 + round(W * 0.07), tops[2] + round(H * 0.05)
    lifted(strip, ph, (px, py), angle=3)
    cw = round(660 * s) if not tablet else round(W * 0.38)
    for j, (name, place, color) in enumerate(stations_for_cards()[:5]):
        c = card(cw, name, place, "LIVE", color)
        cx = min(x0 + round(W * 0.5) + (j % 2) * round(W * 0.12), x0 + W - c.width - round(W * 0.04))
        cy = tops[2] + round(H * 0.08) + j * round(c.height * 1.32)
        lifted(strip, c.rotate((-1) ** j * 3, resample=Image.BICUBIC, expand=True), (cx, cy))

    # 4. Your country, your language: the Radio list on its country rows, kept clear; the hellos
    # sit on the phone's top corners and in staggered rows over the click wheel below the list.
    x0 = 3 * W
    ph = phone(shots["7-world"], round(W * (0.6 if not tablet else 0.5)))
    bezel = (ph.width - round(W * (0.6 if not tablet else 0.5))) // 2
    phx, phy = x0 + (W - ph.width) // 2, tops[3] + round(H * 0.045)
    lifted(strip, ph, (phx, phy))
    list_end = phy + bezel + round((ph.height - 2 * bezel) * (0.44 if not tablet else 0.55))
    greet = hellos()
    bh = round(185 * s)
    rnd = random.Random(7)
    made = [bubble(bh, g, sc, name, city, tail_left=k % 2 == 0) for k, (g, sc, name, city) in enumerate(greet)]
    made = [m.rotate(rnd.uniform(-5, 5), resample=Image.BICUBIC, expand=True) for m in made]
    # the two corners: half off the phone, over its top bezel and status bar
    lifted(strip, made[0], (phx - round(made[0].width * 0.45), phy - round(made[0].height * 0.35)), shadow=0.18)
    lifted(strip, made[1], (phx + ph.width - round(made[1].width * 0.55), phy - round(made[1].height * 0.25)), shadow=0.18)
    # rows under the list, as many as fit, each row spread across the page
    y, k, row = list_end + round(H * 0.03), 2, 0
    while k < len(made):
        fit, width = [], 0
        while k + len(fit) < len(made) and width + made[k + len(fit)].width <= W * 0.98 and len(fit) < (3 if row % 2 == 0 else 2):
            width += made[k + len(fit)].width
            fit.append(made[k + len(fit)])
        tallest = max(m.height for m in fit)
        if y + tallest > H - round(H * 0.012):
            break
        gap = (W - width) / (len(fit) + 1)
        bx = x0 + gap
        for m in fit:
            lifted(strip, m, (round(bx), y + rnd.randint(-round(H * 0.006), round(H * 0.006))), shadow=0.18)
            bx += m.width + gap
        k += len(fit)
        y += round(tallest * 0.96)
        row += 1

    # 5. The music lover, the person behind it.
    x0 = 4 * W
    if not tablet:
        lover = load_art("lover", round(2150 * s))
        ink(strip, lover, (x0 + (W - lover.width) // 2, H - lover.height + round(80 * s)))
        spot = (x0 + W - round(W * 0.42), tops[4] + round(H * 0.02))
    else:  # below the subline, to the right, the note in the space to its left
        lover = load_art("lover", H - tops[4] + round(H * 0.01))
        ink(strip, lover, (x0 + W - lover.width + round(W * 0.06), tops[4] - round(H * 0.02)))
        spot = (x0 + margin, tops[4] + round(H * 0.16))
    note(strip, "made with love\n— Nate", spot, round(64 * s) if not tablet else round(80 * s), angle=-6)

    # 6. The crate of records and the app, playing.
    x0 = 5 * W
    crate = load_art("crate", round(1500 * s))
    ink(strip, crate, (x0 - round(crate.width * 0.2), H - crate.height + round(60 * s)))
    ph = phone(shots["4-live"], round(W * 0.48 if not tablet else W * 0.46))
    lifted(strip, ph, (x0 + W - ph.width - round(W * 0.09), tops[5] + round(H * 0.06)), angle=-4)
    note(strip, f"all {TOTAL} stations,\nall free", (x0 + round(W * 0.06), tops[5] + round(H * 0.08)), round(70 * s), angle=-5)
    arrow(strip, [(x0 + round(W * 0.2), tops[5] + round(H * 0.17)), (x0 + round(W * 0.28), tops[5] + round(H * 0.23)),
                  (x0 + round(W * 0.42), tops[5] + round(H * 0.25))], round(9 * s), 51)

    out = STORY / kind
    out.mkdir(parents=True, exist_ok=True)
    for i, slide in enumerate(SLIDES):
        strip.crop((i * W, 0, (i + 1) * W, H)).save(out / f"{i + 1}.png", optimize=True)
    preview = strip.resize((strip.width * 900 // H, 900), Image.LANCZOS)
    preview.save(out / "strip.jpg", quality=88)
    print("rendered", kind, W, "x", H)


for kind in sys.argv[1:] or ("iphone", "ipad"):
    render(kind)
