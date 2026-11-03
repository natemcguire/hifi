#!/bin/zsh
# Captures the raw Mac App Store screenshots on this Mac's own display: a sandboxed
# Debug build opened on each page with `-screenshot <page>` in an 840x1400 window
# (`-shotSize`), each window captured to Screenshots/raw/mac. Frame them with
# scripts/frame-screenshots.py --mac. Needs the hifi-build keychain (make-signing.py --mac)
# and a logged-in display; the shell doing this must be allowed to record the screen.
# Run as: ios/scripts/mac-screenshots.sh [--reuse]   (--reuse skips the build)
set -euo pipefail
cd "$(dirname "$0")/.."
signing=$HOME/.config/hifi-signing
keychain=$HOME/Library/Keychains/hifi-build.keychain-db
app=build/mac-shot/Build/Products/Debug/HIFI.app
pages=(1-main:home 2-tv:tv 3-radio:radio 4-live:live 5-synth:synthTV 6-connect:connect)

if [[ ${1:-} != --reuse ]]; then
  xcodegen generate --quiet
  security unlock-keychain -p "$(cat $signing/keychain-password)" $keychain
  nice -n 15 xcodebuild -project HIFI.xcodeproj -scheme HIFI-Mac -configuration Debug -destination 'platform=macOS,arch=arm64' \
    -derivedDataPath build/mac-shot CODE_SIGN_IDENTITY="$(cat $signing/mac-identity)" "OTHER_CODE_SIGN_FLAGS=--keychain $keychain" \
    CODE_SIGN_ENTITLEMENTS=Resources/MacStore.entitlements ONLY_ACTIVE_ARCH=YES build -quiet
fi

# The window number of HIFI's one window, for screencapture -l.
mkdir -p build/mac-shot
cat > build/mac-shot/winid.swift <<'SWIFT'
import CoreGraphics
let list = CGWindowListCopyWindowInfo([.optionOnScreenOnly, .excludeDesktopElements], kCGNullWindowID) as! [[String: Any]]
for w in list where (w["kCGWindowOwnerName"] as? String) == "HIFI" && (w["kCGWindowLayer"] as? Int) == 0 { print(w["kCGWindowNumber"]!); break }
SWIFT
[[ build/mac-shot/winid -nt build/mac-shot/winid.swift ]] || swiftc -O -o build/mac-shot/winid build/mac-shot/winid.swift 2>/dev/null

mkdir -p Screenshots/raw/mac
for pair in $pages; do
  name=${pair%%:*} page=${pair#*:}
  pkill -x HIFI 2>/dev/null || true
  while pgrep -qx HIFI; do sleep 0.5; done
  open -n $app --args -screenshot $page -shotSize 840x1400
  sleep 12   # the station is tuned, HIFI TV is rolling, the live song is in
  open $app  # in front, so the traffic lights are lit in every shot
  sleep 1
  id=$(build/mac-shot/winid)
  [[ -n $id ]] || { echo "no HIFI window for $page"; exit 1; }
  screencapture -x -o -l $id Screenshots/raw/mac/$name.png
  echo "captured $name ($page): $(sips -g pixelWidth -g pixelHeight Screenshots/raw/mac/$name.png | awk '/pixel/{printf "%s ", $2}')"
done
pkill -x HIFI 2>/dev/null || true
echo "raw Mac screenshots in Screenshots/raw/mac; frame them: /opt/homebrew/bin/python3.14 scripts/frame-screenshots.py --mac"
