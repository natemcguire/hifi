#!/usr/bin/env node
// Renders the channel art into <out>/art/: thumb-<id>.png (1280x720) for each stream that has a program,
// banner.png (2560x1440, everything that matters inside the 1546x423 safe area), avatar.png (800x800)
// and watermark.png (150x150, transparent). Each thumbnail is a real frame of that stream's tape, taken
// in the wide shot a few seconds into the track whose clip channel.json picks (thumbClip). Runs on the Pro.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { chrome, log, outDir, root, serve } from './lib.mjs';
import { shotList, shotAt } from '../stream/tape.js';

const out = outDir(), sides = join(out, 'sides'), stills = join(out, 'stills'), dir = join(out, 'art');
mkdirSync(stills, { recursive: true }); mkdirSync(dir, { recursive: true });
const { streams } = JSON.parse(readFileSync(join(root, 'streams.json'), 'utf8'));
const ready = streams.filter((s) => existsSync(join(sides, s.id, 'program.json')));
const { server, url } = await serve([['/sides/', sides], ['/stills/', stills], ['/', root]]);
const page = await chrome({ width: 1920, height: 1080 });

for (const s of ready) {
  const program = JSON.parse(readFileSync(join(sides, s.id, 'program.json'), 'utf8')), shots = shotList(program);
  const i = Math.min(program.tracks.length - 1, (s.thumbClip || 1) - 1);
  let t = program.tracks[i].start + 4;
  while (shotAt(shots, t).kind !== 'wide') t += 1;
  await page.goto(`${url}/stream/stream.html?s=${s.id}&render=1`);
  await page.eval(`HIFI.ready.then(()=>document.querySelectorAll('.bug,.station,.lower').forEach(e=>e.style.display='none'))`);
  await page.eval(`HIFI.frame(${t}).then(()=>new Promise(r=>requestAnimationFrame(()=>r())))`);
  writeFileSync(join(stills, `${s.id}-clean-thumb.jpg`), await page.shot({ quality: 94, clip: { x: 240, y: 0, width: 1440, height: 1080 } }));
  log(`${s.id}: still at ${t.toFixed(1)}s`);
}
const shoot = async (query, w, h, file, transparent = false) => {
  await page.size(w, h);
  await page.send('Emulation.setDefaultBackgroundColorOverride', transparent ? { color: { r: 0, g: 0, b: 0, a: 0 } } : {});
  await page.goto(`${url}/art/art.html?${query}`);
  await page.eval(`new Promise(r=>{const f=()=>document.title==='ready'?r():setTimeout(f,50);f()})`);
  writeFileSync(join(dir, file), await page.shot({ format: 'png', clip: { x: 0, y: 0, width: w, height: h } }));
  log(`wrote ${join(dir, file)}`);
};
for (const s of ready) await shoot(`kind=thumb&s=${s.id}`, 1280, 720, `thumb-${s.id}.png`);
await shoot('kind=banner', 2560, 1440, 'banner.png');
await shoot('kind=avatar', 800, 800, 'avatar.png');
await shoot('kind=watermark', 150, 150, 'watermark.png', true);
await page.close(); server.close();
if (ready.length < streams.length) log(`no program yet for: ${streams.filter((s) => !ready.includes(s)).map((s) => s.id).join(', ')} (run tools/sides.mjs)`);
