#!/bin/zsh
# Installs the last build on every iPhone in scripts/devices.local and opens it.
# A phone that is not paired with this Mac is staged on HIFI_RELAY_HOST (another
# Mac it is paired with) and installed from there.
set -euo pipefail
cd "$(dirname "$0")/.."
app=build/iphone/Build/Products/Release-iphoneos/HIFI.app
bundle=com.natesoftware.hifi
[[ -f scripts/devices.local ]] && source scripts/devices.local
[[ -n ${HIFI_IPHONES:-} ]] || { echo "No iPhones: copy scripts/devices.example to scripts/devices.local"; exit 1; }
devices=(${=HIFI_IPHONES})
xcrun devicectl list devices --json-output /tmp/hifi-devices.json >/dev/null 2>&1 || echo '{}' > /tmp/hifi-devices.json
for entry in $devices; do
  label=${entry%%:*} udid=${entry##*:}
  if grep -q "$udid" /tmp/hifi-devices.json; then
    if xcrun devicectl device install app --device "$udid" "$app" >/dev/null 2>&1; then
      xcrun devicectl device process launch --device "$udid" --terminate-existing $bundle >/dev/null 2>&1 \
        && echo "$label: installed and launched" || echo "$label: installed (launch skipped)"
    else
      echo "$label: INSTALL FAILED (is the phone unlocked and connected?)"
    fi
  else
    if [[ -z ${HIFI_RELAY_HOST:-} ]]; then echo "$label: not paired with this Mac"; continue; fi
    echo "$label: not paired here, installing through $HIFI_RELAY_HOST"
    tar -C "$(dirname "$app")" -cf - HIFI.app | ssh -oBatchMode=yes -oConnectTimeout=8 "$HIFI_RELAY_HOST" \
      "rm -rf ~/Library/Caches/hifi-install && mkdir -p ~/Library/Caches/hifi-install && tar -C ~/Library/Caches/hifi-install -xf - \
       && xcrun devicectl device install app --device $udid ~/Library/Caches/hifi-install/HIFI.app >/dev/null 2>&1 \
       && (xcrun devicectl device process launch --device $udid --terminate-existing $bundle >/dev/null 2>&1; echo '$label: installed via $HIFI_RELAY_HOST') \
       || echo '$label: INSTALL FAILED via $HIFI_RELAY_HOST (is the phone unlocked and plugged in?)'"
  fi
done
