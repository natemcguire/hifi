#!/usr/bin/env python3
"""Creates HIFI's own signing setup, separate from every other app's:
a new private key, an Apple Development certificate for it, a development
profile for com.natesoftware.hifi on the iPhones in devices.local, and a dedicated
hifi-build keychain that codesign can use without prompts.

Run as: withkeys <python with pyjwt> ios/scripts/make-signing.py [--mac]
Needs ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_PATH. Prints only IDs.
"""
import base64, json, os, plistlib, secrets, subprocess, sys, time, urllib.error, urllib.request
from pathlib import Path

import jwt

BUNDLE_ID = "com.natesoftware.hifi"
PROFILE_NAME = "HIFI iPhone Development"
# The iPhones from devices.local (Label:UDID pairs), each registered in the developer account.
def iphones():
    line = os.environ.get("HIFI_IPHONES", "")
    local = Path(__file__).with_name("devices.local")
    if not line and local.exists():
        for row in local.read_text().splitlines():
            if row.startswith("HIFI_IPHONES="):
                line = row.split("=", 1)[1].strip().strip('"')
    if not line:
        sys.exit("No iPhones: copy ios/scripts/devices.example to devices.local")
    return [pair.split(":")[-1] for pair in line.split()]
IPHONE_UDIDS = iphones()
HOME = Path.home()
DIR = HOME / ".config/hifi-signing"
KEYCHAIN = HOME / "Library/Keychains/hifi-build.keychain-db"


def token():
    key = Path(os.environ["ASC_API_KEY_PATH"]).expanduser().read_text()
    now = int(time.time())
    return jwt.encode({"iss": os.environ["ASC_API_KEY_ISSUER_ID"], "iat": now, "exp": now + 1200, "aud": "appstoreconnect-v1"},
                      key, algorithm="ES256", headers={"kid": os.environ["ASC_API_KEY_ID"], "typ": "JWT"})


