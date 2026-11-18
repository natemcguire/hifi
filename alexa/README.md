# HIFI radio for Alexa

The HIFI dial on Echo speakers. "Alexa, open HIFI live radio" picks up where you left off;
"Alexa, ask HIFI live radio to play pop girl" tunes a station; "next" and "previous" move along
the dial like the click wheel; "what's playing" names the song.

- `lambda/` — the skill code (Node, ASK SDK v2). `index.js` handles the requests,
  `search.js` ranks what was said against the stations (the same scheme as the app's
  `StationSearch`), `catalog.js` reads the live `stations.json`, `store.js` remembers each
  listener's station and offset on the volume. `server.js` is the Railway entry point.
- `skill-package/` — the manifest and the voice model. The model is **generated**: run
  `node alexa/scripts/build-model.mjs` after any catalog change. It also bundles a copy of
  `stations.json` with the Lambda for when the site is unreachable. Each station goes in with
  the ways its name is said: "z one hundred" for Z100, "one oh three point five kiss fm" and
  "kiss fm chicago" for 103.5 KISS FM, "k. e. x. p." for KEXP. `search.js` folds what Alexa
  heard the same way, so the spoken and the written name meet.
- A station's `say` in `stations.json` is how Alexa says its name when the label reads badly
  aloud: "kiss FM" for KIIS FM, "one live" for 1LIVE. Without it a world station is said as its
  label is written and a house station as its name in small letters.
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
`simulate-skill` runs text turns end to end, and `node --test alexa/lambda` checks what is said
against the station that should play. Publishing is
`ask smapi submit-skill-for-certification --skill-id $(cat alexa/skill.id)` and a few days
of Amazon's certification.

## Saying things

| You say | It does |
|---|---|
| open HIFI live radio | resumes the last station (Radio Paradise the first time) |
| play lo-fi beats / play Taylor Swift / play something for work | ranks names, tags, genre and lines; plays the best fit |
| play jazz / play late night jazz / play jazz twenty four | Jazz24 for plain "jazz"; the other two by name |
| play Z100 / play kiss FM / play KEXP / play one live | a world station by name; "kiss FM" is KIIS FM in Los Angeles |
| play kiss FM Chicago / play Houston / play Germany | by city or country; the first station there when several fit |
| next, previous | the next or previous station on the dial |
| what's playing | the song, from the same now-playing feed the app uses |
| list stations | reads the house stations, counts the world stations and names a few |
| pause, resume, stop | as expected; track stations resume mid-track |
