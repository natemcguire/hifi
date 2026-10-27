# HIFI

A click-wheel iPod internet radio for the browser, iPhone and Mac: five live stations and four synth stations made here.

```sh
npm install && npm run dev    # builds dist/ and serves the site with wrangler dev
```

Live at https://hifi.nates-software.com/ (landing) and `/player` (the receiver).

## Get started

1. `npm install`
2. `npm run dev`
3. Open the URL wrangler prints and go to `/player`. Spin the wheel and press the center: browsers need a click before audio starts.

No build tools needed just to hack on the player: `python3 -m http.server 8080`, then open
`http://localhost:8080`. Serve it over HTTP. It won't work from `file://`.

## What it does

- **Radio** tab: Radio Paradise, three SomaFM channels (Boot Liquor, Sonic Universe, Indie Pop Rocks!) and Pop Girl Radio from Exclusive Radio, streamed straight from their servers. Nothing is proxied or rehosted.
- **Synth Sounds** tab: Dial-Up, Shareware Summer, Night Build and Pixel Drift, procedurally composed MP3s in `tracks/`. Each one plays like a broadcast: the current track is picked from wall-clock time, so everyone hears the same thing.
- `/player` (`index.html`, `app.js`, `styles.css`) is the same white click-wheel iPod as the native apps in `ios/Sources/IPod.swift`: drag the ring to scroll, center to choose, MENU to go back; on Now Playing the wheel is the volume. Arrow keys, Return, Escape and Space work too. It uses the Media Session API for lock-screen and media-key controls.
- Spotify: listeners sign in with PKCE through `https://nates-software.com/hifi/spotify/callback` (state `web.…`), which hands the code to `/spotify` (`spotify.js`) to finish in the browser. The ♥ saves live songs to their Liked Songs; their playlists show under Playlists.
- `worker.js` serves the site, `/api/now-playing` (relays the live stations' current song), and `/api/spotify-config` (the shared Client ID and Nate's playlist).
- The old Winamp-style player is kept in `archive/winamp-player/` and is no longer served.

## Usage

| | |
|---|---|
| `/player?station=night-build` | open on a station (ids are in `stations.json`) |
| `/player?autoplay=1` | start playing on load, once the host has had a user gesture |
| `/player?compact=1` | fill an iframe as an app surface, no page scroll |
| `/player?page=radio` | open on a screen: `radio`, `synth`, `nowPlaying`, `playlists`, `settings`, `about` |
| `python3 scripts/compose-instrumentals.py` | regenerate the synth tracks (needs NumPy and ffmpeg) |

`stations.json` is the catalog: names, tabs (`band`), streams, track lists and durations.

Embedding: post `{type:'hifi:connect',version:1}` to the iframe after load and it replies
with `hifi:height` and `hifi:status`. Only nates-software.com, its Pages previews, the HIFI
host and loopback are accepted. The bridge never starts playback.

## Deploy

```sh
npm run release    # clean commit required; builds, deploys the nsw-hifi Worker, checks live bytes
```

- If the post-deploy check fails, look at what's live before you deploy again.
- `wrangler.toml` routes the production hostname hifi.nates-software.com.

## iPhone and Mac app

`ios/` is a native SwiftUI player styled like a classic click-wheel iPod, generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen). It plays the same catalog with background
audio and lock-screen controls.

1. Set your Apple team in `ios/project.yml` and your bundle IDs.
2. `cp ios/scripts/devices.example ios/scripts/devices.local` and list your iPhones.
3. `ios/scripts/make-signing.py` (App Store Connect API key) creates a dedicated certificate,
   keychain and profile; add `--mac` for the Mac certificate.
4. `ios/scripts/build-iphone.sh && ios/scripts/install-iphone.sh`, or
   `ios/scripts/build-mac.sh && ios/scripts/install-mac.sh`.
5. Mac download outside the App Store: `make-signing.py --developer-id` (the Developer ID
   certificate needs the Account Holder; the script explains the manual step), then
   `withkeys ios/scripts/build-dmg.sh` signs, notarizes and staples `download/HIFI.dmg`,
   which the site serves at `/download`.

Music and visuals roadmap: `docs/generative-radio.md`.

## License

MIT, see `LICENSE`. The synth tracks in `tracks/` are original and covered by the same license.
Live stations belong to their broadcasters; HIFI only links to their public streams.
