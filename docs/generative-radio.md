# Growing HIFI without losing its personality

This is a design/research note, not a claim that a generation service or daily programming already runs.

## What exists

Four original stations contain pre-rendered tracks; a fifth station connects directly to Radio Paradise. The original stations join a deterministic wall-clock rotation, with scheduled crossfades. The longer instrumentals are reproducible procedural compositions in `scripts/compose-instrumentals.py`. Four short tracks were supplied by the owner as AI-generated seeds. `stations.json` carries provenance and licensing notes; fictional artist aliases are identified in the catalog.

Visuals are generated in the browser from real frequency and waveform analysis. Spectrum, oscilloscope, orbit, silk and waterfall each expose constrained geometry variations and palettes. Visualization Off and reduced-motion behavior stay available. There is no per-frame server cost or AI request.

## Recommended generation workflow

1. Give each station a recipe: tempo range, scale/harmony, sound palette, rhythmic density, energy arc and target track length. Variation should preserve the station's recognizable character.
2. Render bounded batches offline from recipe + deterministic seed + composer version. Keep those inputs beside each artifact so a favorite can be reproduced. Vary arrangement, voicing, rhythmic accents and instrumentation rather than only changing pitch.
3. Measure actual duration, integrated loudness, true peak, unintended silence and discontinuities at transitions. Reject corrupt/empty outputs. Listen before publishing; automated measurements are not a musical quality score.
4. Keep masters plus delivery encodes with hashes, provenance, generator/model version, source/sample rights and explicit approval. Audio from a third-party live station is never training material or catalog content by default.
5. Publish only approved tracks into a versioned station manifest. Use a planned future epoch for program changes, so all clients agree when a new schedule starts. Preload the next track instead of decoding an entire multi-hour catalog at startup; the player now retains only the current and upcoming decoded tracks.
6. Add scheduled shows after catalog variety is sufficient: morning focus, afternoon synths, late-night ambient. Keep a last-known-good schedule and a fixed offline catalog if generation or scheduling fails.

The first useful batch is a few hours across the four station identities, reviewed in small groups. Do not promise unlimited unique music or launch continuous paid generation without measuring quality, cost and rights first.

## Visual variation workflow

Keep audio analysis, rendering and preset data separate. A preset can specify a renderer, palette, geometry seed, sensitivity, decay and motion limits. Save the entire configuration, not just a display name. Seeded variation makes it possible to bookmark and reproduce a look. Avoid unconstrained random flashes or abrupt energy changes; retain reduced-motion and an explicit Off mode.

For large preset libraries, use a lazy-loaded renderer and license-reviewed preset packs. Blend between presets, cap frame rate and resolution, stop drawing when hidden, and handle WebGL/context loss with a simple fallback. The current dependency-free canvas modes are the first step, not a full MilkDrop implementation.

## People and projects to learn from

- [Butterchurn](https://github.com/jberg/butterchurn): WebGL implementation of MilkDrop, connects to Web Audio nodes and blends between presets. Strong fit for a later optional MilkDrop mode; audit engine and preset licenses separately.
- [Hydra](https://hydra.ojack.xyz/): Olivia Jack's live-coded visual synth; useful inspiration for composable feedback and color operations. Its [source](https://github.com/hydra-synth/hydra) is also available.
- [Strudel](https://strudel.cc/): browser-based algorithmic music patterns, porting ideas from TidalCycles. Its [pattern documentation](https://strudel.cc/learn/factories/) shows compositional building blocks.
- [Sonic Pi randomisation](https://sonic-pi.net/tutorial-04.html): deterministic random seeds make musical variation repeatable. A useful model for HIFI's offline composition batches.

Research reviewed 2026-09-28. These are references, not installed dependencies or integrations. No generated third-party presets/music were imported by this release.
