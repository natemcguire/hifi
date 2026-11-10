# HIFI Live: 24/7 YouTube streams (design mockup)

A static design prototype, not part of the HIFI site and not a stream. Preview:
https://youtube-live.hifi-mockups.pages.dev/ (lineup) and `/room.html?s=<station-id>` (one room;
`?s=fireside-christmas` is the Christmas variant).

```sh
npm run mockup:live          # builds dist-youtube-mockup/
npm run mockup:live:deploy   # builds and deploys it to the hifi-mockups Pages project, branch youtube-live
```

- `lineup.json` picks the streams and adds titles, moods, window weather and the Christmas setlist.
  Names, colors, genres, taglines, tracks and the TV clips come from `stations.json` at build time.
- `scene.js` draws the room (wood paneling, window, lava lamp, CRT with the station's clips under
  scanlines, noise, a tracking band and VHS wobble, a spinning record). Sizes are in `cqw`, so the
  same room is a thumbnail or a full frame.
- `posters/` are single frames of each card's clip, shown until the clip plays.
- `screens/` holds screenshots of the lineup and the Christmas room.

Rights: only HIFI's own music. Lo-Fi Beats to Work To and Fireside Christmas relay SomaFM in the app,
so their streams need their own generated catalogs first. The Christmas stream uses public-domain
compositions only; modern songs (All I Want for Christmas Is You, Last Christmas, White Christmas…)
would need licensing even as covers.

The turntable is CSS. For the real render, Guillermo Rauch's record player sim
(https://github.com/rauchg/vinyl, MIT) could draw the deck.
