# Generates short clips with xAI grok-imagine-video from a JSON list of {"id", "prompt"}; skips ids already downloaded.
import json, os, sys, time, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
spec, out = json.load(open(sys.argv[1])), sys.argv[2]
only = set(sys.argv[3].split(',')) if len(sys.argv) > 3 and sys.argv[3] else None
MODEL = os.environ.get("MODEL", "grok-imagine-video-1.5-lite")
H = {"Authorization": "Bearer " + os.environ["GROK_API_KEY"], "Content-Type": "application/json", "User-Agent": "hifi-tv/1"}
def call(method, url, body=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None, method=method, headers=H)
    with urllib.request.urlopen(req, timeout=120) as r: return json.load(r)
STYLE = " Shot on a 1980s consumer VHS camcorder: soft focus, washed-out colors, slight tape wobble. No text, no logos, no captions."
def run(item):
    path = os.path.join(out, item["id"] + ".mp4")
    if os.path.exists(path): return item["id"], "exists"
    job = call("POST", "https://api.x.ai/v1/videos/generations", {"model": MODEL, "prompt": item["prompt"] + STYLE, "duration": 6, "aspect_ratio": "1:1", "resolution": "480p"})
    rid = job.get("request_id") or job.get("id")
    if not rid: return item["id"], f"no id {job}"
    for _ in range(200):
        st = call("GET", f"https://api.x.ai/v1/videos/{rid}")
        url = (st.get("video") or {}).get("url") or st.get("url")
        if url: break
        if st.get("status") in ("failed", "expired", "error"): return item["id"], f"failed {st}"
        time.sleep(5)
    else: return item["id"], f"timeout {st}"
    urllib.request.urlretrieve(url, path)
    return item["id"], f"ok {st.get('usage') or ''}"
def one(item):
    try: return run(item)
    except urllib.error.HTTPError as e: return item["id"], f"HTTP {e.code} {e.read()[:400]!r}"
    except Exception as e: return item["id"], f"error {e}"
os.makedirs(out, exist_ok=True)
items = [i for i in spec if not only or i["id"] in only]
with ThreadPoolExecutor(3) as pool:
    for r in pool.map(one, items): print(*r, flush=True)
