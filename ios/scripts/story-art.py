#!/usr/bin/env python3
"""Generates the ink illustrations for the story screenshots (story-screenshots.py) with
xAI's image model, one JPEG per entry in ART, into the folder given (skips ones already there).
Run on the mini: keys run --only GROK_API_KEY -- python3 -I ios/scripts/story-art.py <dir> [id,id]
"""
import base64, json, os, sys, urllib.request, urllib.error

STYLE = (" Loose editorial ink illustration: confident black brush-pen lines, a little dry-brush texture, "
         "flat fills in a single cobalt blue (#2f5bff) and nothing else, pure white background, generous empty space. "
         "Hand-drawn, warm, playful, like a New Yorker spot illustration. No text, no letters, no logos.")
# id: (aspect ratio, prompt)
ART = {
    "hand": ("3:4", "A right hand seen from the front holding a modern smartphone upright, the whole phone fully in view, "
            "centered, the phone screen is one solid flat pure green (#00ff00) rectangle with nothing on it, the sleeve "
            "of a cobalt blue sweater at the wrist, thumb resting on the side of the phone."),
    "hand-tablet": ("3:4", "A right hand seen from the front holding a tablet computer upright in portrait, the whole tablet "
            "fully in view and centered, thin black bezel, the tablet screen is one solid flat pure green (#00ff00) rectangle "
            "with nothing on it, the thumb over the left edge of the tablet, fingers behind it, the cuff of a cobalt blue "
            "sweater at the wrist at the bottom."),
    "lover": ("3:4", "A music lover with messy curly hair and big over-ear headphones, eyes closed, smiling, hugging an armful "
             "of vinyl records to the chest, a cobalt blue sweater, seen from the waist up, a few little music notes floating."),
    "crate": ("4:3", "A wooden crate full of vinyl records seen from the side, a few records pulled half out, one sleeve cobalt blue, "
             "a small transistor radio with a long antenna sitting on top of the crate."),
    "dancer": ("3:4", "A person dancing alone in a small kitchen with eyes closed and arms loose, a phone in one hand, "
              "cobalt blue sweater, a few music notes in the air, full figure."),
}
MODEL = os.environ.get("MODEL", "grok-imagine-image")
out = sys.argv[1]
only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
os.makedirs(out, exist_ok=True)
for key, (aspect, prompt) in ART.items():
    path = os.path.join(out, key + ".jpg")
    if (only and key not in only) or os.path.exists(path):
        continue
    body = {"model": MODEL, "prompt": prompt + STYLE, "n": 1, "aspect_ratio": aspect,
            "resolution": "2k", "response_format": "b64_json"}
    req = urllib.request.Request("https://api.x.ai/v1/images/generations", data=json.dumps(body).encode(), method="POST",
                                 headers={"Authorization": "Bearer " + os.environ["GROK_API_KEY"],
                                          "Content-Type": "application/json", "User-Agent": "hifi-story/1"})
    try:
        with urllib.request.urlopen(req, timeout=180) as r:
            data = json.load(r)["data"][0]
    except urllib.error.HTTPError as e:
        print(key, "HTTP", e.code, e.read()[:300]); continue
    raw = base64.b64decode(data["b64_json"])
    open(path, "wb").write(raw)
    print(key, "ok", len(raw))
