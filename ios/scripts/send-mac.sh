#!/bin/zsh
# Sends the notarized DMG to another Mac and installs it there, so that Mac gets
# updates without a checkout or a build of its own (MacBook Pro, 2026-10-30).
# Run as: withkeys ios/scripts/send-mac.sh macbook-pro [--reuse]
# Builds a fresh DMG with build-dmg.sh first; --reuse sends the last one.
set -euo pipefail
cd "$(dirname "$0")/.."
host=${1:?usage: send-mac.sh HOST [--reuse]}
[[ ${2:-} == --reuse ]] || scripts/build-dmg.sh
dmg=build/dmg/HIFI.dmg
[[ -f $dmg ]] || { echo "no $dmg: run without --reuse"; exit 1; }
scp -q $dmg ${host}:/tmp/HIFI.dmg
ssh $host 'set -e
 osascript -e "tell application id \"com.natesoftware.hifi.mac\" to quit" 2>/dev/null || true
 for _ in {1..50}; do pgrep -xq HIFI || break; sleep 0.1; done
 mnt=$(mktemp -d /tmp/hifi-dmg.XXXX)
 hdiutil attach -quiet -nobrowse -readonly -mountpoint $mnt /tmp/HIFI.dmg
 rm -rf /Applications/HIFI.app
 ditto $mnt/HIFI.app /Applications/HIFI.app
 hdiutil detach -quiet $mnt; rm -f /tmp/HIFI.dmg
 /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/HIFI.app
 spctl -a /Applications/HIFI.app
 echo "installed HIFI $(defaults read /Applications/HIFI.app/Contents/Info CFBundleShortVersionString) ($(defaults read /Applications/HIFI.app/Contents/Info CFBundleVersion)) on $(scutil --get ComputerName)"
 open /Applications/HIFI.app'
