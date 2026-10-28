# HIFI TV clips

Now Playing shows a station's own clip (`tv/<station>-N.mp4`, listed under `tv` in `stations.json`) where the cover would be, under the station name. The clip changes with the song.

To add clips:
1. Add `{"id": "<station>-<n>", "prompt": "..."}` entries to a prompts file. Old home-video scenes work best; no people's faces up close, no brands, no text.
2. Generate on the mini (xAI Grok Imagine, about $0.12 per 6 s clip): `keys run --only GROK_API_KEY -- python3 -I video/tv/gen_grok.py video/tv/prompts-2.json <raw-dir>`
3. Give them the look on the MacBook Pro, never the mini: `tvify.sh raw.mp4 tv/<id>.mp4 [mono]` (136 px, 20 colours, ordered dither, hard pixels, loops by crossfading its end into its start).
4. Add the paths to the station's `tv` list and release.

fal (Wan 2.2) works too once its balance is topped up. OpenAI's Sora API was retired on 2026-09-24.
