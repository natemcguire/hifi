#!/bin/zsh
# Captures the raw App Store screenshots in the simulators on the MacBook Air (never
# the mini): a Debug build opened on each page with `-screenshot <page>`, a 9:41 status
# bar, then Screenshots/raw/{iphone,ipad}. Frame them with scripts/frame-screenshots.py.
# Run as: ios/scripts/capture-screenshots.sh
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/devices.local ]] && source scripts/devices.local
host=${HIFI_BUILD_HOST:-${HIFI_RELAY_HOST:?set HIFI_BUILD_HOST in scripts/devices.local}}
# name: the screenshot page each raw file shows
pages=(1-main:home 2-tv:tv 3-radio:radio 4-live:live 5-synth:synthTV 6-connect:connect)
devices=("iphone:iPhone 17 Pro Max" "ipad:iPad Pro 13-inch (M5)")

ssh $host 'mkdir -p ~/Library/Caches/hifi-build/ios'
rsync -a --delete --exclude build --exclude devices.local --exclude __pycache__ --exclude HIFI.xcodeproj --exclude Screenshots ./ ${host}:Library/Caches/hifi-build/ios/
rsync -a ../stations.json ${host}:Library/Caches/hifi-build/stations.json
ssh $host "cd ~/Library/Caches/hifi-build/ios && xcodegen generate --quiet && \
  xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath build/sim CODE_SIGNING_ALLOWED=NO build -quiet"
app='~/Library/Caches/hifi-build/ios/build/sim/Build/Products/Debug-iphonesimulator/HIFI.app'
for entry in $devices; do
  kind=${entry%%:*} device=${entry#*:}
  udid=$(ssh $host "xcrun simctl list devices available | grep -F '$device (' | head -1 | sed -E 's/.*\\(([0-9A-F-]{36})\\).*/\\1/'")
  ssh $host "xcrun simctl boot $udid 2>/dev/null || true; xcrun simctl bootstatus $udid -b >/dev/null; \
    xcrun simctl status_bar $udid override --time 9:41 --batteryState charged --batteryLevel 100 --wifiBars 3 --cellularBars 4; \
    xcrun simctl install $udid $app"
  mkdir -p Screenshots/raw/$kind
  for pair in $pages; do
    name=${pair%%:*} page=${pair#*:}
    ssh $host "xcrun simctl terminate $udid com.natesoftware.hifi 2>/dev/null || true; \
      xcrun simctl launch $udid com.natesoftware.hifi -screenshot $page >/dev/null; sleep 14; \
      xcrun simctl io $udid screenshot --type=png /tmp/hifi-shot.png >/dev/null 2>&1"
    scp -q $host:/tmp/hifi-shot.png Screenshots/raw/$kind/$name.png
    echo "captured $kind $name ($page)"
  done
  ssh $host "xcrun simctl terminate $udid com.natesoftware.hifi 2>/dev/null || true; xcrun simctl shutdown $udid"
done
