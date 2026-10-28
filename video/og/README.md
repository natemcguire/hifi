# Link-preview video (og:video)

The 13 s loop and poster behind the landing page's link previews: `shots/og.mp4` (1280×720) and `shots/og.jpg` (1200×630). A HyperFrames composition of the real web player.

- `capture.mjs` takes the player frames in `assets/frames/` from the live site, at 340×544 and 3×, through a headless Chrome reached over CDP on port 9333 (playwright-core). The Now Playing frames tick once a second. The music is the same track (`assets/music.mp3`) from 0:00, so the clock matches.
- Render on the MacBook Pro, never in Chrome on the mini: `npx hyperframes check`, `npx hyperframes render -q looks -o renders/hifi-og.mp4`.
- Web files: `ffmpeg -i renders/hifi-og.mp4 -vf scale=1280:720 -c:v libx264 -crf 22 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ../../shots/og.mp4`, and the poster frame at 5.6 s scaled to 1200×675 and cropped to 1200×630.
