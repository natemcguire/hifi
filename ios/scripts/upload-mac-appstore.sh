#!/bin/zsh
# Archives HIFI for the Mac App Store and uploads it to App Store Connect. The Mac app
# joins the iPhone app's record: same bundle ID (com.natesoftware.hifi, universal), so the
# usual .mac suffix is dropped for this build. Sandboxed (Resources/MacStore.entitlements),
# signed with the Apple Distribution identity and the "HIFI Mac App Store" profile, and
# packaged with the Mac Installer identity (scripts/make-signing.py --mac-store).
# Run as: withkeys ios/scripts/upload-mac-appstore.sh [--no-upload]
# Compiles here (small app, nice'd). Output: build/mac-archive/export/HIFI.pkg.
set -euo pipefail
cd "$(dirname "$0")/.."
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
identity=$(cat $signing/dist-identity)
installer=$(cat $signing/installer-identity)
build=$(date -u +%Y%m%d%H%M)   # always increasing, as App Store Connect requires
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
rm -rf build/mac-archive
xcodegen generate --quiet
nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release \
  -destination generic/platform=macOS -derivedDataPath build/mac-store -archivePath build/mac-archive/HIFI.xcarchive \
  PRODUCT_BUNDLE_IDENTIFIER=com.natesoftware.hifi CODE_SIGN_ENTITLEMENTS=Resources/MacStore.entitlements \
  CODE_SIGN_IDENTITY="$identity" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
  PROVISIONING_PROFILE_SPECIFIER="HIFI Mac App Store" CURRENT_PROJECT_VERSION=$build \
  archive -quiet
echo "archived Mac build $build"

# The .pkg App Store Connect takes, signed with the installer identity. (Xcode's own
# -exportArchive does the same productbuild call, but pulls in symbol upload and more
# keychain prompts; this is the one step it actually needs.)
mkdir -p build/mac-archive/export
productbuild --component build/mac-archive/HIFI.xcarchive/Products/Applications/HIFI.app /Applications \
  --sign "$installer" --keychain $keychain build/mac-archive/export/HIFI.pkg
pkg=build/mac-archive/export/HIFI.pkg
echo "exported $pkg ($(du -h $pkg | cut -f1))"
[[ ${1:-} == --no-upload ]] && exit 0
# asc signs in with the same ASC_API_KEY_* that withkeys provides.
asc builds upload --app 6824175373 --pkg $pkg --version "$(sed -n "s/^ *MARKETING_VERSION: *'*\([^']*\)'*$/\1/p" project.yml | head -1)" --build-number $build --wait --output table
echo "uploaded Mac build $build to App Store Connect"
