#!/bin/zsh
# Compiles HIFI for iPhone and Mac on another Mac (HIFI_BUILD_HOST, default the
# MacBook Air from devices.local) so this one stays quiet, then signs the results
# here with HIFI's own keys. The keys never leave this Mac. Output lands where
# build-iphone.sh and build-mac.sh put it, so install-iphone.sh and install-mac.sh
# work unchanged.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/devices.local ]] && source scripts/devices.local
host=${HIFI_BUILD_HOST:-${HIFI_RELAY_HOST:?set HIFI_BUILD_HOST in scripts/devices.local}}
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db

ssh $host 'mkdir -p ~/Library/Caches/hifi-build/ios'  # the Air's own disk: its ~/Projects is this Mac's, shared
rsync -a --delete --exclude build --exclude devices.local --exclude __pycache__ --exclude HIFI.xcodeproj ./ ${host}:Library/Caches/hifi-build/ios/
rsync -a ../stations.json ${host}:Library/Caches/hifi-build/stations.json
ssh $host 'mkdir -p ~/Library/Caches/hifi-build/ios && cd ~/Library/Caches/hifi-build/ios && xcodegen generate --quiet &&
  xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Release -destination generic/platform=iOS \
    -derivedDataPath build/iphone CODE_SIGNING_ALLOWED=NO build -quiet 2>&1 | grep -E "error:" ; \
  xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release \
    -derivedDataPath build/mac CODE_SIGNING_ALLOWED=NO build -quiet 2>&1 | grep -E "error:" ; true'

iphone=build/iphone/Build/Products/Release-iphoneos
mac=build/mac/Build/Products/Release
rm -rf $iphone/HIFI.app $mac/HIFI.app && mkdir -p $iphone $mac
rsync -a ${host}:Library/Caches/hifi-build/ios/$iphone/HIFI.app $iphone/
rsync -a ${host}:Library/Caches/hifi-build/ios/$mac/HIFI.app $mac/

security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
profile=$(grep -l "HIFI iPhone Development" ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision | head -1)
cp "$profile" $iphone/HIFI.app/embedded.mobileprovision
entitlements=$(mktemp)
cat > $entitlements <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>42Y5ADDZL2.com.natesoftware.hifi</string>
  <key>com.apple.developer.team-identifier</key><string>42Y5ADDZL2</string>
  <key>get-task-allow</key><true/>
</dict></plist>
EOF
codesign --force --sign "$(cat $signing/identity)" --keychain $keychain --entitlements $entitlements --generate-entitlement-der $iphone/HIFI.app
codesign --force --deep --sign "$(cat $signing/mac-identity)" --keychain $keychain $mac/HIFI.app
rm -f $entitlements
echo "built and signed $iphone/HIFI.app and $mac/HIFI.app (compiled on $host)"
