#!/usr/bin/env python3
"""Fills in HIFI's App Store listing through the App Store Connect API: category,
name and subtitle, description, keywords, URLs, age rating, free price,
screenshots, review contact, and (with --submit) the build and review submission.

The app record itself must exist first: Apple's API cannot create apps, so it is
made once by hand in App Store Connect (bundle ID com.natesoftware.hifi).

Run as: withkeys <python with pyjwt> ios/scripts/appstore-listing.py [--submit]
Review contact comes from HIFI_REVIEW_FIRST, HIFI_REVIEW_LAST, HIFI_REVIEW_EMAIL and
HIFI_REVIEW_PHONE, or the same keys in scripts/devices.local (never committed).
"""
import hashlib, json, os, sys, time, urllib.request
from pathlib import Path

HERE = Path(__file__).parent
sys.argv_saved = sys.argv
src = (HERE / "make-signing.py").read_text().split('\nmac() if "--mac"')[0]
sys.argv = [sys.argv[0]]
ns = {"__file__": str(HERE / "make-signing.py")}
exec(compile(src.replace("IPHONE_UDIDS = iphones()", "IPHONE_UDIDS = []"), "make-signing.py", "exec"), ns)
sys.argv = sys.argv_saved
api = ns["api"]

BUNDLE_ID = "com.natesoftware.hifi"
SHOTS = HERE.parent / "Screenshots"
LISTING = {
    "subtitle": "Free listener-supported radio",
    "promotionalText": "Free, listener-supported radio on a click wheel, now with HIFI TV: every station plays its own old-TV clips. No ads, no account.",
    "keywords": "free radio,internet radio,listener supported,somafm,lofi,synth,chill,jazz,indie,retro,click wheel",
    "description": """HIFI is free, listener-supported internet radio on a click wheel.

No subscription, no ads, no account. The live stations are independent, listener-supported radio from Radio Paradise and SomaFM, streamed straight from the stations, and HIFI is free.

Spin the wheel to pick a station, press the center to tune in, and the music is already playing. Our original stations run on a shared clock, so tuning in drops you into the rotation wherever it is right now, like real radio.

SYNTH SOUNDS: four stations of original instrumental music for working, coding and drifting off.
• Dial-Up: lo-fi soft breaks, rain on the window
• Shareware Summer: warm synth funk
• Night Build: dark ambient for after hours
• Pixel Drift: bright chiptune

RADIO: live, listener-supported internet radio from Radio Paradise and SomaFM, plus Exclusive Radio, with the song that's playing right now. Including POP GIRL RADIO: big choruses, every era, all day. If you love a station, support it at radioparadise.com or somafm.com/support.

HIFI TV: every station has its own old-TV clips playing behind Now Playing, under the song and station on a sheet of clear glass.

101X CHILLVILLE: Austin's 101X Chillville playlist, 670 chill songs, each played from its official video.

HEART IT: tap the heart next to a song on the radio and it's saved to your Spotify Liked Songs.

PLAYLISTS: connect Spotify and your playlists show up right on the click wheel, with the Nate's Software HIFI playlist up top.

• Change stations with the wheel, the lock screen or your headphones
• Song, artist and station on the lock screen, drawn like a classic Now Playing screen
• Picture in Picture: go home and HIFI shrinks into a tiny clip-on player you can park in a corner
• Plays in the background
• No ads, no tracking. Spotify is optional; the radio needs no account

Free forever, made for fun by Nate's Software. Bring your own headphones.""",
    "supportUrl": "https://github.com/natemcguire/hifi/issues",
    "marketingUrl": "https://hifi.nates-software.com/",
}
PRIVACY_URL = "https://hifi.nates-software.com/privacy"
COPYRIGHT = "2026 Nate McGuire"
# iPhone 6.9" and iPad 13" sets; App Store Connect scales them for smaller devices.
SETS = {"APP_IPHONE_67": "iphone", "APP_IPAD_PRO_3GEN_129": "ipad"}


def local(key):
    if os.environ.get(key):
        return os.environ[key]
    f = HERE / "devices.local"
    for row in f.read_text().splitlines() if f.exists() else []:
        if row.startswith(key + "="):
            return row.split("=", 1)[1].strip().strip('"')
    sys.exit(f"missing {key} (set it in ios/scripts/devices.local)")


def contact(app):
    """The review contact: HIFI_REVIEW_* if set, else the one on this team's most recent other app."""
    keys = {"contactFirstName": "HIFI_REVIEW_FIRST", "contactLastName": "HIFI_REVIEW_LAST",
            "contactEmail": "HIFI_REVIEW_EMAIL", "contactPhone": "HIFI_REVIEW_PHONE"}
    try:
        return {field: local(key) for field, key in keys.items()}
    except SystemExit:
        pass
    for other in api("GET", "/v1/apps?limit=50")["data"]:
        if other["id"] == app["id"]:
            continue
        for v in api("GET", f"/v1/apps/{other['id']}/appStoreVersions?limit=5")["data"]:
            d = api("GET", f"/v1/appStoreVersions/{v['id']}/appStoreReviewDetail").get("data")
            if d and all(d["attributes"].get(f) for f in keys):
                return {f: d["attributes"][f] for f in keys}
    sys.exit("No review contact: set HIFI_REVIEW_* in scripts/devices.local")


