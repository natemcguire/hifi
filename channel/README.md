# HIFI Live: the YouTube channel

Six 24/7 live streams from the HIFI stations, built from the mockup in `mockups/youtube-live/`:
Night Build, Dial-Up, Shareware Summer, Pixel Drift, Lo-Fi Beats to Work To and (December 1 to
January 6) Fireside Christmas. Each one is a mid-90s den on a camcorder tape: the station's HIFI TV
clips on the CRT, a new clip with every song, the lava lamp, rain or snow at the window, and close-ups
of the record player with the needle in a groove cut from the music you're hearing.

Nothing here publishes anything. Going live needs Nate (see the checklist at the end).

## What's where

| | |
|---|---|
| `channel.json` | the plan: channel name, handles, description, keywords, links, the six streams' titles, descriptions and tags, encoding |
| `stream/` | the broadcast frame (`stream.html?s=<id>`), 1920x1080: `tape.js` composites the room (from the mockup's `scene.js`) and runs the tape look; `deck.js` draws the turntable close-up |
| `vendor/vinyl/` | eight modules of Guillermo Rauch's record player simulation (MIT, `VENDORED.md`): the lathe cuts each stream's music into a spiral groove, the WebGL2 deck draws it |
| `art/` | the templates for thumbnails, banner, avatar and watermark |
| `tools/` | `build.mjs` (bundle), `stage-pro.sh`, `sides.mjs` (records and audio), `render.mjs` (tapes), `art.mjs`, `push.mjs` (RTMPS) |
| `launchd/` | a LaunchAgent template, one per stream. Not installed |

Music: the four synth stations play their tracks from `stations.json` (`tracks/`). Lo-Fi Beats and
Fireside Christmas play our own catalogs in `live/music/` (`catalog.json`; rights in `live/music/RIGHTS.md`).
The build skips a stream whose music isn't made yet. In the app those two stations relay SomaFM, which
we can't put on YouTube.

## How it works

1. **Build** on the mini (copies files only): `npm run channel:build` writes `dist-channel/`: the page,
   the tools, the photos, clips and music, `streams.json`, and `publish/`, the text to paste into
   YouTube Studio for the channel and for each stream.
2. **Stage**: `npm run channel:stage` rsyncs the bundle to `macbook-pro:~/hifi-channel/bundle`. The
   Pro can't read the mini's share over SSH, and the heavy steps must not run on the mini.
3. **Program** on the Pro: `node tools/sides.mjs [id…]` loudness-normalises every track (-14 LUFS),
   splits the catalog into LP sides of at most 16 minutes, and cuts and presses each side with the
   vinyl lathe. It writes `out/sides/<id>/program.json` (track times, groove geometry),
   `record-<side>.vis` (how the groove looks) and `program.m4a` (one full loop of the audio, with the
   gaps between tracks where the cut put them). About 3 minutes per station.
4. **Tape** on the Pro: `node tools/render.mjs <id>` opens the frame in headless Chrome (GPU, Metal)
   and draws it one frame at a time on the program clock. Each frame goes to ffmpeg as a JPEG and comes
   out as H.264 1080p30 (6 Mbps CBR, 2 s keyframes). The picture is muxed with `program.m4a` into
   `out/tapes/<id>.mp4`, a loop of 13 to 15 minutes for a synth station. It runs at about 9 fps, so a
   14-minute tape takes about 45 minutes. It works in 60 s segments and picks up where a stopped run
   left off. `--seconds 30` makes a test tape; `--stills 4,16` writes single frames.
5. **Art** on the Pro: `node tools/art.mjs` writes `out/art/`: a 1280x720 thumbnail per stream (a real
   frame of its tape), the 2560x1440 banner (six rooms in the 1546x423 safe area), the 800x800 avatar
   and the 150x150 watermark.
6. **Push** on the Pro: `node tools/push.mjs <id>` loops the tape to `rtmps://a.rtmps.youtube.com/live2`
   in real time with `-c copy`, so no re-encode: six streams cost the laptop almost nothing but
   upload. If ffmpeg drops it starts again with backoff; after 12 failures in a row it stops. The key
   is never printed. `--dry-run out.flv --seconds 90` runs the same pipe into a file.

On the Pro, with `cd ~/hifi-channel/bundle && export HIFI_CHANNEL_OUT=~/hifi-channel/out`:

```sh
node tools/sides.mjs                              # all streams with music
for id in night-build dial-up shareware-summer pixel-drift lofi-beats fireside-christmas; do node tools/render.mjs $id; done
node tools/art.mjs
node tools/push.mjs night-build --dry-run /tmp/test.flv --seconds 90
```

The design calls for headless browser capture pushed to YouTube Live, and that is what this is, done
ahead of time. The browser renders frame-exact tapes, never in a hurry, and ffmpeg plays them out.
Capturing a live browser in real time for six streams would mean six Chromes and six encoders on a
16 GB laptop around the clock, dropping frames whenever Nate uses it. The tape is a loop by nature:
the camcorder date stamp jumps back at the seam, which reads as an edit (there's a burst of noise
there), and the needle goes back to the lead-in off camera.

## Go-live checklist (needs Nate)

1. **Create the channel** (a Brand Account under Nate's Google account): name "HIFI", the first free
   handle from `channel.json`, then paste `publish/channel.txt`. Upload `out/art/avatar.png`,
   `banner.png` and `watermark.png`.
2. **Turn on live streaming**: YouTube Studio → Go live. A new channel needs phone verification and
   then waits up to 24 hours.
3. **Six streams**: Studio → Go live → Stream → create one stream key per stream, each reusable, and
   one scheduled live event per stream with auto-start on, auto-stop off, DVR on and normal latency.
   Use the title, description and tags from `publish/<id>.txt` and the thumbnail `out/art/thumb-<id>.png`.
   Tick "altered or synthetic content": the rooms and clips are AI-generated and look real.
4. **Keys on the Pro**, once per stream, typed into Terminal on the Pro by Nate (never pasted to an agent):
   `security add-generic-password -s hifi-live -a <id> -w` (it prompts for the key).
5. **Upload**: six streams at 6 Mbps need about 39 Mbps of steady upload. Start with one or two, or
   lower `videoBitrate` in `channel.json` and re-render.
6. **Start**: `node tools/push.mjs <id>` in a terminal, or for 24/7 install the LaunchAgent
   (`launchd/…template`, instructions inside). The Pro has to stay awake, on power, with the lid open
   or in clamshell on a display. A laptop is a fine start. If the channel takes off, move the push to
   a small always-on box, since it is only ffmpeg copying files.

## Costs and risks

- YouTube Live is free. Nothing in this pipeline costs money. New room photos or TV clips would
  (Grok Imagine, about $0.12 a clip).
- Content ID: our music is original, but carols are public-domain melodies that others have
  registered recordings of, so a false claim on Fireside Christmas is possible. Dispute it with
  `live/music/RIGHTS.md`.
- YouTube can end a 24/7 stream after long runs or ingest drops. push.mjs reconnects to the same key,
  and with a reusable key and the event's auto-stop off, the broadcast resumes.

## Screens

`screens/`: a wide shot (Dial-Up, rain on the window), the three deck close-ups (Night Build), the
thumbnails and the banner, from the first renders on the Pro (2026-11-10).
