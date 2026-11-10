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

## Commands

- `npm run dev` builds `dist/` and serves it with `wrangler dev`; the player is at `/player`.
- `npm run release` needs a clean commit. It builds, deploys the `nsw-hifi` Worker and checks the
  live bytes. If that check fails, look at what's live before deploying again.
- The Alexa skill has its own deploy: `alexa/scripts/deploy.sh` (see `alexa/README.md`).
- Everything else (URL parameters, the iOS and Mac app, synth tracks) is in `README.md`.
