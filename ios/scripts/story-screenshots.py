#!/usr/bin/env python3
"""The story App Store screenshots: five slides that read as one strip, in an ink-and-paper
style. Free live radio in your hand; no ads; stations from everywhere; built by a music
lover for music lovers; that's why it's free.

Inputs: the raw simulator captures in Screenshots/story/raw/{iphone,ipad} (capture with
HIFI_SHOTS_RAW=Screenshots/story/raw scripts/capture-screenshots.sh) and the ink drawings in
Screenshots/story/art (scripts/story-art.py). Output: Screenshots/story/{iphone,ipad}, the
same pixel sizes as the captures (1320x2868 and 2064x2752), plus strip.jpg in each, the
whole run side by side. The Mac set (2880x1800) comes from the window captures in
Screenshots/story/raw/mac (HIFI_SHOTS_RAW=Screenshots/story/raw scripts/mac-screenshots.sh).
Run as: python3 ios/scripts/story-screenshots.py [iphone] [ipad] [mac] Needs Pillow. Light work; fine on the mini.
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

# The copy, in order. Each headline is lines of (text, mark); mark is None, "circle" or "strike".
SLIDES = [
    {"raw": "1-main", "head": [[("Free", "circle"), (" live radio", None)], [("in the palm", None)], [("of your hand.", None)]],
     "sub": "115 stations, live, from all over the world."},
    {"raw": "2-tv", "head": [[("No ", None), ("ads.", "strike")], [("No sign-up.", None)], [("Just music.", None)]],
     "sub": "HIFI never plays an ad of its own. Press play and it plays."},
    {"raw": "3-radio", "head": [[("From Seattle", None)], [("to Sydney", None)], [("to ", None), ("Lagos.", "under")]],
     "sub": "Listener-supported favorites and the big hit stations of 36 countries."},
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

    # 4. The music lover, the person behind it.
    x0 = 3 * W
    if not tablet:
        lover = load_art("lover", round(2150 * s))
        ink(strip, lover, (x0 + (W - lover.width) // 2, H - lover.height + round(80 * s)))
        spot = (x0 + W - round(W * 0.42), tops[3] + round(H * 0.02))
    else:  # below the subline, to the right, the note in the space to its left
        lover = load_art("lover", H - tops[3] + round(H * 0.01))
        ink(strip, lover, (x0 + W - lover.width + round(W * 0.06), tops[3] - round(H * 0.02)))
        spot = (x0 + margin, tops[3] + round(H * 0.16))
    note(strip, "made with love\n— Nate", spot, round(64 * s) if not tablet else round(80 * s), angle=-6)

    # 5. The crate of records and the app, playing.
    x0 = 4 * W
    crate = load_art("crate", round(1500 * s))
    ink(strip, crate, (x0 - round(crate.width * 0.2), H - crate.height + round(60 * s)))
    ph = phone(shots["4-live"], round(W * 0.48 if not tablet else W * 0.46))
    lifted(strip, ph, (x0 + W - ph.width - round(W * 0.09), tops[4] + round(H * 0.06)), angle=-4)
    note(strip, "all 115 stations,\nall free", (x0 + round(W * 0.06), tops[4] + round(H * 0.08)), round(70 * s), angle=-5)
    arrow(strip, [(x0 + round(W * 0.2), tops[4] + round(H * 0.17)), (x0 + round(W * 0.28), tops[4] + round(H * 0.23)),
                  (x0 + round(W * 0.42), tops[4] + round(H * 0.25))], round(9 * s), 51)

    out = STORY / kind
    out.mkdir(parents=True, exist_ok=True)
    for i, slide in enumerate(SLIDES):
        strip.crop((i * W, 0, (i + 1) * W, H)).save(out / f"{i + 1}.png", optimize=True)
    preview = strip.resize((strip.width * 900 // H, 900), Image.LANCZOS)
    preview.save(out / "strip.jpg", quality=88)
    print("rendered", kind, W, "x", H)


# The Mac set: the same five beats, landscape. The first headline says Mac, not hand.
MAC_FIRST = [[("Free", "circle"), (" live radio", None)], [("on your desk.", None)]]


def window(raw, height):
    """The captured Mac window (its own corners and traffic lights), scaled."""
    w = raw.convert("RGBA")
    return w.resize((round(w.width * height / w.height), height), Image.LANCZOS)


def render_mac():
    raw_dir = STORY / "raw" / "mac"
    shots = {p.stem: Image.open(p) for p in raw_dir.glob("*.png")}
    W, H = 2880, 1800
    N = len(SLIDES)
    strip = Image.new("RGB", (W * N, H), PAPER)
    head, sub, margin = 168, 50, 180
    tops = []
    for i, slide in enumerate(SLIDES):
        slide = dict(slide, head=MAC_FIRST) if i == 0 else slide
        top = 300
        y = headline(strip, slide, i * W + margin, top, head, 1300, seed=i * 10)
        y = subline(strip, slide["sub"], i * W + margin, y + 40, sub, 1050)
        tops.append(y)
    wh = 1520
    # 1. Home in the window, the dancer beside it.
    dancer = load_art("dancer", 1020)
    ink(strip, dancer, (margin + 60, H - dancer.height + 40))
    win = window(shots["1-main"], wh)
    lifted(strip, win, (W - win.width - 200, (H - win.height) // 2), shadow=0.3)
    # 2. Now Playing, and what HIFI does not do, crossed out.
    x0 = W
    win = window(shots["2-tv"], wh)
    lifted(strip, win, (x0 + W - win.width - 260, (H - win.height) // 2), shadow=0.3)
    for j, (text, small, angle, fx, fy) in enumerate([("COMMERCIAL BREAK", "back after these messages", 5, 260, 1050),
                                                       ("SIGN UP TO LISTEN", "create an account to continue", -4, 1050, 1250)]):
        st = sticker(600, text, small).rotate(angle, resample=Image.BICUBIC, expand=True)
        lifted(strip, st, (x0 + fx, fy))
        cross(strip, (x0 + fx + 40, fy + 20, x0 + fx + st.width - 40, fy + st.height - 20), 17, 21 + j)
    # 3. The Radio list, stations flying out of it.
    x0 = 2 * W
    win = window(shots["3-radio"], wh)
    wx = x0 + W - win.width - 700
    lifted(strip, win, (wx, (H - win.height) // 2), shadow=0.3)
    for j, (name, place, color) in enumerate(stations_for_cards()[:5]):
        c = card(640, name, place, "LIVE", color)
        lifted(strip, c.rotate((-1) ** j * 3, resample=Image.BICUBIC, expand=True),
               (wx + win.width - 220 + (j % 2) * 140, 260 + j * round(c.height * 1.3)))
    # 4. The music lover.
    x0 = 3 * W
    lover = load_art("lover", 1750)
    ink(strip, lover, (x0 + W - lover.width - 200, H - lover.height + 40))
    note(strip, "made with love\n\u2014 Nate", (x0 + margin + 40, tops[3] + 120), 70, angle=-6)
    # 5. The crate and the app, playing.
    x0 = 4 * W
    crate = load_art("crate", 950)
    ink(strip, crate, (x0 + 420, H - crate.height + 30))
    win = window(shots["4-live"], wh)
    lifted(strip, win, (x0 + W - win.width - 200, (H - win.height) // 2), shadow=0.3)
    note(strip, "all 115 stations,\nall free", (x0 + margin + 40, tops[4] + 140), 76, angle=-5)
    out = STORY / "mac"
    out.mkdir(parents=True, exist_ok=True)
    for i in range(N):
        strip.crop((i * W, 0, (i + 1) * W, H)).save(out / f"{i + 1}.png", optimize=True)
    strip.resize((strip.width * 600 // H, 600), Image.LANCZOS).save(out / "strip.jpg", quality=88)
    print("rendered mac", W, "x", H)


for kind in sys.argv[1:] or ("iphone", "ipad", "mac"):
    render_mac() if kind == "mac" else render(kind)