def api(method, path, body=None):
    req = urllib.request.Request("https://api.appstoreconnect.apple.com" + path, method=method,
                                 data=json.dumps(body).encode() if body else None,
                                 headers={"Authorization": f"Bearer {token()}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        detail = json.loads(e.read() or b"{}").get("errors", [{}])[0]
        sys.exit(f"{method} {path.split('?')[0]} -> {e.code}: {detail.get('title')} {detail.get('detail')}")


def run(*args, **kw):
    return subprocess.run(args, check=True, capture_output=True, **kw)


def main():
    DIR.mkdir(mode=0o700, exist_ok=True)
    key, csr, cer = DIR / "dev.key", DIR / "dev.csr", DIR / "dev.cer"

    # 1. Our own private key and certificate.
    if not cer.exists():
        run("openssl", "genrsa", "-out", str(key), "2048")
        key.chmod(0o600)
        run("openssl", "req", "-new", "-key", str(key), "-out", str(csr), "-subj", "/CN=HIFI Development/O=Nate's Software/C=US")
        csr_body = "".join(l for l in csr.read_text().splitlines() if "CERTIFICATE REQUEST" not in l)
        created = api("POST", "/v1/certificates", {"data": {"type": "certificates", "attributes": {
            "certificateType": os.environ.get("HIFI_CERT_TYPE", "IOS_DEVELOPMENT"), "csrContent": csr_body}}})
        cer.write_bytes(base64.b64decode(created["data"]["attributes"]["certificateContent"]))
        (DIR / "certificate-id").write_text(created["data"]["id"])
        print("certificate created:", created["data"]["id"])
    cert_id = (DIR / "certificate-id").read_text().strip()
    sha1 = run("openssl", "x509", "-inform", "DER", "-in", str(cer), "-noout", "-fingerprint", "-sha1").stdout.decode().split("=")[1].strip().replace(":", "")
    (DIR / "identity").write_text(sha1)
    print("identity sha1:", sha1)

    # 2. Dedicated keychain with a random password only the build script reads.
    pw_file = DIR / "keychain-password"
    if not KEYCHAIN.exists():
        pw_file.write_text(secrets.token_urlsafe(32))
        pw_file.chmod(0o600)
        pw = pw_file.read_text()
        run("security", "create-keychain", "-p", pw, str(KEYCHAIN))
        run("security", "set-keychain-settings", str(KEYCHAIN))  # no auto-lock timeout
        p12_pw = secrets.token_urlsafe(16)
        p12 = DIR / "dev.p12"
        pem = DIR / "dev.pem"
        run("openssl", "x509", "-inform", "DER", "-in", str(cer), "-out", str(pem))
        run("openssl", "pkcs12", "-export", "-inkey", str(key), "-in", str(pem), "-out", str(p12), "-passout", f"pass:{p12_pw}")
        run("security", "unlock-keychain", "-p", pw, str(KEYCHAIN))
        run("security", "import", str(p12), "-k", str(KEYCHAIN), "-P", p12_pw, "-T", "/usr/bin/codesign", "-T", "/usr/bin/security")
        run("security", "set-key-partition-list", "-S", "apple-tool:,apple:,codesign:", "-s", "-k", pw, str(KEYCHAIN))
        p12.unlink()
        listed = [l.strip().strip('"') for l in run("security", "list-keychains", "-d", "user").stdout.decode().splitlines()]
        if str(KEYCHAIN) not in listed:
            run("security", "list-keychains", "-d", "user", "-s", *listed, str(KEYCHAIN))
        print("keychain:", KEYCHAIN)

    # 3. Bundle ID, device, and a fresh profile tied to our certificate.
    found = api("GET", f"/v1/bundleIds?filter[identifier]={BUNDLE_ID}&limit=20")["data"]
    bundle = next((b for b in found if b["attributes"]["identifier"] == BUNDLE_ID), None)
    if not bundle:
        bundle = api("POST", "/v1/bundleIds", {"data": {"type": "bundleIds", "attributes": {
            "identifier": BUNDLE_ID, "name": "HIFI", "platform": "IOS"}}})["data"]
    devices = api("GET", f"/v1/devices?filter[udid]={','.join(IPHONE_UDIDS)}")["data"]
    if len(devices) != len(IPHONE_UDIDS):
        sys.exit("an iPhone is not registered in the developer account")
    for old in api("GET", f"/v1/profiles?filter[name]={urllib.request.quote(PROFILE_NAME)}")["data"]:
        api("DELETE", f"/v1/profiles/{old['id']}")
    profile = api("POST", "/v1/profiles", {"data": {"type": "profiles",
        "attributes": {"name": PROFILE_NAME, "profileType": "IOS_APP_DEVELOPMENT"},
        "relationships": {
            "bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}},
            "certificates": {"data": [{"type": "certificates", "id": cert_id}]},
            "devices": {"data": [{"type": "devices", "id": d["id"]} for d in devices]}}}})["data"]
    content = base64.b64decode(profile["attributes"]["profileContent"])
    uuid = profile["attributes"]["uuid"]
    for folder in (HOME / "Library/Developer/Xcode/UserData/Provisioning Profiles", HOME / "Library/MobileDevice/Provisioning Profiles"):
        folder.mkdir(parents=True, exist_ok=True)
        (folder / f"{uuid}.mobileprovision").write_bytes(content)
    print("profile:", PROFILE_NAME, uuid)


def mac():
    """Adds a Mac development certificate for the same key, so the Mac build signs
    from the same hifi-build keychain. No profile needed: no restricted entitlements."""
    key, cer = DIR / "dev.key", DIR / "mac.cer"
    if not cer.exists():
        csr = DIR / "mac.csr"
        run("openssl", "req", "-new", "-key", str(key), "-out", str(csr), "-subj", "/CN=HIFI Mac Development/O=Nate's Software/C=US")
        csr_body = "".join(l for l in csr.read_text().splitlines() if "CERTIFICATE REQUEST" not in l)
        created = api("POST", "/v1/certificates", {"data": {"type": "certificates", "attributes": {
            "certificateType": "MAC_APP_DEVELOPMENT", "csrContent": csr_body}}})
        cer.write_bytes(base64.b64decode(created["data"]["attributes"]["certificateContent"]))
        print("mac certificate created:", created["data"]["id"])
    pw = (DIR / "keychain-password").read_text()
    run("security", "unlock-keychain", "-p", pw, str(KEYCHAIN))
    subprocess.run(["security", "import", str(cer), "-k", str(KEYCHAIN), "-T", "/usr/bin/codesign"], capture_output=True)
    sha1 = run("openssl", "x509", "-inform", "DER", "-in", str(cer), "-noout", "-fingerprint", "-sha1").stdout.decode().split("=")[1].strip().replace(":", "")
    (DIR / "mac-identity").write_text(sha1)
    print("mac identity sha1:", sha1)


mac() if "--mac" in sys.argv else main()
