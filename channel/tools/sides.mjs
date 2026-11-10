#!/usr/bin/env node
// Cuts each stream's music onto records and makes its program: the audio of one full loop of the
// stream and the groove geometry the deck close-up draws. Runs in the bundle (dist-channel/) on the
// MacBook Pro; needs ffmpeg. Usage: node tools/sides.mjs [stream-id ...] [--out DIR]
//
// A stream's catalog is split into sides of at most SIDE_MAX seconds. Each side is cut with the lathe
// from rauchg/vinyl (vendor/vinyl/cut.js) and pressed (press.js) for the dust and scratches you see;
// between sides the record is turned over (FLIP seconds of quiet). The program plays the sides in order
// and loops. Every track is loudness-normalised to -14 LUFS first (two-pass loudnorm).
//
// Writes <out>/sides/<id>/program.json, record-<side>.vis and program.m4a (AAC 48 kHz stereo).
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cut } from '../vendor/vinyl/cut.js';
import { press, makeVis, DEFAULT_CONDITION } from '../vendor/vinyl/press.js';
import { W33 } from '../vendor/vinyl/geometry.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), outArg = args.indexOf('--out');
const out = outArg >= 0 ? args.splice(outArg, 2)[1] : (process.env.HIFI_CHANNEL_OUT || join(root, 'out'));
const CUT_FS = 22050, FS = 48000, SIDE_MAX = 16 * 60, FLIP = 8, TAIL = 4;
const LOUD = 'I=-14:TP=-1.5:LRA=11';
const { streams } = JSON.parse(readFileSync(join(root, 'streams.json'), 'utf8'));
const pick = args.length ? streams.filter((s) => args.includes(s.id)) : streams;
if (args.length && pick.length !== args.length) throw Error(`unknown stream in ${args.join(' ')}`);
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

function measure(file) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', file, '-af', `loudnorm=${LOUD}:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const m = r.stderr.match(/\{[^{}]*"input_i"[^{}]*\}/s);
  if (r.status !== 0 || !m) throw Error(`loudnorm could not measure ${file}`);
  const j = JSON.parse(m[0]);
  return `loudnorm=${LOUD}:measured_I=${j.input_i}:measured_TP=${j.input_tp}:measured_LRA=${j.input_lra}:measured_thresh=${j.input_thresh}:offset=${j.target_offset}:linear=true`;
}
function decode(file, af, fs) {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-af', af, '-ar', String(fs), '-ac', '2', '-f', 'f32le', 'pipe:1'], { maxBuffer: Infinity });
  if (r.status !== 0) throw Error(`ffmpeg could not decode ${file}: ${r.stderr}`);
  return new Float32Array(r.stdout.buffer, r.stdout.byteOffset, r.stdout.byteLength >> 2);
}
const split = (f) => {
  const n = f.length >> 1, L = new Float32Array(n), R = new Float32Array(n);
  for (let i = 0; i < n; i++) { L[i] = f[2 * i]; R[i] = f[2 * i + 1]; }
  return { L, R };
};

