# HIFI Live: 24/7 YouTube streams (design mockup)

A static design prototype, not part of the HIFI site and not a stream. Preview:
https://youtube-live.hifi-mockups.pages.dev/ (lineup) and `/room.html?s=<station-id>` (one room;
`?s=fireside-christmas` is the Christmas variant).

```sh
npm run mockup:live          # builds dist-youtube-mockup/
npm run mockup:live:deploy   # builds and deploys it to the hifi-mockups Pages project, branch youtube-live
```

Look (Nate, 2026-11-10): photorealistic, but shown as if recorded on a 90s VHS camcorder.

- `lineup.json` picks the streams and adds titles, moods and the Christmas setlist.
  Names, colors, genres, taglines, tracks and the TV clips come from `stations.json` at build time.
- `rooms.json` holds the prompts for the photoreal room stills, one per stream, plus the camcorder
  date each tape was "shot" on. `rooms/<id>.jpg` are the stills; their CRT screens are chroma green.
- To redo a room: delete its jpg, then
  `keys run --only GROK_API_KEY -- python3 -I mockups/youtube-live/gen_rooms.py mockups/youtube-live/rooms.json mockups/youtube-live/rooms <id>`
  then `node mockups/youtube-live/calibrate.mjs` (needs ffmpeg; set the
  room's `labelSeed` to a pixel on the record label first). It writes `rooms/calibration.json`:
  the screen's box and corners and the label ellipse.
- `scene.js` composites each room in one WebGL pass: the station's clip keyed into the green glass
  through a homography (with scanlines, tube curve and the picture's glow on the room), the label
  print turning at 33⅓, the date stamp; then plays it back off tape: hand-held drift, tracking
  wobble, flagging, head-switching noise, a tracking band now and then, chroma bleed, soft luma
  with edge ringing, grain and dropouts. 4:3, pillarboxed in the 16:9 stream frame. Stream
  graphics (bug, lower third) are HTML on top. Without WebGL it shows the still.
- `screens/` holds screenshots of the lineup and the Christmas room.

Rights: only HIFI's own music. Lo-Fi Beats to Work To and Fireside Christmas relay SomaFM in the app,
so their streams need their own generated catalogs first. The Christmas stream uses public-domain
compositions only; modern songs (All I Want for Christmas Is You, Last Christmas, White Christmas…)
would need licensing even as covers.

Not animated yet: the lava lamps and the weather outside are part of each still.
