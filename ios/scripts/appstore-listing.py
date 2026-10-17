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
    "subtitle": "Little radio, very big mood",
    "promotionalText": "Original synth stations and live indie, jazz, Americana and eclectic radio, played on a click wheel.",
    "keywords": "radio,internet radio,lofi,synth,chiptune,ambient,focus,jazz,indie,somafm,radio paradise,retro",
    "description": """HIFI is a little internet radio with a click wheel.

Spin the wheel to pick a station, press the center to tune in, and the music is already playing. Our original stations run on a shared clock, so tuning in drops you into the rotation wherever it is right now, like real radio.

SYNTH SOUNDS: four stations of original instrumental music for working, coding and drifting off.
• Dial-Up: lo-fi soft breaks, rain on the window
• Shareware Summer: warm synth funk
• Night Build: dark ambient for after hours
• Pixel Drift: bright chiptune

RADIO: live internet radio from Radio Paradise, SomaFM and Exclusive Radio, with the song that's playing right now.

• Skip between songs with the wheel, the lock screen or your headphones
• Song, artist and station on the lock screen, drawn like a classic Now Playing screen
• Picture in Picture: go home and HIFI shrinks into a tiny clip-on player you can park in a corner
• Plays in the background
• No account, no ads, no tracking

Free to listen. Bring your own headphones.""",
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
        "alcoholTobaccoOrDrugUseOrReferences": none, "contests": none, "gamblingSimulated": none,
        "horrorOrFearThemes": none, "matureOrSuggestiveThemes": none, "medicalOrTreatmentInformation": none,
        "profanityOrCrudeHumor": "INFREQUENT_OR_MILD", "sexualContentGraphicAndNudity": none,
        "sexualContentOrNudity": none, "violenceCartoonOrFantasy": none, "violenceRealistic": none,
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

    # The 1.0 version: copyright, listing text, screenshots, review contact.
    version = next(v for v in api("GET", f"/v1/apps/{app['id']}/appStoreVersions?filter[platform]=IOS")["data"]
                   if v["attributes"]["appStoreState"] in ("PREPARE_FOR_SUBMISSION", "DEVELOPER_REJECTED", "REJECTED", "METADATA_REJECTED"))
    patch("appStoreVersions", version["id"], {"copyright": COPYRIGHT})
    loc = api("GET", f"/v1/appStoreVersions/{version['id']}/appStoreVersionLocalizations")["data"][0]
    patch("appStoreVersionLocalizations", loc["id"], {k: v for k, v in LISTING.items() if k != "subtitle"})
    print("listing text set for", version["attributes"]["versionString"])
    screenshots(loc["id"])

    detail = {"contactFirstName": local("HIFI_REVIEW_FIRST"), "contactLastName": local("HIFI_REVIEW_LAST"),
              "contactEmail": local("HIFI_REVIEW_EMAIL"), "contactPhone": local("HIFI_REVIEW_PHONE"),
              "demoAccountRequired": False,
              "notes": "No account needed. Press the center button on the click wheel to play. "
                       "Synth Sounds stations are original music we made; the Radio stations are the public "
                       "streams of Radio Paradise, SomaFM and Exclusive Radio. Picture in Picture: start a station, then go home."}
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
            for old in api("GET", f"/v1/appScreenshotSets/{sets[kind]['id']}/appScreenshots")["data"]:
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
    submission = api("POST", "/v1/reviewSubmissions", {"data": {"type": "reviewSubmissions",
        "attributes": {"platform": "IOS"}, "relationships": {"app": {"data": {"type": "apps", "id": app["id"]}}}}})["data"]
    api("POST", "/v1/reviewSubmissionItems", {"data": {"type": "reviewSubmissionItems", "relationships": {
        "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": submission["id"]}},
        "appStoreVersion": {"data": {"type": "appStoreVersions", "id": version["id"]}}}}})
    patch("reviewSubmissions", submission["id"], {"submitted": True})
    print("submitted for review:", submission["id"])


main()
