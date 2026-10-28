# Builds a public playlist on the Nate's Software channel from a list of video ids,
# in order, picking up where it left off. Each insert costs 50 of the 10,000 daily
# quota units, so a long list takes a few days: it stops cleanly when the quota runs out.
# usage: yt_playlist.py <spec.json>   spec: {"title", "description", "videos": [ids]}
import importlib.util, importlib.machinery, json, sys, os
loader = importlib.machinery.SourceFileLoader("nswyt", os.path.expanduser("~/Projects/nsw-youtube/bin/nsw-youtube"))
spec_ = importlib.util.spec_from_loader("nswyt", loader); m = importlib.util.module_from_spec(spec_); loader.exec_module(m)
spec = json.load(open(sys.argv[1]))
pid = m.playlist_id(spec["title"])
m.api("PUT", "playlists", {"part": "snippet,status"}, {"id": pid, "snippet": {"title": spec["title"], "description": spec["description"]}, "status": {"privacyStatus": "public"}})
have, tok = [], None
while True:
    p = {"part": "contentDetails", "playlistId": pid, "maxResults": 50}
    if tok: p["pageToken"] = tok
    r = m.api("GET", "playlistItems", p)
    have += [i["contentDetails"]["videoId"] for i in r.get("items", [])]; tok = r.get("nextPageToken")
    if not tok: break
present, added = set(have), 0
todo = [v for v in spec["videos"] if v not in present]
print(f"playlist {pid}: {len(have)} in, {len(todo)} to add")
for v in todo:
    try:
        m.api("POST", "playlistItems", {"part": "snippet"}, {"snippet": {"playlistId": pid, "resourceId": {"kind": "youtube#video", "videoId": v}}})
        added += 1
    except m.YTError as e:
        if e.reason in ("quotaExceeded", "rateLimitExceeded") or e.status == 403 and "quota" in str(e).lower():
            print("quota used up for today"); break
        print("skipped", v, e)
print(f"added {added}; {len(have) + added} of {len(spec['videos'])} now in https://www.youtube.com/playlist?list={pid}")
if len(have) + added >= len([v for v in spec["videos"]]): print("DONE")
