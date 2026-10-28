# Finds an embeddable official YouTube upload for each playlist track.
import json, re, sys, time, unicodedata, urllib.parse, urllib.request
src, out = sys.argv[1], sys.argv[2]
ent = {'trackList': [{'title': t['title'], 'subtitle': t['artist'], 'duration': t['duration'] * 1000, 'uri': t['spotify']} for t in json.load(open(src))]}
UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36'
def get(url):
    req = urllib.request.Request(url, headers={'User-Agent': UA, 'Accept-Language': 'en-US,en;q=0.9'})
    with urllib.request.urlopen(req, timeout=20) as r: return r.status, r.read().decode('utf8', 'replace')
def norm(s):
    s = unicodedata.normalize('NFKD', s).encode('ascii', 'ignore').decode().lower()
    s = re.sub(r'\(feat[^)]*\)|\[feat[^]]*\]|feat\..*$| - .*(mix|remix|edit|version|remaster).*$', '', s)
    return re.sub(r'[^a-z0-9]+', ' ', s).strip()
def secs(t):
    p = [int(x) for x in t.split(':')]; return sum(v * 60 ** i for i, v in enumerate(reversed(p)))
def embeddable(vid):
    try: return get('https://www.youtube.com/oembed?format=json&url=' + urllib.parse.quote(f'https://www.youtube.com/watch?v={vid}'))[0] == 200
    except Exception: return False
import os, threading
from concurrent.futures import ThreadPoolExecutor
cache_path = out + '.cache.json'
cache = json.load(open(cache_path)) if os.path.exists(cache_path) else {}
lock = threading.Lock()
def one(t):
    title, artists, dur = t['title'], t['subtitle'], t['duration'] / 1000
    if t['uri'] in cache: return cache[t['uri']]
    q = f"{artists.split(',')[0]} {re.sub(r' - .*$', '', title)}"
    pick = None
    try:
        for attempt in range(3):
            _, html = get('https://www.youtube.com/results?search_query=' + urllib.parse.quote(q))
            m = re.search(r'var ytInitialData = (\{.*?\});</script>', html, re.S)
            if m: break
            time.sleep(3)
        data = json.loads(m.group(1))
        vids = []
        def walk(o):
            if isinstance(o, dict):
                if 'videoRenderer' in o: vids.append(o['videoRenderer'])
                for v in o.values(): walk(v)
            elif isinstance(o, list):
                for v in o: walk(v)
        walk(data)
        cands = []
        for v in vids[:10]:
            vt = ''.join(r.get('text', '') for r in v.get('title', {}).get('runs', []))
            ch = ''.join(r.get('text', '') for r in v.get('ownerText', {}).get('runs', []))
            lt = v.get('lengthText', {}).get('simpleText')
            if not lt: continue
            d = secs(lt)
            if norm(title).split()[:3] and not all(w in norm(vt) for w in norm(title).split()[:3]): continue
            if abs(d - dur) > 25: continue
            score = (3 if ch.endswith(' - Topic') else 2 if 'VEVO' in ch.upper() or norm(artists.split(',')[0]) in norm(ch) else 0) - abs(d - dur) / 30 - (2 if re.search(r'live|cover|karaoke|lyrics|reaction|slowed|sped', vt, re.I) else 0)
            cands.append((score, v['videoId'], vt, ch, d))
        for c in sorted(cands, reverse=True)[:3]:
            if embeddable(c[1]): pick = c; break
    except Exception as e:
        print('ERR', title, e, file=sys.stderr)
        return None  # not cached: retried on the next run
    r = {'title': title, 'artist': artists, 'spotify': t['uri'], 'duration': round(dur, 3),
         **({'youtube': pick[1], 'ytTitle': pick[2], 'ytChannel': pick[3], 'ytDuration': pick[4]} if pick else {})}
    with lock:
        cache[t['uri']] = r
        json.dump(cache, open(cache_path, 'w'))
    print(f"{'OK ' if pick else '-- '} {artists[:24]:24} {title[:34]:34} {pick[3][:28] if pick else ''}", flush=True)
    time.sleep(0.5)
    return r
with ThreadPoolExecutor(4) as pool:
    results = [r for r in pool.map(one, ent['trackList']) if r]
json.dump(results, open(out, 'w'), indent=1)
print('matched', sum('youtube' in r for r in results), 'of', len(results))
