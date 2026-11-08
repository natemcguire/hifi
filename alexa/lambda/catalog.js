'use strict';
// The HIFI catalog: the live stations.json first, the copy bundled at deploy time if the
// site can't be reached. Only stations Alexa can play are kept: live streams and the
// track-based synth stations. The video stations (HIFI TV only) are left out.

const fs = require('fs');
const path = require('path');

const SITE = 'https://hifi.nates-software.com';
const TTL = 5 * 60 * 1000;
let cached = null, cachedAt = 0;

const playable = s => Boolean(s.stream) || (Array.isArray(s.tracks) && s.tracks.length > 0);

function shape(raw) {
  return raw.stations.filter(playable).map(s => ({
    id: s.id, name: s.name, band: s.band, genre: s.genre || '', subtitle: s.subtitle || '', tagline: s.tagline || '',
    tags: s.tags || [], color: s.color || '#ffffff', stream: s.stream || null, nowPlaying: s.nowPlaying ? SITE + s.nowPlaying : null,
    tracks: (s.tracks || []).map(t => ({ src: `${SITE}/${t.src}`, title: t.title, artist: t.artist, duration: t.duration })),
    cover: `${SITE}/alexa/covers/${s.id}.png`,
  }));
}

async function fetchLive() {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(`${SITE}/stations.json`, { signal: ctl.signal, headers: { 'User-Agent': 'HIFI-Alexa/1.0' } });
    if (!res.ok) throw new Error(`stations.json ${res.status}`);
    return shape(await res.json());
  } finally { clearTimeout(timer); }
}

function bundled() {
  return shape(JSON.parse(fs.readFileSync(path.join(__dirname, 'stations.json'), 'utf8')));
}

async function stations() {
  if (cached && Date.now() - cachedAt < TTL) return cached;
  try { cached = await fetchLive(); cachedAt = Date.now(); }
  catch (err) { console.log('catalog: live fetch failed, using bundled copy:', err.message); if (!cached) cached = bundled(); cachedAt = Date.now() - TTL + 30000; }
  return cached;
}

// What's on right now, for stations that publish it. null when unknown.
async function nowPlaying(station) {
  if (!station.nowPlaying) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 2500);
  try {
    const res = await fetch(station.nowPlaying, { signal: ctl.signal, headers: { 'User-Agent': 'HIFI-Alexa/1.0' } });
    if (!res.ok) return null;
    const now = await res.json();
    return now.title ? { title: now.title, artist: now.artist || '' } : null;
  } catch { return null; }
  finally { clearTimeout(timer); }
}

module.exports = { stations, nowPlaying, SITE };
