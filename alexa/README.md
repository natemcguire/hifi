# HIFI radio for Alexa

The HIFI dial on Echo speakers. "Alexa, open HIFI radio" picks up where you left off;
"Alexa, ask HIFI radio to play pop girl" tunes a station; "next" and "previous" move along
the dial like the click wheel; "what's playing" names the song.

- `lambda/` — the skill code (Node, ASK SDK v2). `index.js` handles the requests,
  `search.js` ranks what was said against the stations (the same scheme as the app's
  `StationSearch`), `catalog.js` reads the live `stations.json`, `store.js` remembers each
  listener's station and offset in the skill's S3 bucket.
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

It is an Alexa-hosted skill: Amazon runs the Lambda and keeps the state bucket, at no cost,
and the skill's code lives in a git repo at Amazon that `ask deploy` pushes to. One-time
setup is in `scripts/deploy.sh`; after that:

```
alexa/scripts/deploy.sh
```

The manifest points at the covers and icons on the site, so release the site
(`withkeys npm run release`) before the first deploy and after any cover change.

Testing: an Echo signed in to the developer account hears the development skill as soon
as it's deployed; the Alexa app's Test tab also works. Publishing is one SMAPI call
(printed at the end of the deploy) and a few days of Amazon's certification.

## Saying things

| You say | It does |
|---|---|
| open HIFI radio | resumes the last station (Radio Paradise the first time) |
| play lo-fi beats / play Taylor Swift / play something for work | ranks names, tags, genre and lines; plays the best fit |
| next, previous | the next or previous station on the dial |
| what's playing | the song, from the same now-playing feed the app uses |
| list stations | reads the dial |
| pause, resume, stop | as expected; track stations resume mid-track |
