#!/usr/bin/env node
// Sends a stream's tape to YouTube Live, looping it for as long as it runs: ffmpeg reads the rendered
// file (tools/render.mjs) in real time and copies it to RTMPS, no re-encode, so a laptop can carry all
// six streams. If ffmpeg stops it is started again after a pause that grows; after too many failures
// in a row it gives up (it does not hammer YouTube). Runs on the MacBook Pro.
//
//   node tools/push.mjs <stream-id>                           go live (stream key: see below)
//   node tools/push.mjs <stream-id> --dry-run out.flv --seconds 90    the same pipe into a local file
//   [--tape FILE] [--force]   another tape file; --force streams Christmas out of season
//
// The stream key comes from the environment or the Keychain and is never printed: ffmpeg's output is
// filtered and the URL is never logged.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flags, inSeason, log, outDir, redactor, root } from './lib.mjs';

const o = flags(process.argv.slice(2)), id = o._[0];
if (!id) { console.error('usage: node tools/push.mjs <stream-id> [--dry-run FILE --seconds N] [--tape FILE] [--force]'); process.exit(2); }
const plan = JSON.parse(readFileSync(join(root, 'channel.json'), 'utf8'));
const stream = plan.streams.find((s) => s.id === id);
if (!stream) throw Error(`no stream ${id} in channel.json`);
const tape = o.tape || join(outDir(), 'tapes', `${id}.mp4`);
if (!existsSync(tape)) throw Error(`no tape at ${tape}: run tools/render.mjs ${id} first`);

if (!inSeason(stream.season) && !o.force && !o['dry-run']) { log(`${id}: out of season (${stream.season.note}); not streaming. --force to override.`); process.exit(0); }

const dry = o['dry-run'];
const keyName = `YOUTUBE_STREAM_KEY_${id.toUpperCase().replace(/-/g, '_')}`;
// The key: $YOUTUBE_STREAM_KEY_<ID> (withkeys), else this Mac's Keychain item service "hifi-live", account <id>
// (the MacBook Pro has no keys tool: add it once with  security add-generic-password -s hifi-live -a <id> -w).
function keychain() {
  const r = spawnSync('security', ['find-generic-password', '-s', 'hifi-live', '-a', id, '-w'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : '';
}
const key = dry ? '' : process.env[keyName] || keychain();
if (!dry && !key) { console.error(`No stream key: set ${keyName} (withkeys) or add the Keychain item hifi-live/${id} on this Mac.`); process.exit(2); }
const target = dry ? ['-f', 'flv', '-y', dry] : ['-f', 'flv', `${plan.encoding.ingest}/${key}`];
const redact = redactor(key);

const args = ['-hide_banner', '-loglevel', 'warning', '-nostdin', '-re', '-stream_loop', '-1', '-fflags', '+genpts', '-i', tape,
  ...(o.seconds ? ['-t', String(o.seconds)] : []), '-map', '0:v', '-map', '0:a', '-c', 'copy', '-flvflags', 'no_duration_filesize', ...target];

let failures = 0, stopping = false, child = null;
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stopping = true; child?.kill('SIGINT'); });
while (!stopping) {
  const started = Date.now();
  log(`${id}: ${dry ? `writing ${dry}` : 'live to YouTube'} from ${tape}`);
  child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (d) => process.stderr.write(redact(String(d))));
  const code = await new Promise((r) => child.on('close', r));
  if (stopping || dry) { log(`${id}: ffmpeg exited (${code})`); process.exit(code ?? 0); }
  failures = Date.now() - started > 10 * 60e3 ? 1 : failures + 1;   // a long run resets the count
  if (failures > 12) { log(`${id}: ffmpeg failed ${failures - 1} times in a row; giving up (exit 0, so launchd leaves it stopped)`); process.exit(0); }
  const wait = Math.min(300, 5 * 2 ** (failures - 1));
  log(`${id}: ffmpeg exited (${code}); again in ${wait}s`);
  await new Promise((r) => setTimeout(r, wait * 1000));
}
