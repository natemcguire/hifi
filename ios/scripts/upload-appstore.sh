#!/bin/zsh
# Archives HIFI for the App Store and uploads it to App Store Connect, signed with
# HIFI's own distribution identity (scripts/make-signing.py --store).
# Run as: withkeys ios/scripts/upload-appstore.sh [--no-upload]
# With HIFI_ARCHIVE_HOST=<host> the compile runs there unsigned (keeping the mini's
# CPU free) and only signing and upload happen here; the signing keys never leave.
# Needs ASC_API_KEY_ID, ASC_API_KEY_ISSUER_ID, ASC_API_KEY_PATH for the upload.
set -euo pipefail
cd "$(dirname "$0")/.."
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
identity=$(cat $signing/dist-identity)
build=$(date -u +%Y%m%d%H%M)   # always increasing, as App Store Connect requires
security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
rm -rf build/archive
if [[ -n ${HIFI_ARCHIVE_HOST:-} ]]; then
  ssh $HIFI_ARCHIVE_HOST 'mkdir -p ~/Library/Caches/hifi-build/ios'  # the Air's own disk: its ~/Projects is this Mac's, shared
  rsync -a --delete --exclude build --exclude devices.local --exclude __pycache__ --exclude HIFI.xcodeproj ./ ${HIFI_ARCHIVE_HOST}:Library/Caches/hifi-build/ios/
  rsync -a ../stations.json ${HIFI_ARCHIVE_HOST}:Library/Caches/hifi-build/stations.json
  ssh $HIFI_ARCHIVE_HOST "mkdir -p ~/Library/Caches/hifi-build/ios && cd ~/Library/Caches/hifi-build/ios && xcodegen generate --quiet && rm -rf build/archive && \
    xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Release -destination generic/platform=iOS \
    -derivedDataPath build/store -archivePath build/archive/HIFI.xcarchive CODE_SIGNING_ALLOWED=NO \
    CURRENT_PROJECT_VERSION=$build archive -quiet"
  mkdir -p build/archive && rsync -a ${HIFI_ARCHIVE_HOST}:Library/Caches/hifi-build/ios/build/archive/HIFI.xcarchive build/archive/
  # Sign the unsigned app here, so the archive looks like one Xcode signed.
  app=build/archive/HIFI.xcarchive/Products/Applications/HIFI.app
  profile=$(grep -l "HIFI App Store" ~/Library/Developer/Xcode/UserData/Provisioning\ Profiles/*.mobileprovision | head -1)
  cp "$profile" $app/embedded.mobileprovision
  cat > build/archive/entitlements.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>application-identifier</key><string>42Y5ADDZL2.com.natesoftware.hifi</string>
  <key>com.apple.developer.team-identifier</key><string>42Y5ADDZL2</string>
  <key>get-task-allow</key><false/>
</dict></plist>
EOF
  codesign --force --sign $identity --keychain $keychain --entitlements build/archive/entitlements.plist --timestamp=none --generate-entitlement-der $app
  plist=build/archive/HIFI.xcarchive/Info.plist
  /usr/libexec/PlistBuddy -c "Set :ApplicationProperties:Team 42Y5ADDZL2" \
    -c "Set :ApplicationProperties:SigningIdentity $(openssl x509 -inform DER -in $signing/dist.cer -noout -subject -nameopt multiline | sed -n 's/^ *commonName *= *//p')" $plist
else
  xcodegen generate --quiet
  nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI -configuration Release \
    -destination 'generic/platform=iOS' -derivedDataPath build/store -archivePath build/archive/HIFI.xcarchive \
    CODE_SIGN_IDENTITY="$identity" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
    PROVISIONING_PROFILE_SPECIFIER="HIFI App Store" CURRENT_PROJECT_VERSION=$build \
    archive -quiet
fi
echo "archived build $build"

destination=upload
[[ ${1:-} == --no-upload ]] && destination=export
cat > build/archive/ExportOptions.plist <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>$destination</string>
  <key>teamID</key><string>42Y5ADDZL2</string>
  <key>signingStyle</key><string>manual</string>
  <key>signingCertificate</key><string>$identity</string>
  <key>provisioningProfiles</key><dict><key>com.natesoftware.hifi</key><string>HIFI App Store</string></dict>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
EOF
auth=()
[[ $destination == upload ]] && auth=(-authenticationKeyPath "${ASC_API_KEY_PATH/#\~/$HOME}"
  -authenticationKeyID "$ASC_API_KEY_ID" -authenticationKeyIssuerID "$ASC_API_KEY_ISSUER_ID")
xcodebuild -exportArchive -archivePath build/archive/HIFI.xcarchive -exportPath build/archive/export \
  -exportOptionsPlist build/archive/ExportOptions.plist $auth -quiet
[[ $destination == upload ]] && echo "uploaded build $build to App Store Connect" || echo "exported build/archive/export/HIFI.ipa"
