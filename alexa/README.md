# HIFI radio for Alexa

The HIFI dial on Echo speakers. "Alexa, open HIFI radio" picks up where you left off;
"Alexa, ask HIFI radio to play pop girl" tunes a station; "next" and "previous" move along
the dial like the click wheel; "what's playing" names the song.

- `lambda/` — the skill code (Node, ASK SDK v2). `index.js` handles the requests,
  `search.js` ranks what was said against the stations (the same scheme as the app's
  `StationSearch`), `catalog.js` reads the live `stations.json`, `store.js` remembers each
  listener's station and offset on the volume. `server.js` is the Railway entry point.
- `skill-package/` — the manifest and the voice model. The model is **generated**: run
  `node alexa/scripts/build-model.mjs` after any catalog change. It also bundles a copy of
  `stations.json` with the Lambda for when the site is unreachable.
- `assets/` — cover art for the Echo Show and the store icons, drawn by
  `python3 alexa/scripts/make-covers.py` (same cover as the app) and served from the site at
  `https://hifi.nates-software.com/alexa/`.

Live stations stream straight from the catalog. The synth stations (dial-up, shareware
summer, night build, pixel drift) play their tracks back to back; the next one is queued
before each ends. The video stations are HIFI TV only and are left out.

## Deploying

The endpoint runs on Railway (project `hifi`, service `alexa`, `lambda/server.js`), behind
the ASK Express adapter, which checks Amazon's signature on every request. Listener state
sits on the service's volume at `/data`. The skill record lives under the McGuire LLC vendor;
its id is in `skill.id`.

```
alexa/scripts/deploy.sh            # endpoint + manifest + voice model
alexa/scripts/deploy.sh --model    # voice model only, after a catalog change
```

The script needs the Railway CLI (logged in) and the ASK CLI (`ask configure --no-browser`,
once). Covers and icons come from the site, so release it (`withkeys npm run release`)
after a cover change. `index.js` also exports a Lambda handler, so the same code can move
to AWS Lambda or an Alexa-hosted skill later without changes.

Testing: any Echo on the developer account hears the development skill. The ASK CLI's
`simulate-skill` runs text turns end to end. Publishing is
`ask smapi submit-skill-for-certification --skill-id $(cat alexa/skill.id)` and a few days
of Amazon's certification.

## Saying things

| You say | It does |
|---|---|
| open HIFI radio | resumes the last station (Radio Paradise the first time) |
| play lo-fi beats / play Taylor Swift / play something for work | ranks names, tags, genre and lines; plays the best fit |
| next, previous | the next or previous station on the dial |
| what's playing | the song, from the same now-playing feed the app uses |
| list stations | reads the dial |
| pause, resume, stop | as expected; track stations resume mid-track |