def patch(kind, id, attributes):
    api("PATCH", f"/v1/{kind}/{id}", {"data": {"type": kind, "id": id, "attributes": attributes}})


def main():
    apps = api("GET", f"/v1/apps?filter[bundleId]={BUNDLE_ID}")["data"]
    if not apps:
        sys.exit("No App Store Connect record for com.natesoftware.hifi yet. Create it at appstoreconnect.apple.com first.")
    app = apps[0]
    print("app:", app["id"], app["attributes"]["name"])
    api("PATCH", f"/v1/apps/{app['id']}", {"data": {"type": "apps", "id": app["id"], "attributes": {
        "contentRightsDeclaration": "USES_THIRD_PARTY_CONTENT"}}})

    # Category, subtitle, privacy policy (the app info that's still editable).
    info = next(i for i in api("GET", f"/v1/apps/{app['id']}/appInfos")["data"]
                if i["attributes"]["appStoreState"] not in ("READY_FOR_SALE", "REPLACED_WITH_NEW_INFO"))
    api("PATCH", f"/v1/appInfos/{info['id']}", {"data": {"type": "appInfos", "id": info["id"], "relationships": {
        "primaryCategory": {"data": {"type": "appCategories", "id": "MUSIC"}},
        "secondaryCategory": {"data": {"type": "appCategories", "id": "ENTERTAINMENT"}}}}})
    for loc in api("GET", f"/v1/appInfos/{info['id']}/appInfoLocalizations")["data"]:
        patch("appInfoLocalizations", loc["id"], {"subtitle": LISTING["subtitle"], "privacyPolicyUrl": PRIVACY_URL})
    print("category, subtitle, privacy policy set")

    # Age rating: no objectionable content. Live radio plays unfiltered songs, so
    # mild language is possible on the live stations.
    rating = api("GET", f"/v1/appInfos/{info['id']}/ageRatingDeclaration")["data"]
    none = "NONE"
    patch("ageRatingDeclarations", rating["id"], {
        "socialMedia": False,  # Apple's newer question: HIFI has no social features
        "alcoholTobaccoOrDrugUseOrReferences": none, "contests": none, "gamblingSimulated": none,
        "horrorOrFearThemes": none, "matureOrSuggestiveThemes": none, "medicalOrTreatmentInformation": none,
        "profanityOrCrudeHumor": "INFREQUENT_OR_MILD", "sexualContentGraphicAndNudity": none,
        "sexualContentOrNudity": none, "gunsOrOtherWeapons": none, "violenceCartoonOrFantasy": none, "violenceRealistic": none,
        "violenceRealisticProlongedGraphicOrSadistic": none, "gambling": False, "unrestrictedWebAccess": False,
        "lootBox": False, "messagingAndChat": False, "parentalControls": False, "ageAssurance": False,
        "userGeneratedContent": False, "advertising": False, "healthOrWellnessTopics": False,
    })
    print("age rating set")

    # Free, everywhere.
    free = next(p for p in api("GET", f"/v1/apps/{app['id']}/appPricePoints?filter[territory]=USA&limit=200")["data"]
                if p["attributes"]["customerPrice"] in ("0", "0.0", "0.00"))
    api("POST", "/v1/appPriceSchedules", {
        "data": {"type": "appPriceSchedules", "relationships": {
            "app": {"data": {"type": "apps", "id": app["id"]}},
            "baseTerritory": {"data": {"type": "territories", "id": "USA"}},
            "manualPrices": {"data": [{"type": "appPrices", "id": "${free}"}]}}},
        "included": [{"type": "appPrices", "id": "${free}", "attributes": {"startDate": None},
                      "relationships": {"appPricePoint": {"data": {"type": "appPricePoints", "id": free["id"]}}}}]})
    print("price: free")

    # Available in every territory, and in new ones as Apple adds them.
    try:
        existing = api("GET", f"/v1/apps/{app['id']}/appAvailabilityV2").get("data")
    except SystemExit:
        existing = None
    if existing:
        print("availability: already set")
    else:
        territories = [t["id"] for t in api("GET", "/v1/territories?limit=200")["data"]]
        api("POST", "/v2/appAvailabilities", {
            "data": {"type": "appAvailabilities", "attributes": {"availableInNewTerritories": True}, "relationships": {
                "app": {"data": {"type": "apps", "id": app["id"]}},
                "territoryAvailabilities": {"data": [{"type": "territoryAvailabilities", "id": f"${{{t}}}"} for t in territories]}}},
            "included": [{"type": "territoryAvailabilities", "id": f"${{{t}}}", "attributes": {"available": True},
                          "relationships": {"territory": {"data": {"type": "territories", "id": t}}}} for t in territories]})
        print(f"availability: {len(territories)} territories")

    # The 1.0 version: copyright, listing text, screenshots, review contact.
    version = next(v for v in api("GET", f"/v1/apps/{app['id']}/appStoreVersions?filter[platform]=IOS")["data"]
                   if v["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"))
    patch("appStoreVersions", version["id"], {"copyright": COPYRIGHT})
    loc = api("GET", f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")["data"][0]
    patch("appStoreVersionLocalizations", loc["id"], {k: v for k, v in LISTING.items() if k != "subtitle"})
    print("listing text set for", version["attributes"]["versionString"])
    screenshots(loc["id"])

    detail = {**contact(app), "demoAccountRequired": False,
              "notes": "No account needed. Press the center button on the click wheel to play. "
                       "Synth Sounds stations are original music we made; the Radio stations are the public "
                       "streams of Radio Paradise, SomaFM and Exclusive Radio. Picture in Picture: start a station, then go home. "
                       "HIFI TV clips are original AI-generated video made for HIFI. 101X Chillville plays each song's official "
                       "YouTube upload in YouTube's own embedded player (youtube-nocookie.com), shown on screen and only while "
                       "the app is open; leaving Now Playing stops it. "
                       "Spotify is optional: the heart next to a live song and the Playlists menu ask the listener to connect "
                       "their own Spotify account (Spotify's own sign-in page, PKCE, no password reaches us). Everything else "
                       "works without it."}
    existing = api("GET", f"/v1/appStoreVersions/{version['id']}/appStoreReviewDetail")
    if existing.get("data"):
        patch("appStoreReviewDetails", existing["data"]["id"], detail)
    else:
        api("POST", "/v1/appStoreReviewDetails", {"data": {"type": "appStoreReviewDetails", "attributes": detail,
            "relationships": {"appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    print("review contact set")

    if "--submit" in sys.argv:
        submit(app, version)


def screenshots(localization):
    sets = {s["attributes"]["screenshotDisplayType"]: s for s in
            api("GET", f"/v1/appStoreVersionLocalizations/{localization}/appScreenshotSets")["data"]}
    for kind, folder in SETS.items():
        files = sorted((SHOTS / folder).glob("*.png"))
        if not files:
            print("no screenshots in", SHOTS / folder); continue
        if kind in sets:
            current = api("GET", f"/v1/appScreenshotSets/{sets[kind]['id']}/appScreenshots")["data"]
            if [s["attributes"].get("sourceFileChecksum") for s in current] == [hashlib.md5(f.read_bytes()).hexdigest() for f in files]:
                print("screenshots unchanged for", kind); continue
            for old in current:
                api("DELETE", f"/v1/appScreenshots/{old['id']}")
            set_id = sets[kind]["id"]
        else:
            set_id = api("POST", "/v1/appScreenshotSets", {"data": {"type": "appScreenshotSets",
                "attributes": {"screenshotDisplayType": kind},
                "relationships": {"appStoreVersionLocalization": {"data": {"type": "appStoreVersionLocalizations", "id": localization}}}}})["data"]["id"]
        for f in files:
            body = f.read_bytes()
            shot = api("POST", "/v1/appScreenshots", {"data": {"type": "appScreenshots",
                "attributes": {"fileName": f.name, "fileSize": len(body)},
                "relationships": {"appScreenshotSet": {"data": {"type": "appScreenshotSets", "id": set_id}}}}})["data"]
            for op in shot["attributes"]["uploadOperations"]:
                chunk = body[op["offset"]:op["offset"] + op["length"]]
                req = urllib.request.Request(op["url"], data=chunk, method=op["method"],
                                             headers={h["name"]: h["value"] for h in op["requestHeaders"]})
                urllib.request.urlopen(req, timeout=60).read()
            patch("appScreenshots", shot["id"], {"uploaded": True, "sourceFileChecksum": hashlib.md5(body).hexdigest()})
        print(f"{len(files)} screenshots uploaded for {kind}")


def submit(app, version):
    builds = api("GET", f"/v1/builds?filter[app]={app['id']}&sort=-uploadedDate&limit=1")["data"]
    if not builds or builds[0]["attributes"]["processingState"] != "VALID":
        sys.exit("No processed build yet; wait for App Store Connect to finish processing the upload.")
    build = builds[0]
    api("PATCH", f"/v1/appStoreVersions/{version['id']}", {"data": {"type": "appStoreVersions", "id": version["id"],
        "relationships": {"build": {"data": {"type": "builds", "id": build["id"]}}}}})
    print("build attached:", build["attributes"]["version"])
    # Reuse a submission an earlier, refused run left open.
    submission = next(iter(api("GET", f"/v1/reviewSubmissions?filter[app]={app['id']}&filter[state]=READY_FOR_REVIEW")["data"]), None) \
        or api("POST", "/v1/reviewSubmissions", {"data": {"type": "reviewSubmissions",
            "attributes": {"platform": "IOS"}, "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}})["data"]
    api("POST", "/v1/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
        "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": submission["id"]}},
        "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    patch("reviewSubmissions", submission["id"], {"submitted": True})
    print("submitted for review:", submission["id"])


main()
