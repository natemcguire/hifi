#!/bin/zsh
# Builds the Mac app, signed with HIFI's own Mac identity from the hifi-build keychain.
set -euo pipefail
cd "$(dirname "$0")/.."
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
xcodegen generate --quiet
nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Release \
  -derivedDataPath build/mac \
  CODE_SIGN_IDENTITY="$(cat $signing/mac-identity)" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
  build -quiet
echo "built build/mac/Build/Products/Release/HIFI.app"
