#!/bin/zsh
# Builds HIFI for the Mac App Store and uploads it to App Store Connect. The Mac app
# joins the iPhone app's record: same bundle ID (com.natesoftware.hifi, universal), so the
# usual .mac suffix is dropped for this build. Sandboxed (Resources/MacStore.entitlements),
# signed with the Apple Distribution identity and the "HIFI Mac App Store" profile, and
# packaged with the Mac Installer identity (scripts/make-signing.py --mac-store).
# Run as: withkeys ios/scripts/upload-mac-appstore.sh [--no-upload]
# The compile runs unsigned on HIFI_ARCHIVE_HOST (default HIFI_BUILD_HOST, then the relay
# Mac from devices.local) so this Mac stays quiet; HIFI_ARCHIVE_HOST=local compiles here.
# Signing and packaging happen here; the keys never leave this Mac.
# Output: build/mac-archive/export/HIFI.pkg.
set -euo pipefail
cd "$(dirname "$0")/.."
[[ -f scripts/devices.local ]] && source scripts/devices.local
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
identity=$(cat $signing/dist-identity)
installer=$(cat $signing/installer-identity)
profile=$HOME/Library/Developer/Xcode/UserData/Provisioning\ Profiles/$(cat $signing/mac-store-profile)
host=${HIFI_ARCHIVE_HOST:-${HIFI_BUILD_HOST:-${HIFI_RELAY_HOST:-local}}}
build=$(date -u +%Y%m%d%H%M)   # always increasing, as App Store Connect requires
version=$(sed -n "s/^ *MARKETING_VERSION: *'*\([^']*\)'*$/\1/p" project.yml | head -1)
out=build/mac-archive
app=$out/HIFI.app
rm -rf $out && mkdir -p $out

# 1. Compile, unsigned, for Apple silicon and Intel (generic destination = universal).
if [[ $host == local ]]; then
  xcodegen generate --quiet
  nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release -destination generic/platform=macOS \
    -derivedDataPath build/mac-store PRODUCT_BUNDLE_IDENTIFIER=com.natesoftware.hifi \
    CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=$build build -quiet
  ditto build/mac-store/Build/Products/Release/HIFI.app $app
else
  ssh $host 'mkdir -p ~/Library/Caches/hifi-build/ios'  # the Air's own disk: its ~/Projects is this Mac's, shared
  rsync -a --delete --exclude build --exclude devices.local --exclude __pycache__ --exclude HIFI.xcodeproj ./ ${host}:Library/Caches/hifi-build/ios/
  rsync -a ../stations.json ${host}:Library/Caches/hifi-build/stations.json
  ssh $host "cd ~/Library/Caches/hifi-build/ios && xcodegen generate --quiet && \
    xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release -destination generic/platform=macOS \
    -derivedDataPath build/mac-store PRODUCT_BUNDLE_IDENTIFIER=com.natesoftware.hifi \
    CODE_SIGNING_ALLOWED=NO CURRENT_PROJECT_VERSION=$build build -quiet"
  rsync -a --delete ${host}:Library/Caches/hifi-build/ios/build/mac-store/Build/Products/Release/HIFI.app $out/
fi
echo "compiled HIFI $version ($build) on $host"

# 2. Sign here, the way Xcode would have: the store profile embedded, the sandbox
# entitlements plus the app and team identifiers the profile grants.
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
cp "$profile" $app/Contents/embedded.provisionprofile
cat > $out/entitlements.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>com.apple.application-identifier</key><string>42Y5ADDZL2.com.natesoftware.hifi</string>
  <key>com.apple.developer.team-identifier</key><string>42Y5ADDZL2</string>
  <key>com.apple.security.app-sandbox</key><true/>
  <key>com.apple.security.network.client</key><true/>
</dict></plist>
EOF
for nested in $app/Contents/Frameworks/*(N) $app/Contents/PlugIns/*(N); do
  codesign --force --timestamp --sign $identity --keychain $keychain $nested
done
codesign --force --timestamp --sign $identity --keychain $keychain \
  --entitlements $out/entitlements.plist --generate-entitlement-der $app
codesign --verify --strict --deep $app
echo "signed $app as $identity"

# 3. The .pkg App Store Connect takes, signed with the installer identity. productbuild
# signs in-process, so the key's ACL must name it (make-signing.py --mac-store does that).
mkdir -p $out/export
productbuild --component $app /Applications --sign "$installer" --keychain $keychain $out/export/HIFI.pkg
pkg=$out/export/HIFI.pkg
pkgutil --check-signature $pkg | sed -n '1,3p'
echo "exported $pkg ($(du -h $pkg | cut -f1))"
[[ ${1:-} == --no-upload ]] && exit 0
# asc signs in with the same ASC_API_KEY_* that withkeys provides.
asc builds upload --app 6824175373 --pkg $pkg --version "$version" --build-number $build --wait --output table
echo "uploaded Mac build $build to App Store Connect"
