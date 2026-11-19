#!/bin/zsh
# Deploys HIFI radio for Alexa: the endpoint to Railway, the voice model and manifest to Amazon.
#
#   alexa/scripts/deploy.sh            build model and covers, deploy endpoint, push model + manifest
#   alexa/scripts/deploy.sh --model    only rebuild and push the voice model (after a catalog change)
#
# Needs: `railway` (logged in, project "hifi", service "alexa") and `ask` (profile "default",
# `ask configure --no-browser` once). The skill id is in alexa/skill.id.
# Covers and icons come from the site, so release it (withkeys npm run release) after a
# cover change.
set -euo pipefail
here=${0:A:h}
alexa=${here:h}
root=${alexa:h}
cd "$root"
skill=$(<alexa/skill.id)
endpoint=https://alexa-production-80ec.up.railway.app/alexa

node alexa/scripts/build-model.mjs

wait_for() {  # resource name [locale] → polls until the build settles, fails on FAILED
  local n=0 state  # not "status": zsh keeps that name read-only
  sleep 5  # the status still shows the previous build for a moment
  while (( n < 90 )); do
    state=$(ask smapi get-skill-status --skill-id "$skill" --resource "$1" | python3 -c "
import json,sys; d=json.load(sys.stdin)['$1']; d=d.get('${2:-}',d)['lastUpdateRequest']; print(d['status']);
[print(e['message'],file=sys.stderr) for e in d.get('errors',[])]")
    [[ $state == SUCCEEDED ]] && return 0
    [[ $state == FAILED ]] && { echo "$1 build failed" >&2; return 1; }
    sleep 5; n=$((n+1))
  done
  echo "$1 build still running" >&2; return 1
}

if [[ ${1:-} != --model ]]; then
  python3 alexa/scripts/make-covers.py
  (cd alexa/lambda && railway up --detach -m "HIFI radio for Alexa") 
  python3 - "$endpoint" <<'PY' > /tmp/hifi-alexa-manifest.json
import json,sys
m=json.load(open('alexa/skill-package/skill.json'))
m['manifest']['apis']['custom']['endpoint']={'uri':sys.argv[1],'sslCertificateType':'Wildcard'}
json.dump(m,sys.stdout)
PY
  ask smapi update-skill-manifest --skill-id "$skill" --stage development --manifest "file:/tmp/hifi-alexa-manifest.json" >/dev/null
  wait_for manifest
fi

# One model per English locale in skill.json (build-model.mjs writes them all).
for model in alexa/skill-package/interactionModels/custom/*.json; do
  locale=${model:t:r}
  ask smapi set-interaction-model --skill-id "$skill" --stage development --locale "$locale" \
    --interaction-model "file:$model" >/dev/null
  wait_for interactionModel "$locale"
done
echo "Deployed skill $skill. Try: \"Alexa, ask HIFI live radio for jazz\"."
echo "To publish: ask smapi submit-skill-for-certification --skill-id $skill"
