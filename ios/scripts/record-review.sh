#!/bin/zsh
# Records the App Review walkthrough on a real iPhone (Guideline 2.1 asks for one).
# A Debug build carries the review tour (`-tour 1`, Sources/IPod.swift): it is
# installed on the phone, `devicectl` records the phone's screen over USB or Wi-Fi
# while the tour presses the wheel by itself, and the video lands in Review/.
# The phone must be paired, unlocked and awake. Nothing here needs a hand on it.
# (devicectl hands a `--` to the app as a literal argument, which breaks `-key value`
# parsing, so the launch arguments are passed bare.)
# Run as: ios/scripts/record-review.sh [UDID] [seconds]   (defaults: first phone in
# scripts/devices.local, 110 seconds). Pass --reuse to skip the build.
#
# devicectl can only record a phone that reports the Screen Recording capability
# (seen on USB; a phone on Wi-Fi refuses). `--arm` is the hands-on fallback: it
# installs the build and arms the tour for the next launch, then on the phone start
# a Control Center screen recording, open HIFI, wait about two minutes, stop.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/devices.local ]] && source scripts/devices.local
reuse=0; arm=0; args=()
for a in "$@"; do
  case $a in --reuse) reuse=1 ;; --arm) arm=1 ;; *) args+=("$a") ;; esac
done
first=${${=${HIFI_IPHONES:-}}[1]:-}
udid=${args[1]:-${first##*:}}
seconds=${args[2]:-110}
[[ -n $udid ]] || { echo "usage: record-review.sh <iPhone UDID> [seconds]  (xcrun devicectl list devices)"; exit 1; }
bundle=com.natesoftware.hifi
app=build/review/Build/Products/Debug-iphoneos/HIFI.app

if (( ! reuse )); then
  signing=$HOME/.config/hifi-signing
  keychain=$HOME/Library/Keychains/hifi-build.keychain-db
  security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
  xcodegen generate --quiet
  nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Debug \
    -destination 'generic/platform=iOS' -derivedDataPath build/review \
    CODE_SIGN_IDENTITY="$(cat $signing/identity)" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
    build -quiet
  echo "built $app"
fi

if xcrun devicectl device info lockState --device $udid 2>/dev/null | grep -q 'passcodeRequired: true'; then
  echo "The phone is locked: unlock it and run again."; exit 1
fi
xcrun devicectl device install app --device $udid $app >/dev/null
echo "installed on $udid"

if (( arm )); then
  xcrun devicectl device process launch --device $udid --terminate-existing $bundle -armTour 1 >/dev/null
  sleep 4
  rm -f /tmp/hifi-prefs.plist
  xcrun devicectl device copy from --device $udid --domain-type appDataContainer --domain-identifier $bundle \
    --source Library/Preferences/$bundle.plist --destination /tmp/hifi-prefs.plist >/dev/null 2>&1 || true
  if plutil -p /tmp/hifi-prefs.plist 2>/dev/null | grep -q '"tourArmed" => 1'; then
    echo "armed: on the phone, start a Control Center screen recording, open HIFI, wait about two minutes, stop."
  else
    echo "not armed: the flag didn't reach the phone's preferences. Is the phone unlocked? Run again."; exit 1
  fi
  exit 0
fi
if ! xcrun devicectl device info details --device $udid 2>/dev/null | grep -q 'com.apple.coredevice.feature.screenrecording'; then
  echo "This phone doesn't offer screen recording to devicectl (Wi-Fi?). Plug it in by USB, or use --arm and record on the phone."; exit 1
fi

mkdir -p Review
out=Review/hifi-iphone-review-$(date +%Y%m%d-%H%M).mp4
xcrun devicectl device capture screen-record --device $udid --destination $out --duration $seconds >/tmp/hifi-record.log 2>&1 &
recorder=$!
sleep 3
xcrun devicectl device process launch --device $udid --terminate-existing $bundle -tour 1 >/dev/null
echo "recording $seconds s while the tour runs…"
wait $recorder || { cat /tmp/hifi-record.log; exit 1 }
xcrun devicectl device process launch --device $udid --terminate-existing $bundle >/dev/null 2>&1 || true  # leave the app on its menu, tour off
echo "saved $out"
ffprobe -v error -show_entries format=duration:stream=width,height -of default=nw=1 "$out" 2>/dev/null || true
