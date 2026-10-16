#!/bin/zsh
# Replaces /Applications/HIFI.app with the last Mac build and opens it.
set -euo pipefail
cd "$(dirname "$0")/.."
osascript -e 'tell application id "com.natesoftware.hifi.mac" to quit' 2>/dev/null || true
for _ in {1..50}; do pgrep -xq HIFI || break; sleep 0.1; done
rm -rf /Applications/HIFI.app
ditto build/mac/Build/Products/Release/HIFI.app /Applications/HIFI.app
# Make Finder and the Dock pick up a changed icon instead of their cached one.
touch /Applications/HIFI.app
/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f /Applications/HIFI.app
killall Dock 2>/dev/null || true
open /Applications/HIFI.app
