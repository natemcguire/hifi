# HIFI

A click-wheel iPod internet radio for the browser, iPhone, iPad and Alexa: sixteen live house stations (four of them for Christmas), 95 big stations from 35 countries and four synth stations made here.

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

- **Radio** menu, one list with a search field above it (type anywhere on the list and it narrows by name, line or genre): Radio Paradise, eleven SomaFM channels (Boot Liquor, Sonic Universe, Indie Pop Rocks!; four for working, Working for the Weekend, Lo-Fi Beats to Work To, Code All Night and Y2K Chill-Out: SomaFM's Groove Salad, Fluid, DEF CON Radio and Groove Salad Classic; and for the season Soulful Christmas, Christmas at the Mall, Fireside Christmas and Rockin' Around the Tree: SomaFM's Jolly Ol' Soul, Department Store Christmas, Christmas Lounge and Christmas Rocks!), Pop Girl Radio from Exclusive Radio, RDS (Radio Dimensione Suono, from Rome) and 101X Chillville, streamed straight from their servers; the list goes on with Late Night Jazz, Jazz24 and 95 of the world's big free stations, one row per country that opens that country's list (see World stations). Nothing is proxied or rehosted. Then the **Synth Sounds**: Dial-Up, Shareware Summer, Night Build and Pixel Drift, procedurally composed MP3s in `tracks/`. Each one plays like a broadcast: the current track is picked from wall-clock time, so everyone hears the same thing.
- `stations.json` also carries `features` (today `christmas`): flags the web player and the apps read live, so a look can be switched on for everyone by editing the file and releasing. In the apps a long press on the title bar (the strip with the battery) turns the Christmas look on or off for that device ahead of the flag, so testers can see it any time.
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
- `npm run deploy:test` builds and deploys the working tree to the test Worker `nsw-hifi-test`
  (`wrangler.test.toml`, on workers.dev, not indexed). QA a change there before a release.

### Web-only stations

A station under `webStations` in `stations.json` is on the web player only. The iPhone and iPad
app and the Alexa skill read `stations`, so they never show it, whatever build they are. A new
station whose permission is still open goes in `webStations` first and moves to `stations` when
Nate clears it. RDS did on 2026-11-15, and the 97 world stations on 2026-11-18, the day they
were added. The list is empty now.

### World stations

97 stations added on 2026-11-18, in `stations` since Nate cleared them that day, so the web
player, the iPhone and iPad app and the Alexa skill all play them:

- **Late Night Jazz** (Ella Radio): slow instrumental ballads, piano trios and tenor sax. The
  closest free stream to the Spotify playlist Dark Academia Jazz; Jazz24 is the broader one.
- **The hit stations of the biggest metros**, 58 of them. United States, one for each of the
  ten largest metros: Z100 (New York), KIIS FM (Los Angeles), 103.5 KISS FM (Chicago), 106.1
  KISS FM (Dallas), WiLD 94.9 (San Francisco), 104.1 KRBE (Houston), HOT 99.5 (Washington),
  Power 96.1 (Atlanta), Q102 (Philadelphia), KISS 108 (Boston). United Kingdom: Radio X,
  Capital XTRA, Smooth Radio. Germany: Bayern 3, Antenne Bayern, NDR 2, Radio Hamburg, 104.6
  RTL, 98.8 KISS FM, hr3, Hit Radio FFH, bigFM. France: Skyrock, Fun Radio, RTL2, Europe 2,
  RFM. Spain: Cadena 100, Cadena Dial, Kiss FM, Flaix FM, RAC105. Italy: Radio 105, Radio Kiss
  Kiss, R101, Virgin Radio. Netherlands: Radio 538, Sky Radio, SLAM!. Canada: KiSS 92.5.
  Australia: KIIS 1065, Nova 96.9, KIIS 101.1, Nova 100, Nova 106.9, Nova 93.7, Nova 919.
  Brazil: Mix FM, 89 FM, Band FM, Nativa FM, JB FM. Mexico: LOS40, Alfa 91.3, La Z, Stereo
  Joya, Beat 100.9, D99.
- **Jazz24** (KNKX, Seattle): classic jazz, ballads and standards, picked to match the Spotify
  playlist Dark Academia Jazz.
