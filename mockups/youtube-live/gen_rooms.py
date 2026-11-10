# Generates the photoreal room stills for the HIFI Live mockup with xAI grok-imagine-image.
# Usage: keys run --only GROK_API_KEY -- python3 -I mockups/youtube-live/gen_rooms.py <rooms.json> <out-dir> [id,id]
# Skips ids already downloaded. The TV screen is asked for in chroma-key green so the build can
# find it (calibrate.mjs) and the page can put the station's clip there.
import json, os, sys, urllib.request, base64
from concurrent.futures import ThreadPoolExecutor
spec, out = json.load(open(sys.argv[1])), sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else None
MODEL = os.environ.get("MODEL", "grok-imagine-image-2.0")
H = {"Authorization": "Bearer " + os.environ["GROK_API_KEY"], "Content-Type": "application/json", "User-Agent": "hifi-tv/1"}
def run(item):
    path = os.path.join(out, item["id"] + ".jpg")
    if os.path.exists(path): return item["id"], "exists"
    body = {"model": MODEL, "prompt": spec["base"].format(**item) , "n": 1, "aspect_ratio": "4:3", "response_format": "b64_json"}
    req = urllib.request.Request("https://api.x.ai/v1/images/generations", data=json.dumps(body).encode(), headers=H, method="POST")
    with urllib.request.urlopen(req, timeout=300) as r: d = json.load(r)
    img = d["data"][0]
    data = base64.b64decode(img["b64_json"]) if img.get("b64_json") else urllib.request.urlopen(img["url"]).read()
    open(path, "wb").write(data)
    return item["id"], "ok"
def one(item):
    try: return run(item)
    except urllib.error.HTTPError as e: return item["id"], f"HTTP {e.code} {e.read()[:400]!r}"
    except Exception as e: return item["id"], f"error {e}"
os.makedirs(out, exist_ok=True)
items = [i for i in spec["rooms"] if not only or i["id"] in only]
with ThreadPoolExecutor(3) as pool:
    for r in pool.map(one, items): print(*r, flush=True)
