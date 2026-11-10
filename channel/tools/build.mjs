#!/usr/bin/env node
// Builds the HIFI Live channel bundle, dist-channel/: the broadcast page, the tools, and the media they
// need (room photos, TV clips, the music), plus streams.json and the texts for YouTube Studio
// (publish/). Only copies files, so it is fine on the Mac mini; everything heavy runs from the bundle
// on the MacBook Pro after tools/stage-pro.sh has copied it there.
//
//   node channel/tools/build.mjs [--strict]     --strict fails when a stream's music isn't made yet
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = fileURLToPath(new URL('../../', import.meta.url)), src = join(repo, 'channel'), out = join(repo, 'dist-channel');
const strict = process.argv.includes('--strict');
const read = (p) => JSON.parse(readFileSync(join(repo, p), 'utf8'));
const plan = read('channel/channel.json'), catalog = read('stations.json');
const roomSpec = read('mockups/youtube-live/rooms.json'), calibration = read('mockups/youtube-live/rooms/calibration.json');
rmSync(out, { recursive: true, force: true });
for (const d of ['stream', 'tools', 'vendor', 'art']) cpSync(join(src, d), join(out, d), { recursive: true });
cpSync(join(src, 'channel.json'), join(out, 'channel.json'));
const copy = (rel) => { mkdirSync(dirname(join(out, rel)), { recursive: true }); cpSync(join(repo, rel), join(out, rel)); };

const streams = [], skipped = [];
for (const s of plan.streams) {
  const station = catalog.stations.find((x) => x.id === s.id);
  if (!station) throw Error(`channel.json names ${s.id}, which is not in stations.json`);
  if (station.tv?.length !== 4) throw Error(`${s.id} needs its four HIFI TV clips`);
  let tracks;
  if (s.catalog) {
    const music = existsSync(join(repo, s.catalog)) ? read(s.catalog).streams?.[s.id]?.tracks : null;
    if (!music?.length || music.some((t) => !existsSync(join(repo, t.src)))) {
      const why = `${s.id}: its music (${s.catalog}) is not made yet`;
      if (strict) throw Error(why);
      skipped.push(why); continue;
    }
    tracks = music.map((t) => ({ file: t.src, title: t.title, artist: t.artist, ...(t.year ? { year: t.year } : {}), duration: t.duration }));
  } else {
    if (station.band !== 'synth') throw Error(`${s.id} relays another station: give it a catalog of our own music`);
    tracks = station.tracks.map((t) => ({ file: t.src, title: t.title, artist: t.artist, duration: t.duration }));
  }
  const cal = calibration[s.id], spec = roomSpec.rooms.find((r) => r.id === s.id);
  if (!cal || !spec) throw Error(`${s.id} has no room photo (mockups/youtube-live/rooms/)`);
  const { stamp, lava, weather, panes } = spec;
  for (const t of tracks) copy(t.file);
  for (const c of station.tv) copy(c);
  copy(`mockups/youtube-live/rooms/${s.id}.jpg`);
  streams.push({
    id: s.id, name: station.name, frequency: station.frequency, color: station.color,
    genre: s.genre || station.genre, tagline: s.tagline || station.tagline, title: s.title, christmas: !!s.christmas,
    tv: station.tv.map((c) => `/${c}`), thumbClip: s.thumbClip,
    room: { photo: `/mockups/youtube-live/rooms/${s.id}.jpg`, ...cal, stamp, ...(lava ? { lava } : {}), ...(weather ? { weather } : {}), ...(panes ? { panes } : {}) },
    tracks,
  });

  // What to paste into YouTube Studio for this stream.
  const list = tracks.map((t, i) => `${String(i + 1).padStart(2, '0')}. ${t.title} · ${t.artist}${t.year ? ` (${t.year})` : ''}`).join('\n');
  const rights = s.rights || 'All music is original, composed in the HIFI studio. No samples, no licensed music.';
  const text = `TITLE\n${s.title}\n\nDESCRIPTION\n${s.about}\n\n${station.name} plays around the clock on a mid-90s camcorder tape: the station's HIFI TV clips on the CRT, a new clip with every song, the record turning on the deck.\n\nOn the record\n${list}\n\n${rights}\n\nListen in the HIFI app (iPhone, Mac, web): https://hifi.nates-software.com/\n\nTAGS\n${[...s.tags, 'HIFI', '24/7', 'vhs', '90s'].join(', ')}\n\nTHUMBNAIL\nart/thumb-${s.id}.png\n\nSETTINGS\nCategory: ${plan.channel.category} · Made for kids: no · Altered or synthetic content: yes · Latency: normal · DVR: on${s.season ? ` · Season: ${s.season.note}` : ''}\n`;
  mkdirSync(join(out, 'publish'), { recursive: true });
  writeFileSync(join(out, 'publish', `${s.id}.txt`), text);
}
const c = plan.channel;
writeFileSync(join(out, 'publish', 'channel.txt'), `NAME\n${c.name}\n\nHANDLE (first free)\n${c.handles.join('  ')}\n\nDESCRIPTION\n${c.description}\n\nKEYWORDS\n${c.keywords.join(', ')}\n\nLINKS\n${c.links.map((l) => `${l.title}: ${l.url}`).join('\n')}\n\nIMAGES\nProfile picture: ${c.art.avatar}\nBanner: ${c.art.banner}\nWatermark: ${c.art.watermark}\n\nDEFAULTS\nCountry: ${c.country} · Language: ${c.defaultLanguage} · Category: ${c.category} · Made for kids: no\n${c.syntheticContent}\n`);
writeFileSync(join(out, 'streams.json'), JSON.stringify({ streams }, null, 1));
console.log(`Built dist-channel/ with ${streams.length} streams: ${streams.map((s) => s.id).join(', ')}`);
for (const w of skipped) console.log(`  skipped ${w}`);
