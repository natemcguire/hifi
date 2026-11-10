#!/bin/zsh
# Copies the channel bundle (dist-channel/, from build.mjs) to the MacBook Pro, which renders and streams.
# The Pro can't read the mini's share over SSH, so the bundle goes over rsync to ~/hifi-channel/bundle;
# renders and tapes live next to it in ~/hifi-channel/out and are never copied back.
#   channel/tools/stage-pro.sh [host]        then on the Pro: cd ~/hifi-channel/bundle && HIFI_CHANNEL_OUT=~/hifi-channel/out node tools/...
set -euo pipefail
host=${1:-macbook-pro}
repo=${0:A:h:h:h}
[[ -f $repo/dist-channel/streams.json ]] || { echo "build first: node channel/tools/build.mjs" >&2; exit 1; }
ssh -o BatchMode=yes ${host} 'mkdir -p ~/hifi-channel/bundle ~/hifi-channel/out'
rsync -a --delete $repo/dist-channel/ ${host}:hifi-channel/bundle/
echo "staged dist-channel/ on ${host}:~/hifi-channel/bundle"