for (const stream of pick) {
  const t0 = Date.now(), dir = join(out, 'sides', stream.id);
  mkdirSync(dir, { recursive: true });
  log(`${stream.id}: ${stream.tracks.length} tracks`);
  const filters = stream.tracks.map((t) => measure(join(root, t.file)));
  // Sides: fill each up to SIDE_MAX in catalog order.
  const groups = [[]];
  let acc = 0;
  stream.tracks.forEach((t, i) => {
    if (acc + t.duration > SIDE_MAX && groups.at(-1).length) { groups.push([]); acc = 0; }
    groups.at(-1).push(i); acc += t.duration + 3.6;
  });
  const records = [], tracks = [];
  let start = 0;
  groups.forEach((g, k) => {
    const letter = 'ABCDEFGH'[k];
    const audio = g.map((i) => ({ ...split(decode(join(root, stream.tracks[i].file), filters[i], CUT_FS)), title: stream.tracks[i].title }));
    // Loud modern masters need a wide groove; the cut only draws the disc, so cut it quieter until it fits.
    let rec, cutPeak = 0.07;
    for (let tries = 0; tries < 4; tries++, cutPeak /= 2) { rec = cut(audio, CUT_FS, { cutPeak }); if (!rec.truncated) break; }
    if (rec.truncated) throw Error(`${stream.id} side ${letter} does not fit on one side`);
    press(rec, DEFAULT_CONDITION, 7 + k);
    const vis = makeVis(rec);
    writeFileSync(join(dir, `record-${letter.toLowerCase()}.vis`), Buffer.from(vis.data.buffer, vis.data.byteOffset, vis.data.byteLength));
    rec.tracks.forEach((m, j) => {
      const src = stream.tracks[g[j]];
      tracks.push({ title: src.title, artist: src.artist, ...(src.year ? { year: src.year } : {}), start: start + m.theta0 / W33, end: start + m.theta1 / W33, record: k, src: g[j] });
    });
    const playEnd = rec.tracks.at(-1).theta1 / W33 + TAIL;
    records.push({
      side: letter, start, end: start + playEnd,
      vis: { file: `record-${letter.toLowerCase()}.vis`, cols: vis.cols, rows: vis.rows },
      rec: {
        rTab: Buffer.from(new Float64Array(rec.rTab).buffer).toString('base64'), thetaEnd: rec.thetaEnd,
        ecc: rec.ecc, warp: rec.warp, scratches: rec.scratches, condition: rec.condition,
        tracks: rec.tracks.map(({ title }) => ({ title })),
      },
    });
    log(`${stream.id}: side ${letter}: ${g.length} tracks, cut at ${cutPeak.toFixed(3)} m/s, ${(playEnd / 60).toFixed(1)} min, ${(rec.thetaEnd / (2 * Math.PI)).toFixed(0)} revolutions`);
    start += playEnd + (k < groups.length - 1 ? FLIP : 0);
  });
  const duration = Math.round(start * 30) / 30;                         // a whole number of frames

  // The program audio: the tracks at the times the cut put them, silence between, 48 kHz.
  const tmp = join(dir, 'program.tmp.m4a');
  const enc = spawn('ffmpeg', ['-v', 'error', '-y', '-f', 'f32le', '-ar', String(FS), '-ac', '2', '-i', 'pipe:0',
    '-c:a', 'aac', '-b:a', stream.audioBitrate || '160k', '-movflags', '+faststart', tmp], { stdio: ['pipe', 'inherit', 'inherit'] });
  const write = (buf) => new Promise((res) => (enc.stdin.write(buf) ? res() : enc.stdin.once('drain', res)));
  let at = 0;                                                            // samples written
  const silence = async (n) => { while (n > 0) { const k = Math.min(n, FS); await write(Buffer.alloc(k * 8)); n -= k; at += k; } };
  for (const [j, tr] of tracks.entries()) {
    await silence(Math.round(tr.start * FS) - at);
    const pcm = decode(join(root, stream.tracks[tr.src].file), filters[tr.src], FS);
    const want = Math.round((tr.end - tr.start) * FS), n = Math.min(want, pcm.length >> 1);
    await write(Buffer.from(pcm.buffer, pcm.byteOffset, n * 8)); at += n;
    if (j % 4 === 3) log(`${stream.id}: audio ${j + 1}/${tracks.length}`);
  }
  await silence(Math.round(duration * FS) - at);
  enc.stdin.end();
  const code = await new Promise((res) => enc.on('close', res));
  if (code !== 0) throw Error(`${stream.id}: ffmpeg could not encode the program audio`);
  renameSync(tmp, join(dir, 'program.m4a'));
  writeFileSync(join(dir, 'program.json'), JSON.stringify({ id: stream.id, duration, fps: 30, audio: 'program.m4a', tracks: tracks.map(({ src, ...t }) => t), records }));
  log(`${stream.id}: program ${(duration / 60).toFixed(1)} min in ${((Date.now() - t0) / 1000).toFixed(0)} s -> ${dir}`);
}
