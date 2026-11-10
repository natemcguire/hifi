#!/usr/bin/env node
// Records a stream's tape: headless Chrome draws stream/stream.html one frame at a time on the program
// clock (1/30 s steps, so it never drops a frame however slow the machine), each frame goes to ffmpeg
// as a JPEG, and the finished picture is muxed with the program audio into one loopable file that
// tools/push.mjs sends to YouTube Live.
//
//   node tools/render.mjs <stream-id> [--seconds N] [--from S] [--segment 60]
//
// Renders in segments (<out>/tapes/<id>/seg-NNNN.mp4) so a stopped run picks up where it left off,
// then writes <out>/tapes/<id>.mp4. --seconds renders just the start (a test tape: <id>-test.mp4).
// Run it on the MacBook Pro, never the Mac mini. Needs ffmpeg and Google Chrome.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { chrome, flags, log, outDir, root, serve } from './lib.mjs';

const o = flags(process.argv.slice(2)), id = o._[0];
if (!id) { console.error('usage: node tools/render.mjs <stream-id> [--seconds N] [--from S]'); process.exit(2); }
const channel = JSON.parse(readFileSync(join(root, 'channel.json'), 'utf8')).encoding;
const out = outDir(), sides = join(out, 'sides'), program = JSON.parse(readFileSync(join(sides, id, 'program.json'), 'utf8'));
const FPS = 30, SEG = +(o.segment || 60), from = +(o.from || 0);
const total = o.seconds ? Math.min(+o.seconds, program.duration - from) : program.duration - from;
const frames = Math.round(total * FPS), test = !!o.seconds;
const segDir = join(out, 'tapes', test ? `${id}-test` : id); mkdirSync(segDir, { recursive: true });
const final = join(out, 'tapes', test ? `${id}-test.mp4` : `${id}.mp4`);
const gop = channel.keyframeSeconds * FPS;
const x264 = ['-c:v', 'libx264', '-preset', o.preset || 'medium', '-profile:v', 'high', '-pix_fmt', 'yuv420p',
  '-b:v', channel.videoBitrate, '-maxrate', channel.videoBitrate, '-bufsize', `${parseInt(channel.videoBitrate) * 2}k`,
  '-g', String(gop), '-keyint_min', String(gop), '-sc_threshold', '0', '-x264-params', 'nal-hrd=cbr:force-cfr=1', '-threads', String(o.threads || 4)];

const { server, url } = await serve([['/sides/', sides], ['/', root]]);
const page = await chrome({ width: channel.width, height: channel.height });
await page.goto(`${url}/stream/stream.html?s=${id}&render=1`);
const info = await page.eval('HIFI.ready');
const gpu = await page.eval(`(()=>{const g=document.createElement('canvas').getContext('webgl');const e=g.getExtension('WEBGL_debug_renderer_info');return e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):'unknown'})()`);
log(`${id}: program ${(info.duration / 60).toFixed(1)} min; rendering ${(total / 60).toFixed(1)} min from ${from}s = ${frames} frames on ${gpu}`);

// --stills 4,16,22: just those frames as JPEGs in <out>/stills/ (for checking the look and for thumbnails).
if (o.stills) {
  const dir = join(out, 'stills'); mkdirSync(dir, { recursive: true });
  if (o.clean) await page.eval(`document.querySelectorAll('.bug,.station,.lower').forEach(e=>e.style.display='none')`);
  for (const t of String(o.stills).split(',').map(Number)) {
    await page.eval(`HIFI.frame(${t}).then(()=>new Promise(r=>requestAnimationFrame(()=>r())))`);
    const f = join(dir, `${id}${o.clean ? '-clean' : ''}-${t}.jpg`); writeFileSync(f, await page.shot({ quality: 92 })); log(`wrote ${f}`);
  }
  await page.close(); server.close(); process.exit(0);
}
const segFrames = SEG * FPS, nSeg = Math.ceil(frames / segFrames), t0 = Date.now();
let done = 0;
for (let s = 0; s < nSeg; s++) {
  const file = join(segDir, `seg-${String(s).padStart(4, '0')}.mp4`);
  const n = Math.min(segFrames, frames - s * segFrames);
  if (existsSync(file)) { done += n; continue; }
  const tmp = file.replace('.mp4', '.tmp.mp4');
  const ff = spawn('nice', ['-n', '10', 'ffmpeg', '-v', 'error', '-y', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', 'pipe:0', ...x264, '-an', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (b) => new Promise((res) => (ff.stdin.write(b) ? res() : ff.stdin.once('drain', res)));
  for (let f = 0; f < n; f++) {
    const t = from + (s * segFrames + f) / FPS;
    await page.eval(`HIFI.frame(${t}).then(()=>new Promise(r=>requestAnimationFrame(()=>r())))`);
    await write(await page.shot({ quality: 93 }));
  }
  ff.stdin.end();
  if (await new Promise((r) => ff.on('close', r)) !== 0) throw Error(`ffmpeg failed on segment ${s}`);
  renameSync(tmp, file);
  done += n;
  const fps = done / ((Date.now() - t0) / 1000);
  log(`${id}: ${done}/${frames} frames, ${fps.toFixed(1)} fps, ${Math.round((frames - done) / fps / 60)} min left`);
}
await page.close(); server.close();

// One file: the segments end to end (no re-encode), the program audio from the same start.
const list = join(segDir, 'list.txt');
writeFileSync(list, Array.from({ length: nSeg }, (_, s) => `file 'seg-${String(s).padStart(4, '0')}.mp4'`).join('\n') + '\n');
const mux = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', list, '-ss', String(from), '-t', String(total), '-i', join(sides, id, program.audio),
  '-map', '0:v', '-map', '1:a', '-c', 'copy', '-movflags', '+faststart', final + '.tmp.mp4'], { stdio: 'inherit' });
if (await new Promise((r) => mux.on('close', r)) !== 0) throw Error('mux failed');
renameSync(final + '.tmp.mp4', final);
rmSync(list);
log(`${id}: wrote ${final}`);
