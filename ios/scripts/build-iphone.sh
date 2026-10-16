#!/bin/zsh
# Builds HIFI for Nate's iPhone with HIFI's own signing identity and keychain
# (created by scripts/make-signing.py; nothing here touches the login keychain).
set -euo pipefail
cd "$(dirname "$0")/.."
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
xcodegen generate --quiet
nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Release \
  -destination 'generic/platform=iOS' -derivedDataPath build/iphone \
  CODE_SIGN_IDENTITY="$(cat $signing/identity)" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
  build -quiet
echo "built build/iphone/Build/Products/Release-iphoneos/HIFI.app"
