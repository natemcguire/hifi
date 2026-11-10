# Vendored: rauchg/vinyl

Unmodified copies of eight modules from Guillermo Rauch's record player simulation,
https://github.com/rauchg/vinyl (MIT, see `LICENSE`), commit
`bcc9264509d78ccbf4a449618f19c1cc3104b49c` (2026-11-08).

- `cut.js`, `press.js`, `geometry.js`, `dsp.js`: the lathe and the pressing plant. `channel/tools/sides.mjs`
  cuts each stream's side of HIFI music into a spiral groove with them.
- `render.js`, `gl-util.js`, `shaders.js`, `label.js`: the WebGL2 deck. `channel/stream/deck.js` draws the
  close-up of the turntable with it, the disc drawn from our own cut; it replaces the label art with a HIFI label.

The audio engine (stylus physics) is not used: the stream's sound is the side's audio, muxed by ffmpeg.
To update, copy the same files from a newer commit and change the hash above.
