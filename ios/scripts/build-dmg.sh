#!/bin/zsh
# Builds HIFI for Mac as a DMG anyone can download from the web and open: signed
# with HIFI's Developer ID identity (scripts/make-signing.py --developer-id) under
# the hardened runtime, notarized by Apple and stapled, so Gatekeeper accepts it.
# Run as: withkeys ios/scripts/build-dmg.sh [--no-notarize]
# The compile runs unsigned on HIFI_BUILD_HOST (default the relay Mac from
# devices.local) so this Mac stays quiet; HIFI_BUILD_HOST=local compiles here.
# Signing and notarizing happen here; the keys never leave this Mac.
# Needs ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_PATH for notarytool.
# Output: build/dmg/HIFI.dmg
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/devices.local ]] && source scripts/devices.local
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
# HIFI_DMG_IDENTITY_FILE=mac-identity with --no-notarize tries the packaging without Developer ID.
identity=$(cat $signing/${HIFI_DMG_IDENTITY_FILE:-devid-identity})
host=${HIFI_BUILD_HOST:-${HIFI_RELAY_HOST:-local}}
build=$(date -u +%Y%m%d%H%M)   # always increasing, like the App Store builds
version=$(sed -n "s/^ *MARKETING_VERSION: *'*\([^']*\)'*$/\1/p" project.yml | head -1)
out=build/dmg
app=$out/stage/HIFI.app
rm -rf $out && mkdir -p $out/stage

# 1. Compile, unsigned, for Apple silicon and Intel (generic destination = universal).
if [[ $host == local ]]; then
  xcodegen generate --quiet
  nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release -destination generic/platform=macOS \
    -derivedDataPath build/dmg-derived CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=$build build -quiet
  ditto build/dmg-derived/Build/Products/Release/HIFI.app $app
else
  ssh $host 'mkdir -p ~/Library/Caches/hifi-build/ios'  # the Air's own disk: its ~/Projects is this Mac's, shared
  rsync -a --delete --exclude build --exclude devices.local --exclude __pycache__ --exclude HIFI.xcodeproj ./ ${host}:Library/Caches/hifi-build/ios/
  rsync -a ../stations.json ${host}:Library/Caches/hifi-build/stations.json
  ssh $host "cd ~/Library/Caches/hifi-build/ios && xcodegen generate --quiet && \
    xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release -destination generic/platform=macOS \
    -derivedDataPath build/dmg CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=$build build -quiet"
  rsync -a ${host}:Library/Caches/hifi-build/ios/build/dmg/Build/Products/Release/HIFI.app $out/stage/
fi
echo "compiled HIFI $version ($build) on $host"

# 2. Sign: nested code first, then the app, each with the hardened runtime and a
# secure timestamp, as notarization requires. HIFI needs no entitlements: it is not
# sandboxed and only plays audio over the network.
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
sign() { codesign --force --options runtime --timestamp --sign $identity --keychain $keychain "$@"; }
for nested in $app/Contents/Frameworks/*(N) $app/Contents/PlugIns/*(N); do sign $nested; done
sign $app
codesign --verify --strict --deep $app

notarize() {
  local auth=(--key "${ASC_API_KEY_PATH/#\~/$HOME}" --key-id "$ASC_API_KEY_ID" --issuer "$ASC_API_KEY_ISSUER_ID")
  local result=$(xcrun notarytool submit "$1" $auth --wait --output-format json)
  local id=$(plutil -extract id raw - <<< "$result") notary_status=$(plutil -extract status raw - <<< "$result")
  echo "notarization of ${1:t} ($id): $notary_status"
  if [[ $notary_status != Accepted ]]; then xcrun notarytool log $id $auth; exit 1; fi
}
notarized=1
[[ ${1:-} == --no-notarize ]] && notarized=0

# 3. Notarize and staple the app itself, so a copy dragged out of the DMG opens offline too.
if (( notarized )); then
  ditto -c -k --keepParent $app $out/HIFI-app.zip
  notarize $out/HIFI-app.zip
  xcrun stapler staple -q $app
  rm $out/HIFI-app.zip
fi

# 4. The DMG: the app beside an /Applications link, signed, notarized, stapled.
ln -s /Applications $out/stage/Applications
hdiutil create -volname HIFI -srcfolder $out/stage -fs HFS+ -format UDZO -ov $out/HIFI.dmg -quiet
codesign --force --timestamp --sign $identity --keychain $keychain $out/HIFI.dmg
if (( notarized )); then
  notarize $out/HIFI.dmg
  xcrun stapler staple -q $out/HIFI.dmg
  xcrun stapler validate $out/HIFI.dmg
  spctl -a -t open --context context:primary-signature -v $out/HIFI.dmg 2>&1
  spctl -a -vv $app 2>&1
fi
echo "built $out/HIFI.dmg: HIFI $version ($build), $(du -h $out/HIFI.dmg | cut -f1)"
# The website serves it at /download; the landing page shows its button once it's there.
if (( notarized )); then
  mkdir -p ../download && cp $out/HIFI.dmg ../download/HIFI.dmg
  echo "copied to download/HIFI.dmg: commit it, then npm run release"
fi
