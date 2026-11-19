# HIFI

## A new station ships with its TV clips (Nate, 2026-11-06)

A station and its HIFI TV clips go together. Never add or rename a station in `stations.json`
without its clips: four AI-generated clips per station (`tv/<station-id>-1.mp4` … `-4.mp4`),
listed under the station's `tv` key, in the same release. Renaming a station renames its clips.

How to make them is in `video/tv/README.md`: write prompts in a `video/tv/prompts-N.json`
file, generate with Grok Imagine on the mini, give them the look with `tvify.sh` on the
MacBook Pro (never the mini), then add the paths to the station.

**Why:** four work stations went live on 2026-11-05 with no clips, so their Now Playing
screens fell back to plain covers while every other station had video.

## A station without permission is web only (Nate, 2026-11-15)

`webStations` in `stations.json` is read only by the web player. A new station whose permission
is still open goes there, and moves to `stations` (the list the apps and Alexa read) only when
Nate says its permission is fine. RDS started there; Nate cleared it on 2026-11-15 and it is
now in `stations`. Radio Deejay has not been cleared.

The 97 stations added on 2026-11-18 (Late Night Jazz, Jazz24 and the world's big free stations, one
Radio row per `country`) started there too. Nate cleared them the same day and they are now in
`stations`; `webStations` is empty. Their stream hosts are in `MEDIA_HOSTS` in `worker.js`; the
list and what was left out are in `README.md` under World stations.

## No Mac app, never the Mac App Store (Nate, 2026-11-19)

"Don't ever submit to the Mac App Store", then "remove the whole Mac app (only iOS remains)".
HIFI ships for iPhone and iPad only. Don't add a macOS target, Mac Catalyst or "Designed for
iPad" on Mac, a DMG or Mac screenshots, and never submit, upload or edit anything for the macOS
version in App Store Connect. `/download` on the site redirects to the App Store listing.

## A station change reaches Alexa by its own deploy

The apps and the skill read the live `stations.json`, so a station in `stations` plays on Alexa as
soon as the site is released. Asking for it by name needs the voice model: run
`alexa/scripts/deploy.sh --model` after the release (the full deploy when `alexa/lambda` changed).
A name Alexa would read badly gets a `say` in the catalog ("kiss FM" for KIIS FM); see
`alexa/README.md`.

## Commands

- `npm run dev` builds `dist/` and serves it with `wrangler dev`; the player is at `/player`.
- `npm run deploy:test` builds and deploys the working tree to the test Worker `nsw-hifi-test`.
- `npm run release` needs a clean commit. It builds, deploys the `nsw-hifi` Worker and checks the
  live bytes. If that check fails, look at what's live before deploying again.
- The Alexa skill has its own deploy: `alexa/scripts/deploy.sh` (see `alexa/README.md`).
- Everything else (URL parameters, the iPhone and iPad app, synth tracks) is in `README.md`.