- **The big free stations of the main markets.** Europe: Heart and Capital (UK), 1LIVE and SWR3
  (Germany), NRJ (France), LOS40 (Spain), Qmusic (Netherlands), Studio Brussel (Belgium),
  Sveriges Radio P3, NRK P3, NOVA (Denmark), YleX (Finland), RTÉ 2FM, RMF FM (Poland), Radio
  SRF 3, Rádio Comercial (Portugal), Power Türk. North America: KEXP, KCRW, CBC Music, Exa FM
  (Mexico). South America: Antena 1 (Brazil), La 100 (Argentina), Tropicana (Colombia), Rock &
  Pop (Chile). Asia-Pacific: triple j, The Edge (New Zealand), Kiss92 (Singapore), Prambors
  (Indonesia), Hitz (Malaysia), Cool Fahrenheit (Thailand), Love Radio (Philippines). Middle
  East: Galgalatz (Israel). Africa: Metro FM (South Africa), Cool FM (Nigeria), Capital FM
  Kenya, Hit Radio (Morocco).

Each plays the broadcaster's own public stream, tested from the US. They have no song feed, so
the list shows a fixed line (`subtitle`) under the name instead of the song. Left out because
the broadcaster offers no open stream outside its own app or country, or none a browser can
play over HTTPS: the BBC, Japan, South Korea, China, Hong Kong, India, Saudi Arabia, the UAE,
Egypt, Mediacorp in Singapore (it answers US listeners with a "not available" clip), Hitradio
Ö3, DR P3 and RTL 102.5. StreamTheWorld closes a connection after 32 KB unless it is a media
request (`Range` and `Accept-Encoding: identity`), which is what a browser's audio element
sends; test those streams that way.

A world station carries a `country` code, named in `countries` at the top of `stations.json`.
The Radio list shows one row per country after the house stations; the row opens that
country's list, and a search looks through every station at once. The apps do the same from
1.0.4 on; an older build shows every station in one long list. The nine iHeart stations
have a song feed (`/api/now-playing`, from iHeart's public track endpoint). The other metro
stations carry a `line` ("Houston · Top 40"), shown under the name when there is no song.
Also left out: Bauer's UK stations (KISS, Hits Radio, Absolute Radio), which answer only with
a listener token, Bell's and Stingray's Canadian stations, which play only in Canada, and
Cogeco's in Montreal, which are HLS only.

A new stream host goes in `MEDIA_HOSTS` in `worker.js` (the page's `media-src`), together with
any host the stream redirects to.

RDS song titles come from the station's Icecast status through `/api/now-playing?station=rds`.

## iPhone and iPad app

`ios/` is a native SwiftUI player styled like a classic click-wheel iPod, generated with
[XcodeGen](https://github.com/yonaskolb/XcodeGen). It plays the same catalog with background
audio and lock-screen controls. HIFI is iPhone and iPad only: the Mac app was removed on
2026-11-19 (Nate: "Don't ever submit to the Mac App Store", then "remove the whole Mac app").
Nothing here builds, signs or submits for macOS, and `/download` on the site now goes to the
App Store listing.

1. Set your Apple team in `ios/project.yml` and your bundle IDs.
2. `cp ios/scripts/devices.example ios/scripts/devices.local`, list your iPhones and name the Mac
   that compiles (`HIFI_BUILD_HOST`). The App Store and screenshot scripts compile there
   unsigned and sign here; the keys stay on this Mac. `HIFI_BUILD_HOST=local` compiles here.
3. `ios/scripts/make-signing.py` (App Store Connect API key) creates a dedicated certificate,
   keychain and profile; `--store` adds the distribution certificate and App Store profile.
4. `ios/scripts/build-iphone.sh && ios/scripts/install-iphone.sh`.
5. App Store: `withkeys ios/scripts/upload-appstore.sh` compiles and uploads the iPhone build;
   `withkeys <python with pyjwt> ios/scripts/appstore-listing.py [--submit]` fills the listing.
6. Story screenshots (the listing since 2026-11-19, iPhone and iPad): six slides that read
   as one strip, ink drawings on paper, in `ios/Screenshots/story/{iphone,ipad}`, copied as
   `1-free.png` … `6-why-free.png` into `ios/Screenshots/{iphone,ipad}`, which is what the
   listing uploads (`frame-screenshots.py` writes the older framed set there). Capture with
   `HIFI_SHOTS_RAW=Screenshots/story/raw` in front of `capture-screenshots.sh`, draw with
   `keys run --only GROK_API_KEY -- python3 -I ios/scripts/story-art.py ios/Screenshots/story/art`,
   then `python3 ios/scripts/story-screenshots.py`. To ship them, copy a set into
   `ios/Screenshots/{iphone,ipad}`, then `appstore-listing.py --screenshots`
   replaces only the screenshots; a version waiting for review is taken out of review first
   (Apple refuses screenshots then), and `--submit` sends it back.

Music and visuals roadmap: `docs/generative-radio.md`.

## License

MIT, see `LICENSE`. The synth tracks in `tracks/` are original and covered by the same license.
Live stations belong to their broadcasters; HIFI only links to their public streams.
