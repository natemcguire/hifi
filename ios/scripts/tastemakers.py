#!/usr/bin/env python3
"""Nate's Taste Makers: HIFI's external TestFlight group, fed by the landing page.

  setup   creates the group and Apple's beta details, gives it the newest build and
          sends that build to Beta App Review (once per version).
  sync    adds every new signup from the site's D1 table to the group; Apple emails
          each one a TestFlight invite. Run every few minutes by the launch agent
          com.nates-software.hifi-tastemakers on the mini.

Run as: withkeys uv run -q --no-project --with pyjwt --with cryptography python3 ios/scripts/tastemakers.py setup|sync
Needs ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_PATH. The key never leaves this Mac.
"""
import json, os, subprocess, sys, time, urllib.error, urllib.request
import jwt

APP = "6824175373"
GROUP = "Nate's Taste Makers"
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
API = "https://api.appstoreconnect.apple.com"


def token():
    key = open(os.path.expanduser(os.environ["ASC_API_KEY_PATH"])).read()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_API_KEY_ISSUER_ID"], "iat": now, "exp": now + 900, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_API_KEY_ID"]})


TOKEN = token()


def api(method, path, body=None):
    req = urllib.request.Request(API + path, data=json.dumps(body).encode() if body else None, method=method,
                                 headers={"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            data = r.read()
            return json.loads(data) if data else {}
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"{method} {path}: {e.code} {e.read()[:400].decode('utf8', 'replace')}") from None


def group():
    for g in api("GET", f"/v1/apps/{APP}/betaGroups?limit=50")["data"]:
        if g["attributes"]["name"] == GROUP:
            return g["id"]
    return None


def d1(sql):
    out = subprocess.run(["npx", "--no-install", "wrangler", "d1", "execute", "nsw-hifi", "--remote", "--json", "--command", sql],
                         cwd=ROOT, capture_output=True, text=True, check=True).stdout
    return json.loads(out)[0]["results"]


def setup():
    gid = group()
    if not gid:
        gid = api("POST", "/v1/betaGroups", {"data": {"type": "betaGroups", "attributes": {"name": GROUP, "feedbackEnabled": True},
                                                       "relationships": {"app": {"data": {"type": "apps", "id": APP}}}}})["data"]["id"]
        print("group created")
    # What testers read in TestFlight.
    locs = api("GET", f"/v1/apps/{APP}/betaAppLocalizations")["data"]
    attrs = {"description": "HIFI is internet radio on a white click-wheel iPod: live stations, original synth music, "
                            "101X Chillville and HIFI TV. Taste Makers get every new build first.",
             "feedbackEmail": "nate.mcguire@gmail.com", "marketingUrl": "https://hifi.nates-software.com",
             "privacyPolicyUrl": "https://hifi.nates-software.com/privacy"}
    if locs:
        api("PATCH", f"/v1/betaAppLocalizations/{locs[0]['id']}", {"data": {"type": "betaAppLocalizations", "id": locs[0]["id"], "attributes": attrs}})
    else:
        api("POST", "/v1/betaAppLocalizations", {"data": {"type": "betaAppLocalizations", "attributes": {"locale": "en-US", **attrs},
                                                          "relationships": {"app": {"data": {"type": "apps", "id": APP}}}}})
    # Beta App Review's contact: the same one the App Store review has.
    version = api("GET", f"/v1/apps/{APP}/appStoreVersions?limit=1")["data"][0]["id"]
    store = api("GET", f"/v1/appStoreVersions/{version}/appStoreReviewDetail")["data"]["attributes"]
    beta = api("GET", f"/v1/apps/{APP}/betaAppReviewDetail")["data"]
    api("PATCH", f"/v1/betaAppReviewDetails/{beta['id']}", {"data": {"type": "betaAppReviewDetails", "id": beta["id"], "attributes": {
        **{k: store.get(k) for k in ("contactFirstName", "contactLastName", "contactPhone", "contactEmail")},
        "demoAccountRequired": False, "notes": "No sign-in needed. Spin the wheel, press the center button to choose a station."}}})
    # The newest processed build goes to the group and to Beta App Review.
    build = api("GET", f"/v1/builds?filter[app]={APP}&filter[processingState]=VALID&sort=-uploadedDate&limit=1")["data"][0]
    bid = build["id"]
    if build["attributes"].get("usesNonExemptEncryption") is None:
        api("PATCH", f"/v1/builds/{bid}", {"data": {"type": "builds", "id": bid, "attributes": {"usesNonExemptEncryption": False}}})
    notes = api("GET", f"/v1/builds/{bid}/betaBuildLocalizations")["data"]
    what = {"whatsNew": "HIFI TV: every station has its own old-TV clips. 101X Chillville plays on the screen. Next and back change station."}
    if notes:
        api("PATCH", f"/v1/betaBuildLocalizations/{notes[0]['id']}", {"data": {"type": "betaBuildLocalizations", "id": notes[0]["id"], "attributes": what}})
    else:
        api("POST", "/v1/betaBuildLocalizations", {"data": {"type": "betaBuildLocalizations", "attributes": {"locale": "en-US", **what},
                                                            "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
    api("POST", f"/v1/betaGroups/{gid}/relationships/builds", {"data": [{"type": "builds", "id": bid}]})
    try:
        api("POST", "/v1/betaAppReviewSubmissions", {"data": {"type": "betaAppReviewSubmissions",
                                                               "relationships": {"build": {"data": {"type": "builds", "id": bid}}}}})
        print("build", build["attributes"]["version"], "sent to Beta App Review")
    except RuntimeError as e:
        print("Beta App Review:", str(e)[:300])
    print("group ready:", gid)


def sync():
    gid = group()
    if not gid:
        sys.exit("No group yet: run setup first")
    pending = d1("SELECT email FROM tastemakers WHERE invited_at IS NULL ORDER BY created_at LIMIT 100")
    for row in pending:
        email = row["email"]
        try:
            api("POST", "/v1/betaTesters", {"data": {"type": "betaTesters", "attributes": {"email": email},
                                                     "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": gid}]}}}})
            error = None
        except RuntimeError as e:
            # Already a tester (another group or another app): just add them to this group.
            found = api("GET", "/v1/betaTesters?filter[email]=" + urllib.request.quote(email))["data"] if "409" in str(e) else []
            if found:
                api("POST", f"/v1/betaGroups/{gid}/relationships/betaTesters", {"data": [{"type": "betaTesters", "id": found[0]["id"]}]})
                error = None
            else:
                error = str(e)[:300]
        if error:
            d1(f"UPDATE tastemakers SET error = '{error.replace(chr(39), chr(39) * 2)}' WHERE email = '{email.replace(chr(39), chr(39) * 2)}'")
            print("could not add a signup:", error[:120])
        else:
            d1(f"UPDATE tastemakers SET invited_at = {int(time.time() * 1000)}, error = NULL WHERE email = '{email.replace(chr(39), chr(39) * 2)}'")
    print(f"{len(pending)} new signup(s) handled")


{"setup": setup, "sync": sync}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
