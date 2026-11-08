#!/bin/zsh
# Deploys HIFI radio to Alexa as an Alexa-hosted skill (Amazon runs the Lambda, free).
#
#   alexa/scripts/deploy.sh            build the model and covers, sync, deploy
#   alexa/scripts/deploy.sh --dry-run  build and sync only
#
# One-time setup, by Nate, in his own terminal (both open a browser for the Amazon login):
#   npm i -g ask-cli
#   ask configure                      # Amazon developer account; no AWS account needed
#   cd alexa && ask new                # skill name "HIFI radio", Node.js, Alexa-hosted,
#                                      # template "Hello World", folder name "hosted"
# `ask new` creates alexa/hosted/ (gitignored), a clone of the skill's own git repo at
# Amazon. This script copies skill-package/ and lambda/ over it and runs `ask deploy`.
set -euo pipefail
here=${0:A:h}
alexa=${here:h}
root=${alexa:h}
cd "$root"

node alexa/scripts/build-model.mjs
python3 alexa/scripts/make-covers.py

if [[ ! -d alexa/hosted/.ask ]]; then
  echo "alexa/hosted is not set up yet. Once, in your terminal:" >&2
  echo "  cd $alexa && ask new     (HIFI radio, Node.js, Alexa-hosted, Hello World, folder: hosted)" >&2
  exit 1
fi

rsync -a --delete --exclude node_modules --exclude stations.json alexa/lambda/ alexa/hosted/lambda/
cp alexa/lambda/stations.json alexa/hosted/lambda/stations.json
rsync -a --delete alexa/skill-package/ alexa/hosted/skill-package/
# The hosted repo already knows its skill id; the manifest and model come from here.
if [[ ${1:-} == --dry-run ]]; then echo "Synced into alexa/hosted (dry run)."; exit 0; fi

# The covers and icons the manifest points at have to be live before Amazon validates it.
for url in https://hifi.nates-software.com/alexa/icon-512.png https://hifi.nates-software.com/alexa/covers/radio-paradise.png; do
  curl -sfI "$url" >/dev/null || { echo "Not live yet: $url  (release the site first: withkeys npm run release)" >&2; exit 1; }
done

cd alexa/hosted
ask deploy
echo "Deployed. Test on an Echo signed in to the developer account: \"Alexa, open HIFI radio\"."
echo "To publish: ask smapi submit-skill-for-certification --skill-id \$(jq -r '.profiles.default.skillId' .ask/ask-states.json)"
