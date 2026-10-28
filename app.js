import { rotationAt } from './engine/scheduler.js';
import { createStorage } from './engine/storage.js';
import { installWindowShortcuts } from './engine/windowShortcuts.js';

// HIFI as a classic click-wheel iPod: the same player as the iPhone and Mac apps
// (ios/Sources/IPod.swift). The device fills the window: screen over wheel when
// tall, side by side when wide.
const $ = id => document.getElementById(id);
const root = document.documentElement;
const embedded = window.parent !== window;
const params = new URLSearchParams(location.search);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const GRIP = 54;  // room above the device for the desktop host's window buttons

const svg = (body, box = 24) => `<svg viewBox="0 0 ${box} ${box}" aria-hidden="true">${body}</svg>`;
const HEART = 'M12 21s-7.6-4.7-9.4-9.4C1.3 8.1 3.6 4.5 7.2 4.5c2.1 0 3.6 1.1 4.8 2.9 1.2-1.8 2.7-2.9 4.8-2.9 3.6 0 5.9 3.6 4.6 7.1C19.6 16.3 12 21 12 21z';
const SPEAKER = '<path d="M3 9h4l5-4.5v15L7 15H3z"/>';
const ICON = {
  play: svg('<path d="M6 3.5v17L20.5 12z"/>'),
  pause: svg('<path d="M5.5 4h4.5v16H5.5zM14 4h4.5v16H14z"/>'),
  chevron: svg('<path d="M8.5 4.5 16 12l-7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  speaker: svg(`${SPEAKER}<path class="w1" d="M15.5 8.8a4.6 4.6 0 0 1 0 6.4"/><path class="w2" d="M18.6 5.8a8.8 8.8 0 0 1 0 12.4"/>`),
  speakerLow: svg(SPEAKER),
  speakerHigh: svg(`${SPEAKER}<path class="w1" d="M15.2 9.2a4 4 0 0 1 0 5.6"/><path class="w1" d="M17.8 6.8a7.6 7.6 0 0 1 0 10.4"/><path class="w1" d="M20.4 4.4a11 11 0 0 1 0 15.2"/>`),
  heart: svg(`<path d="${HEART}" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>`),
  heartFill: svg(`<path d="${HEART}"/>`),
  playPause: svg('<path d="M1.5 5v14L11 12z"/><path d="M13.5 5h3.2v14h-3.2zM19.3 5h3.2v14h-3.2z"/>'),
  previous: svg('<path d="M2.5 5H5v14H2.5z"/><path d="M13.2 5v14L5.4 12z"/><path d="M21.5 5v14l-7.8-7z"/>'),
  next: svg('<path d="M19 5h2.5v14H19z"/><path d="M10.8 5v14l7.8-7z"/><path d="M2.5 5v14l7.8-7z"/>'),
  curate: svg('<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5v9M7.5 12h9" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  curated: svg('<circle cx="12" cy="12" r="10"/><path d="m7.5 12.3 3 3 6-6.3" fill="none" stroke="#fff" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/>'),
};
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
// "INDIE POP ROCKS!" → "Indie Pop Rocks!", like Swift's .capitalized.
const capitalized = text => text.toLowerCase().replace(/(^|[^\p{L}\p{N}'’])(\p{L})/gu, (_, gap, letter) => gap + letter.toUpperCase());
// A station can spell its own name ("101X Chillville"); the rest are title-cased.
const stationName = station => station.label || capitalized(station.name);
const clock = seconds => { const s = Math.max(0, Math.round(seconds)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };

const prefs = createStorage('hifi.ipod', {
  defaults: () => ({ station: 'radio-paradise', volume: 1, clicker: true, backlight: 30 }),
  validate: p => p && typeof p.station === 'string' && Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1
    && typeof p.clicker === 'boolean' && [10, 30, 60, 0].includes(p.backlight),
});
const settings = prefs.get();
const savePrefs = () => prefs.set({ station: radio.station.id, volume: radio.volume, clicker: settings.clicker, backlight: settings.backlight });

// MARK: Catalog

async function loadCatalog() {
  for (let attempt = 0; ; attempt++) {
    try {
      const response = await fetch('stations.json', { cache: 'no-cache', signal: AbortSignal.timeout(8000) });
      const catalog = await response.json();
      if (Array.isArray(catalog?.stations) && catalog.stations.length) return catalog;
    } catch { /* offline or a bad deploy: keep trying */ }
    $('pages').innerHTML = '<div class="page message"><p>Can’t reach HIFI.<br>Retrying…</p></div>';
    await new Promise(resolve => setTimeout(resolve, Math.min(15000, 2000 * (attempt + 1))));
  }
}
const catalog = await loadCatalog();
const isLive = station => Boolean(station.stream);
// Video stations play official YouTube uploads on the screen. They live in
// catalog.videoStations, which the native apps don't read, and load their
// song list after the player is up.
const isVideo = station => station.video === 'youtube';
async function loadVideoStations() {
  for (const station of catalog.videoStations || []) {
    try {
      const response = await fetch(station.playlist, { signal: AbortSignal.timeout(15000) });
      const tracks = (await response.json()).filter(track => track.youtube && track.duration > 0);
      if (!tracks.length || catalog.stations.some(s => s.id === station.id)) continue;
      catalog.stations.push({ ...station, tracks });
      if (wanted === station.id && !radio.playing) radio.station = catalog.stations.at(-1);
      changed();
    } catch { /* the station just stays off the list */ }
  }
}
const stationsIn = band => catalog.stations.filter(s => s.band === band);

// MARK: Radio (ios/Sources/Radio.swift)

// One audio element for every station. Live stations play their stream; synth
// stations play tracks from the wall-clock rotation, so everyone hears the same moment.
const audio = new Audio();
audio.preload = 'none';
const preload = new Audio();
preload.preload = 'auto';
const wanted = params.get('station') || settings.station;
const radio = {
  station: catalog.stations.find(s => s.id === wanted) || catalog.stations[0],
  playing: false, buffering: false, track: null, liveSong: null, problem: null, volume: settings.volume,
  songs: {},  // what every live station is playing, for the Radio menu
};
let retryTimer = 0, stallTimer = 0, noticeTimer = 0, pollTimer = 0, pollFor = null, pendingSeek = 0, startedAt = 0;

const elapsed = () => isLive(radio.station) || !radio.track ? 0 : Math.max(0, pendingSeek || audio.currentTime || 0);

function tune(next) {
  radio.station = next;
  radio.liveSong = null;
  savePrefs();
  start();
}
const toggle = () => radio.playing ? stop() : start();

function notice(text) {
  radio.problem = text;
  clearTimeout(noticeTimer);
  noticeTimer = setTimeout(() => { if (radio.problem === text) { radio.problem = null; changed(); } }, 2500);
  changed();
}

// Next/previous change station, through every station in catalog order and
// round again, like the dial on a radio.
function skip(delta) {
  const stations = catalog.stations, index = Math.max(0, stations.indexOf(radio.station));
  tune(stations[(index + delta + stations.length) % stations.length]);
}

// Radio semantics: play always rejoins the broadcast now; there is no pause point.
function start() {
  const tracks = radio.station.tracks;
  if (!isLive(radio.station) && tracks?.length) {
    const now = rotationAt(tracks, catalog.epoch);
    play(now.index, Math.min(now.offset, Math.max(0, now.track.duration - 0.25)));
  } else play(0, 0);
}

function play(index, offset) {
  clearTimeout(retryTimer); clearTimeout(stallTimer);
  radio.problem = null;
  const station = radio.station;
  startedAt = Date.now();
  if (isVideo(station)) {
    stopPolling();
    silence();
    radio.track = station.tracks[index];
    radio.playing = true;
    radio.buffering = true;
    // The video needs the screen, like an iPod playing a movie.
    if (page() !== 'nowPlaying') push('nowPlaying');
    void playVideo(radio.track, offset);
    return changed();
  }
  stopVideo();
  if (isLive(station)) {
    radio.track = null; pendingSeek = 0;
    audio.src = station.stream;
    pollLiveSong();
  } else {
    stopPolling();
    radio.track = station.tracks[index];
    pendingSeek = offset;
    audio.src = radio.track.src;
  }
  audio.volume = radio.volume;
  radio.playing = true;
  radio.buffering = true;
  audio.play().catch(error => {
    if (error?.name === 'AbortError') return;  // a newer play() replaced this one
    if (error?.name === 'NotAllowedError') { radio.playing = false; radio.buffering = false; changed(); return; }
    failed();
  });
  changed();
}

function silence() {
  audio.pause();
  audio.removeAttribute('src');
  audio.load();
}

function stop() {
  clearTimeout(retryTimer); clearTimeout(stallTimer);
  stopPolling();
  radio.playing = false;
  radio.buffering = false;
  silence();
  stopVideo();
  changed();
}

// MARK: Video stations (YouTube's privacy-enhanced player)

const video = { player: null, api: null, host: null, token: 0 };
function loadYouTube() {
  return video.api ??= new Promise((resolve, reject) => {
    window.onYouTubeIframeAPIReady = resolve;
    const script = document.createElement('script');
    script.src = 'https://www.youtube.com/iframe_api';
    script.onerror = () => { video.api = null; reject(new Error('YouTube did not load')); };
    document.head.append(script);
  });
}
async function playVideo(track, offset) {
  const token = ++video.token;
  try { await loadYouTube(); } catch { return failed(); }
  if (token !== video.token || !radio.playing) return;
  if (!video.player) {
    video.host = document.createElement('div');
    video.host.className = 'video';
    const target = document.createElement('div');
    video.host.append(target);
    $('pages').append(video.host);
    video.player = new YT.Player(target, {
      host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', videoId: track.youtube,
      playerVars: { autoplay: 1, start: Math.floor(offset), playsinline: 1, rel: 0, iv_load_policy: 3 },
      events: {
        onReady: event => { event.target.setVolume(Math.round(radio.volume * 100)); if (token === video.token && radio.playing) event.target.playVideo(); },
        onStateChange: videoState, onError: videoError,
      },
    });
  } else {
    video.player.loadVideoById?.({ videoId: track.youtube, startSeconds: Math.floor(offset) });
    video.player.setVolume?.(Math.round(radio.volume * 100));
  }
  syncVideo();
}
function videoState(event) {
  if (!isVideo(radio.station) || !radio.playing) return;
  const state = event.data;
  if (state === YT.PlayerState.PLAYING) { radio.buffering = false; radio.problem = null; }
  else if (state === YT.PlayerState.BUFFERING) radio.buffering = true;
  else if (state === YT.PlayerState.ENDED) return nextVideo();
  // Paused on the video itself: the radio stops, as with the ▶︎❚❚ button.
  else if (state === YT.PlayerState.PAUSED && Date.now() - startedAt > 1500) return stop();
  changed();
}
// A video that won't play here (removed, blocked in this country) is skipped.
function videoError() {
  if (!isVideo(radio.station) || !radio.playing) return;
  radio.problem = "That one won't play here. Next…";
  changed();
  clearTimeout(retryTimer);
  retryTimer = setTimeout(nextVideo, 1200);
}
function nextVideo() {
  if (!isVideo(radio.station) || !radio.playing) return;
  const tracks = radio.station.tracks;
  play((tracks.indexOf(radio.track) + 1) % tracks.length, 0);
}
function stopVideo() {
  video.token++;
  video.player?.stopVideo?.();
  syncVideo();
}
// The player shows only on Now Playing while a video station plays.
function syncVideo() {
  if (video.host) video.host.hidden = !(isVideo(radio.station) && radio.playing && page() === 'nowPlaying');
}

function failed() {
  if (!radio.playing) return;
  radio.problem = isLive(radio.station) ? 'Lost the signal. Retuning…' : "Track didn't load. Retuning…";
  clearTimeout(retryTimer);
  retryTimer = setTimeout(() => { if (radio.playing) start(); }, 3000);
  changed();
}

audio.addEventListener('loadedmetadata', () => {
  if (pendingSeek > 0) { const seek = pendingSeek; pendingSeek = 0; audio.currentTime = seek; }
});
audio.addEventListener('playing', () => {
  clearTimeout(stallTimer);
  radio.buffering = false;
  if (radio.problem?.endsWith('Retuning…')) radio.problem = null;
  changed();
});
audio.addEventListener('waiting', () => {
  if (!radio.playing) return;
  radio.buffering = true;
  clearTimeout(stallTimer);
  if (isLive(radio.station)) stallTimer = setTimeout(failed, 20000);
  changed();
});
audio.addEventListener('timeupdate', () => {
  // Warm the cache for the next song in the rotation shortly before it starts.
  const tracks = radio.station.tracks;
  if (!radio.track || !tracks?.length || audio.duration - audio.currentTime > 30) return;
  const next = tracks[(tracks.indexOf(radio.track) + 1) % tracks.length];
  if (!preload.src.endsWith(next.src)) preload.src = next.src;
});
audio.addEventListener('ended', () => {
  if (!radio.playing) return;
  if (isLive(radio.station)) return failed();
  const tracks = radio.station.tracks;
  play((tracks.indexOf(radio.track) + 1) % tracks.length, 0);
});
audio.addEventListener('error', () => { if (audio.getAttribute('src')) failed(); });
// Paused from outside (headphones out, a call, the system): go quiet like the app.
audio.addEventListener('pause', () => {
  if (radio.playing && !audio.ended && audio.getAttribute('src') && Date.now() - startedAt > 1500) stop();
});

// MARK: Live song titles

async function fetchSong(id) {
  try {
    const response = await fetch(`/api/now-playing?station=${encodeURIComponent(id)}`, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) return null;
    const song = await response.json();
    if (typeof song?.title !== 'string' || !song.title) return null;
    return {
      artist: typeof song.artist === 'string' ? song.artist : '', title: song.title,
      trackId: typeof song.trackId === 'string' && /^[A-Za-z0-9]{22}$/.test(song.trackId) ? song.trackId : null,
      link: [song.share, song.spotify].find(url => typeof url === 'string' && /^https:\/\/(nates-software\.com\/hifi\/song\/|open\.spotify\.com\/)/.test(url)) || '',
      remaining: Number.isFinite(song.remaining) ? song.remaining : null, poll: Number.isFinite(song.poll) ? song.poll : null,
    };
  } catch { return null; }
}
const sameSong = (a, b) => a?.title === b?.title && a?.artist === b?.artist;
function pollLiveSong() {
  stopPolling();
  const id = radio.station.id;
  pollFor = id;
  const tick = async () => {
    const song = await fetchSong(id);
    if (pollFor !== id) return;
    let wait = 20;
    if (song) {
      radio.songs[id] = song;
      if (!sameSong(song, radio.liveSong)) { radio.liveSong = song; changed(); void checkLiked(); }
      // Poll again shortly after the broadcaster says this song ends.
      wait = song.remaining !== null ? Math.min(60, Math.max(8, song.remaining + 3)) : Math.max(10, song.poll ?? 20);
    }
    pollTimer = setTimeout(tick, wait * 1000);
  };
  void tick();
}
function stopPolling() { pollFor = null; clearTimeout(pollTimer); }
async function refreshSongs() {
  await Promise.all(catalog.stations.filter(isLive).map(async station => {
    const song = await fetchSong(station.id);
    if (song) radio.songs[station.id] = song;
  }));
  changed();
}

const displayTitle = () => isLive(radio.station) ? radio.liveSong?.title || stationName(radio.station) : radio.track?.title || stationName(radio.station);
const displayArtist = () => isLive(radio.station) ? radio.liveSong?.artist || radio.station.genre : radio.track?.artist || radio.station.genre;
// Synth stations play our own music, which isn't on Spotify.
const heartable = () => isLive(radio.station) && Boolean(radio.liveSong?.title);
const spotifyTrackId = () => isLive(radio.station) ? radio.liveSong?.trackId || null : null;
const position = () => { const list = stationsIn(radio.station.band); return `${list.indexOf(radio.station) + 1} of ${list.length}`; };

function setVolume(value) {
  radio.volume = Math.round(Math.min(1, Math.max(0, value)) * 100) / 100;
  audio.volume = radio.volume;
  video.player?.setVolume?.(Math.round(radio.volume * 100));
  savePrefs();
}

// MARK: Cover art

// The HIFI bars on a dark tile in the station's color, with its name.
function coverSVG(station) {
  const fit = (text, size, ratio) => text.length * size * ratio > 28 ? ' textLength="28" lengthAdjust="spacingAndGlyphs"' : '';
  return `<svg class="cover" viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="cg-${station.id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3d474e"/><stop offset="1" stop-color="#1b2024"/></linearGradient></defs>`
    + `<rect width="32" height="32" fill="url(#cg-${station.id})"/><g fill="${escape(station.color)}"><rect x="6" y="9" width="4" height="8"/><rect x="14" y="4" width="4" height="13"/><rect x="22" y="7" width="4" height="10"/></g>`
    + `<text x="16" y="23.1" text-anchor="middle" font-size="2.8" font-weight="900" fill="${escape(station.color)}"${fit(station.name, 2.8, 0.66)}>${escape(station.name)}</text>`
    + `<text x="16" y="25.6" text-anchor="middle" font-size="1.5" font-weight="600" fill="rgba(255,255,255,.65)"${fit(station.genre, 1.5, 0.62)}>${escape(station.genre)}</text></svg>`;
}
// HIFI TV: a station with its own clips plays one, muted, where the cover would be,
// under the same name and genre. The clip changes with the song.
function tvClip(station) {
  const key = isLive(station) ? radio.liveSong?.title || '' : radio.track?.title || '';
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  return station.tv[hash % station.tv.length];
}
function tvHTML(station, clip) {
  const fit = (text, size, ratio) => text.length * size * ratio > 28 ? ' textLength="28" lengthAdjust="spacingAndGlyphs"' : '';
  return `<div class="tv"><video src="${escape(clip)}" muted loop playsinline preload="auto" aria-hidden="true"></video>`
    + `<svg class="tv-text" viewBox="0 0 32 32" aria-hidden="true"><text x="2.4" y="4.4" font-size="2.3" font-weight="900" font-style="italic" fill="#fff" stroke="rgba(0,0,0,.55)" stroke-width=".35" paint-order="stroke">HIFI TV</text>`
    + `<text x="16" y="27" text-anchor="middle" font-size="2.8" font-weight="900" fill="${escape(station.color)}"${fit(station.name, 2.8, 0.66)}>${escape(station.name)}</text>`
    + `<text x="16" y="29.6" text-anchor="middle" font-size="1.5" font-weight="600" fill="rgba(255,255,255,.8)"${fit(station.genre, 1.5, 0.62)}>${escape(station.genre)}</text></svg></div>`;
}
const coverPNGs = new Map();
function coverPNG(station) {
  if (coverPNGs.has(station.id)) return coverPNGs.get(station.id);
  const canvas = document.createElement('canvas'), u = 16;
  canvas.width = canvas.height = 32 * u;
  const pen = canvas.getContext('2d');
  const ground = pen.createLinearGradient(0, 0, 0, 32 * u);
  ground.addColorStop(0, '#3d474e'); ground.addColorStop(1, '#1b2024');
  pen.fillStyle = ground; pen.fillRect(0, 0, 32 * u, 32 * u);
  pen.fillStyle = station.color;
  for (const [x, top] of [[6, 9], [14, 4], [22, 7]]) pen.fillRect(x * u, top * u, 4 * u, (17 - top) * u);
  pen.textAlign = 'center';
  pen.font = `900 ${2.8 * u}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  pen.fillText(station.name, 16 * u, 23.1 * u, 28 * u);
  pen.fillStyle = 'rgba(255,255,255,.65)';
  pen.font = `600 ${1.5 * u}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  pen.fillText(station.genre, 16 * u, 25.6 * u, 28 * u);
  const url = canvas.toDataURL('image/png');
  coverPNGs.set(station.id, url);
  return url;
}

// MARK: Lock screen and media keys

let lastMeta = '';
function updateMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const key = [radio.station.id, displayTitle(), displayArtist()].join('\n');
  if (key !== lastMeta) {
    lastMeta = key;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: displayTitle(), artist: displayArtist(), album: `${radio.station.name} · HIFI`,
        artwork: [{ src: coverPNG(radio.station), sizes: '512x512', type: 'image/png' }] });
    } catch { /* metadata is a nicety */ }
  }
  navigator.mediaSession.playbackState = radio.playing ? 'playing' : 'paused';
}
if ('mediaSession' in navigator) {
  const handle = (action, fn) => { try { navigator.mediaSession.setActionHandler(action, fn); } catch { /* unsupported action */ } };
  handle('play', start); handle('pause', stop); handle('stop', stop);
  handle('nexttrack', () => skip(1)); handle('previoustrack', () => skip(-1));
  for (const action of ['seekto', 'seekforward', 'seekbackward']) handle(action, null);
}

// MARK: Spotify (ios/Sources/Spotify.swift)

// The listener's own Spotify account: sign in with PKCE (no secret here), heart
// songs into their Liked Songs, and list their playlists. Nate's Software's
// playlist always sits at the top of that list.
const SPOTIFY_REDIRECT = 'https://nates-software.com/hifi/spotify/callback';
const SPOTIFY_SCOPES = 'user-library-read user-library-modify playlist-read-private playlist-read-collaborative';
const isClientId = text => /^[0-9a-f]{32}$/i.test(text.trim());
const tokenStore = createStorage('hifi.spotify', { defaults: () => null, validate: v => v && typeof v.refresh === 'string' && isClientId(v.clientId) });
const pendingStore = createStorage('hifi.spotify.pending', { defaults: () => null, validate: v => v && typeof v.state === 'string' && typeof v.verifier === 'string' });
const resultStore = createStorage('hifi.spotify.result', { defaults: () => null, validate: v => v && typeof v.error === 'string' });
// Spotify lets HIFI's shared app sign in only a handful of listeners, so anyone
// else can plug in a Spotify app of their own (Client ID only, PKCE, no secret).
const ownStore = createStorage('hifi.spotify.own', { defaults: () => null, validate: v => isClientId(String(v)) });
const spotify = {
  connected: Boolean(tokenStore.get()), playlists: [], nate: null, liked: {}, problem: null,
  showConnect: false, showSetup: false, sharedClientId: null, own: ownStore.get(), trackIds: {},
};
let failTimer = 0, configLoad = null;
function spotifyFail(message) {
  spotify.problem = message;
  clearTimeout(failTimer);
  failTimer = setTimeout(() => { spotify.problem = null; changed(); }, 3000);
  changed();
}
// The client ID and Nate's playlist come from nates-software.com, so neither is baked in.
function loadConfig() {
  if (spotify.sharedClientId && spotify.nate) return Promise.resolve();
  configLoad ||= (async () => {
    try {
      const response = await fetch('/api/spotify-config', { signal: AbortSignal.timeout(6000) });
      const config = await response.json();
      if (isClientId(String(config?.clientId))) spotify.sharedClientId = config.clientId;
      const id = typeof config?.playlist === 'string' ? config.playlist.match(/^https:\/\/open\.spotify\.com\/playlist\/([A-Za-z0-9]+)/)?.[1] : null;
      if (id) spotify.nate = { id, name: "Nate's Software HIFI", detail: 'Picked from HIFI', url: `https://open.spotify.com/playlist/${id}` };
    } catch { /* offline: try again next time */ }
    configLoad = null;
    changed();
  })();
  return configLoad;
}
const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomString = length => base64url(crypto.getRandomValues(new Uint8Array(length)));

function openConnect() { spotify.showConnect = true; changed(); }
function connectSpotify() {
  // Opened inside the click: browsers only allow a pop-up during a user gesture.
  const popup = window.open('', 'hifi-spotify', 'popup,width=480,height=780');
  void (async () => {
    await loadConfig();
    const clientId = spotify.own || spotify.sharedClientId;
    if (!clientId) { popup?.close(); return spotifyFail("Spotify isn't reachable right now. Try again in a minute."); }
    const verifier = randomString(48), state = 'web.' + randomString(24);
    pendingStore.set({ state, verifier, clientId, at: Date.now() });
    resultStore.remove();
    const challenge = base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
    const url = 'https://accounts.spotify.com/authorize?' + new URLSearchParams({ client_id: clientId, response_type: 'code', redirect_uri: SPOTIFY_REDIRECT,
      scope: SPOTIFY_SCOPES, state, code_challenge_method: 'S256', code_challenge: challenge });
    if (popup && !popup.closed) popup.location.href = url;
    else if (!embedded) location.assign(url);
    else spotifyFail('Allow pop-ups for HIFI to connect Spotify.');
  })();
}
// The sign-in finishes on /spotify (spotify.js), in its own window; it leaves the
// tokens here in shared storage.
function syncSpotify() {
  const was = spotify.connected;
  spotify.connected = Boolean(tokenStore.get());
  const result = resultStore.get();
  if (result) { resultStore.remove(); spotifyFail(result.error); }
  if (spotify.connected && !was) { spotify.showConnect = false; spotify.problem = null; void refreshPlaylists(); void checkLiked(); }
  changed();
}
addEventListener('storage', event => { if (event.key?.startsWith('hifi.spotify')) syncSpotify(); });
addEventListener('focus', syncSpotify);

function disconnectSpotify() {
  tokenStore.remove();
  spotify.connected = false;
  spotify.playlists = [];
  spotify.liked = {};
  changed();
}
// A refresh token only works with the app that issued it, so switching apps signs out.
function useOwnApp(id) {
  const next = id ? id.trim().toLowerCase() : null;
  if (next === spotify.own) return;
  disconnectSpotify();
  spotify.own = next;
  if (next) ownStore.set(next); else ownStore.remove();
}

async function accessToken() {
  const saved = tokenStore.get();
  if (!saved) { spotify.connected = false; return null; }
  if (saved.access && saved.expires > Date.now()) return saved.access;
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: saved.refresh, client_id: saved.clientId }) });
    if (!response.ok) return null;
    const tokens = await response.json();
    if (typeof tokens?.access_token !== 'string') return null;
    tokenStore.set({ clientId: saved.clientId, refresh: tokens.refresh_token || saved.refresh, access: tokens.access_token,
      expires: Date.now() + (Number(tokens.expires_in) || 3600) * 1000 - 60000 });
    return tokens.access_token;
  } catch { return null; }
}
async function spotifyCall(method, path) {
  const token = await accessToken();
  if (!token) return null;
  try {
    const response = await fetch('https://api.spotify.com/v1' + path, { method, headers: { Authorization: `Bearer ${token}`, ...(method === 'PUT' ? { 'Content-Type': 'application/json' } : {}) } });
    if (response.status === 401) { const saved = tokenStore.get(); if (saved) tokenStore.set({ ...saved, access: null, expires: 0 }); }
    const text = await response.text();
    // Signed in, but this account isn't on the shared app's Spotify list.
    if (response.status === 403 && !spotify.own && text.includes('registered')) { spotify.showSetup = true; spotify.showConnect = true; changed(); }
    if (!response.ok) return null;
    return text ? JSON.parse(text) : {};
  } catch { return null; }
}
async function resolveTrack(trackId, artist, title) {
  if (trackId) return trackId;
  const key = artist + '\n' + title;
  if (spotify.trackIds[key]) return spotify.trackIds[key];
  const found = await spotifyCall('GET', `/search?type=track&limit=1&q=${encodeURIComponent(`track:${title} artist:${artist}`)}`);
  const id = found?.tracks?.items?.[0]?.id;
  if (typeof id === 'string') spotify.trackIds[key] = id;
  return id || null;
}
const likedNow = () => { const id = spotifyTrackId() || spotify.trackIds[displayArtist() + '\n' + displayTitle()]; return Boolean(id && spotify.liked[id]); };
// Adds or removes the song from the listener's Liked Songs. Without an account
// yet, the heart opens the sign-in screen instead.
async function toggleHeart() {
  if (!spotify.connected) return openConnect();
  const id = await resolveTrack(spotifyTrackId(), displayArtist(), displayTitle());
  if (!id) return spotifyFail("Couldn't find this song on Spotify.");
  const save = !spotify.liked[id];
  spotify.liked[id] = save;  // show it right away; undo if Spotify says no
  changed();
  if (await spotifyCall(save ? 'PUT' : 'DELETE', `/me/tracks?ids=${id}`) === null) { spotify.liked[id] = !save; spotifyFail("Spotify didn't save that. Try again."); }
}
// Looks up whether the current song is already liked, so the heart starts filled.
async function checkLiked() {
  if (!spotify.connected || !heartable()) return;
  const id = await resolveTrack(spotifyTrackId(), displayArtist(), displayTitle());
  if (!id || id in spotify.liked) return;
  const result = await spotifyCall('GET', `/me/tracks/contains?ids=${id}`);
  if (Array.isArray(result)) { spotify.liked[id] = result[0] === true; changed(); }
}
async function refreshPlaylists() {
  await loadConfig();
  if (!spotify.connected) { spotify.playlists = []; return changed(); }
  const page = await spotifyCall('GET', '/me/playlists?limit=50');
  if (!Array.isArray(page?.items)) return;
  spotify.playlists = page.items.filter(item => item && typeof item.id === 'string' && item.id !== spotify.nate?.id).map(item => {
    const count = item.tracks?.total ?? item.items?.total;
    return { id: item.id, name: String(item.name || 'Playlist'), detail: Number.isFinite(count) ? `${count} songs` : 'Playlist', url: `https://open.spotify.com/playlist/${item.id}` };
  });
  changed();
}
const playlistRows = () => [spotify.nate, ...spotify.playlists].filter(Boolean);

// MARK: Desktop host bridge

// The nates-software.com desktop embeds the player and shows what's on in its taskbar.
let parentOrigin = null, lastStatus = '', owner = null, saving = false;
function trustedParent(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'https:' && (url.hostname === 'hifi.nates-software.com' || /^(?:www\.)?nates-software\.com$/.test(url.hostname) || /^(?:[a-z0-9-]+\.)?nates-software\.pages\.dev$/.test(url.hostname)))
      || (url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname));
  } catch { return false; }
}
// A classic iPod's proportions at the width the host gives us.
function sendHeight() {
  if (!embedded || !parentOrigin) return;
  window.parent.postMessage({ type: 'hifi:height', height: Math.round(Math.min(innerWidth, 560) * 1.6) + (root.classList.contains('hosted') ? GRIP : 0) }, parentOrigin);
}
function sendStatus(force = false) {
  if (!embedded || !parentOrigin) return;
  const live = isLive(radio.station);
  const song = live ? radio.liveSong : radio.track;
  const state = !radio.playing ? 'standby' : radio.buffering || radio.problem?.endsWith('Retuning…') ? 'loading' : radio.volume === 0 ? 'muted' : 'playing';
  const payload = { type: 'hifi:status', version: 1, state, station: radio.station.name.slice(0, 64), stationId: radio.station.id.slice(0, 64), skin: 'ipod',
    track: String(song?.title || '').slice(0, 160), artist: String(song?.artist || '').slice(0, 120),
    link: live ? String(radio.liveSong?.link || '').slice(0, 300) : '', trackId: live ? String(radio.liveSong?.trackId || '') : '' };
  const serialized = JSON.stringify(payload);
  if (force || serialized !== lastStatus) { lastStatus = serialized; window.parent.postMessage(payload, parentOrigin); }
}
addEventListener('message', event => {
  if (!embedded || event.source !== window.parent) return;
  const data = event.data;
  // Owner only: the desktop says when its signed-in owner may add the song to Nate's Software playlist.
  if (event.origin === parentOrigin && data?.type === 'hifi:owner' && data.version === 1) {
    owner = data.enabled === true && typeof data.trackId === 'string' ? { trackId: data.trackId, saved: data.saved === true, error: data.error === true } : null;
    saving = false;
    return changed();
  }
  if (!trustedParent(event.origin) || data?.type !== 'hifi:connect' || data.version !== 1) return;
  parentOrigin = event.origin;
  // The desktop puts its own window buttons over our top edge; the landing page doesn't.
  root.classList.toggle('hosted', new URL(event.origin).hostname !== 'hifi.nates-software.com' && new URL(event.origin).origin !== location.origin);
  layout();
  sendHeight();
  sendStatus(true);
});
function curate() {
  if (!owner || saving || !parentOrigin) return;
  saving = true;
  window.parent.postMessage({ type: 'hifi:save', version: 1, trackId: owner.trackId, save: !owner.saved }, parentOrigin);
  setTimeout(() => { if (saving) { saving = false; changed(); } }, 10000);
  changed();
}
installWindowShortcuts(() => ui.stack.length > 1 || spotify.showConnect);

// MARK: Feel: clicker, haptics, backlight

let clickContext = null, clickBuffer = null;
function wakeClicker() {
  if (!settings.clicker) return;
  try {
    clickContext ||= new AudioContext();
    if (clickContext.state === 'suspended') void clickContext.resume();
  } catch { clickContext = null; }
}
// The iPod's clicker: a tiny tick from the device, not the music.
function clickSound(level) {
  if (!settings.clicker || !clickContext || clickContext.state !== 'running') return;
  if (!clickBuffer) {
    const length = Math.ceil(clickContext.sampleRate * 0.005);
    clickBuffer = clickContext.createBuffer(1, length, clickContext.sampleRate);
    const data = clickBuffer.getChannelData(0);
    for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 5;
  }
  const source = clickContext.createBufferSource(), gain = clickContext.createGain();
  source.buffer = clickBuffer;
  gain.gain.value = level;
  source.connect(gain).connect(clickContext.destination);
  source.start();
}
const feedback = {
  tick() { clickSound(0.35); navigator.vibrate?.(3); },
  click() { clickSound(0.6); navigator.vibrate?.(8); },
};

let dimTimer = 0;
// Backlight: the screen dims after a quiet spell, like the iPod's timer.
function touched() {
  clearTimeout(dimTimer);
  if (root.classList.contains('dimmed')) root.classList.remove('dimmed');
  if (settings.backlight > 0) dimTimer = setTimeout(() => root.classList.add('dimmed'), settings.backlight * 1000);
}

// MARK: Layout

function layout() {
  const width = innerWidth, height = innerHeight - (root.classList.contains('hosted') ? GRIP : 0);
  const wide = width > height * 0.95;
  const pad = Math.max(14, Math.min(width, height) * 0.05);
  let screenWidth, screenHeight, wheel;
  if (wide) {
    wheel = Math.min(height - pad * 2, width * 0.42);
    screenWidth = width - wheel - pad * 3;
    screenHeight = height - pad * 2;
  } else {
    screenWidth = width - pad * 2;
    screenHeight = Math.min(screenWidth * 0.82, height * 0.5);
    wheel = Math.min(width * 0.8, (height - screenHeight - pad * 2) * 0.9);
  }
  root.classList.toggle('wide', wide);
  const set = (name, value) => root.style.setProperty(name, `${Math.max(0, Math.floor(value))}px`);
  set('--pad', pad); set('--sw', screenWidth); set('--sh', screenHeight); set('--wheel', wheel);
  set('--row', Math.min(46, Math.max(26, screenHeight / 8)));
  set('--grip', GRIP);
}
addEventListener('resize', () => { layout(); sendHeight(); ui.view?.update(); });
layout();

// MARK: Menus

const TITLES = { main: 'HIFI', 'band:radio': 'Radio', 'band:synth': 'Synth Sounds', playlists: 'Playlists', nowPlaying: 'Now Playing', settings: 'Settings', about: 'About' };
const MAIN_PAGES = ['nowPlaying', 'band:radio', 'band:synth', 'playlists', 'settings', 'about'];
const ui = { stack: ['main'], selection: {}, showVolume: false, view: null };
const page = () => ui.stack.at(-1);
let volumeTimer = 0;

// "Artist – Song" under each live station; synth stations show their current track.
function songLine(station) {
  if (isLive(station)) {
    const song = radio.songs[station.id];
    return song?.title ? [song.artist, song.title].filter(Boolean).join(' – ') : null;
  }
  if (!station.tracks?.length) return null;
  const track = station.id === radio.station.id && radio.playing && radio.track ? radio.track : rotationAt(station.tracks, catalog.epoch).track;
  return `${track.artist} – ${track.title}`;
}

function rows(p) {
  if (p === 'main') return [{ title: 'Now Playing', playing: radio.playing }, { title: 'Radio' }, { title: 'Synth Sounds' }, { title: 'Playlists' }, { title: 'Settings' }, { title: 'About' }]
    .map(row => ({ chevron: true, ...row }));
  if (p.startsWith('band:')) return stationsIn(p.slice(5)).map(station => ({ title: stationName(station), playing: radio.playing && station.id === radio.station.id, subtitle: songLine(station) }));
  if (p === 'playlists') {
    // Nate's Software's playlist first, then the listener's own.
    const list = playlistRows().map(playlist => ({ title: playlist.name, subtitle: playlist.detail }));
    if (!spotify.connected) list.push({ title: 'Connect Spotify', subtitle: 'See your own playlists here' });
    return list;
  }
  if (p === 'settings') return [
    { title: 'Clicker', value: settings.clicker ? 'On' : 'Off' },
    { title: 'Backlight', value: settings.backlight === 0 ? 'Always On' : `${settings.backlight} Seconds` },
    { title: 'Spotify', value: spotify.connected ? 'Connected' : 'Connect' },
  ];
  return [];
}

const rowHTML = (row, index, selected) => `<div class="row${selected ? ' sel' : ''}${row.subtitle ? ' two' : ''}" role="option" aria-selected="${selected}" data-index="${index}">`
  + (row.subtitle ? `<span class="text"><span class="t">${escape(row.title)}</span><span class="s">${escape(row.subtitle)}</span></span>` : `<span class="t">${escape(row.title)}</span>`)
  + (row.value ? `<span class="v">${escape(row.value)}</span>` : '')
  + (row.playing ? `<span class="spk${radio.buffering ? '' : ' on'}">${ICON.speaker}</span>` : '')
  + (row.chevron ? `<span class="chev">${ICON.chevron}</span>` : '') + '</div>';

function listView(p) {
  const el = document.createElement('div');
  el.className = 'page list-page';
  el.innerHTML = `<div class="list" role="listbox" aria-label="${escape(TITLES[p])}"><div class="rows"></div><div class="hl" aria-hidden="true"></div></div>${p === 'main' ? '<div class="cover-pane"></div>' : ''}`;
  const list = el.querySelector('.list'), rowsEl = el.querySelector('.rows'), hl = el.querySelector('.hl'), pane = el.querySelector('.cover-pane');
  let html = '', coverFor = null, first = true;
  list.addEventListener('click', event => { const row = event.target.closest('.row'); if (row) tapRow(Number(row.dataset.index)); });
  return { el, update() {
    const items = rows(p);
    const current = Math.min(ui.selection[p] ?? 0, Math.max(0, items.length - 1));
    const next = items.map((row, index) => rowHTML(row, index, index === current)).join('');
    if (next !== html) { rowsEl.innerHTML = html = next; }
    hl.hidden = !items.length;
    hl.style.transition = first ? 'none' : '';
    hl.style.transform = `translateY(${current * 100}%)`;
    const row = rowsEl.children[current];
    if (row) {
      const top = row.offsetTop, bottom = top + row.offsetHeight, behavior = first || reducedMotion.matches ? 'auto' : 'smooth';
      if (top < list.scrollTop) list.scrollTo({ top, behavior });
      else if (bottom > list.scrollTop + list.clientHeight) list.scrollTo({ top: bottom - list.clientHeight, behavior });
    }
    if (pane && coverFor !== radio.station.id) {
      coverFor = radio.station.id;
      pane.innerHTML = coverSVG(radio.station);
      if (!first) pane.firstChild.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 350, easing: 'ease-in-out' });
    }
    first = false;
  } };
}

function nowPlayingView() {
  const el = document.createElement('div');
  el.className = 'page now';
  el.innerHTML = `<div class="pos"></div><div class="np-main"><div class="art"></div><div class="details"><div class="title-line"><span class="np-title"></span>`
    + `<button class="heart" type="button" hidden></button><button class="curate" type="button" hidden></button></div>`
    + `<div class="np-artist"></div><div class="np-station"></div><div class="np-problem" role="status"></div></div></div>`
    + `<div class="np-bottom"><div class="progress"><div class="track"><div class="fill"></div></div><div class="labels"><span class="l"></span><span class="m"></span><span class="r"></span></div></div>`
    + `<div class="volume" aria-hidden="true">${ICON.speakerLow}<div class="track"><div class="fill"></div></div>${ICON.speakerHigh}</div></div>`;
  const q = selector => el.querySelector(selector);
  const art = q('.art'), heart = q('.heart'), curateButton = q('.curate');
  heart.addEventListener('click', event => { event.stopPropagation(); touched(); feedback.click(); void toggleHeart(); });
  curateButton.addEventListener('click', event => { event.stopPropagation(); touched(); feedback.click(); curate(); });
  let coverFor = null, first = true;
  const text = (selector, value) => { const node = q(selector); if (node.textContent !== value) node.textContent = value; };
  const view = { el, update() {
    const station = radio.station;
    text('.pos', position());
    const clip = station.tv?.length ? tvClip(station) : '';
    if (coverFor !== station.id + clip) {
      const sameStation = coverFor?.startsWith(station.id);
      coverFor = station.id + clip;
      art.innerHTML = clip ? tvHTML(station, clip) : coverSVG(station);
      if (!first && !sameStation && !reducedMotion.matches) art.firstChild.animate?.([{ transform: 'scale(.85)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: 'ease-out' });
    }
    // The TV plays while the radio does.
    const tv = art.querySelector('video');
    if (tv && radio.playing && tv.paused) tv.play().catch(() => {});
    else if (tv && !radio.playing && !tv.paused) tv.pause();
    el.classList.toggle('stopped', !radio.playing);
    text('.np-title', displayTitle());
    text('.np-artist', displayArtist());
    text('.np-station', stationName(station));
    text('.np-problem', radio.problem || spotify.problem || '');
    heart.hidden = !heartable();
    const liked = likedNow();
    heart.innerHTML = liked ? ICON.heartFill : ICON.heart;
    heart.classList.toggle('liked', liked);
    heart.setAttribute('aria-label', liked ? 'Remove from Liked Songs' : 'Save to Liked Songs on Spotify');
    const curating = Boolean(owner && owner.trackId === spotifyTrackId());
    curateButton.hidden = !curating;
    if (curating) {
      curateButton.innerHTML = owner.saved ? ICON.curated : ICON.curate;
      curateButton.disabled = saving;
      curateButton.title = owner.error ? 'Spotify save failed; try again' : owner.saved ? "In Nate's Software playlist (click to remove)" : "Add to Nate's Software playlist";
      curateButton.setAttribute('aria-label', curateButton.title);
    }
    el.classList.toggle('show-volume', ui.showVolume);
    q('.volume .fill').style.width = `${radio.volume * 100}%`;
    view.tick();
    first = false;
  }, tick() {
    const live = isLive(radio.station);
    const duration = live ? 0 : radio.track?.duration || 0;
    const done = Math.min(elapsed(), duration);
    const progress = q('.progress');
    progress.classList.toggle('live', live);
    progress.classList.toggle('shimmer', live && radio.playing);
    q('.progress .fill').style.width = `${(duration > 0 ? done / duration : radio.playing ? 1 : 0) * 100}%`;
    text('.l', live ? 'LIVE' : clock(done));
    text('.m', radio.buffering ? 'Tuning…' : radio.playing ? '' : 'Stopped');
    text('.r', live ? 'HIFI' : '-' + clock(duration - done));
  } };
  return view;
}

function aboutView() {
  const el = document.createElement('div');
  el.className = 'page about';
  el.innerHTML = '<div><b>HIFI</b><strong>by Nate\'s Software</strong><p>Live radio from Radio Paradise and SomaFM, streamed straight from the stations. Synth Sounds are made here.</p><span>hifi.nates-software.com</span></div>';
  el.addEventListener('click', () => menu());
  return { el, update() {} };
}

const makeView = p => p === 'nowPlaying' ? nowPlayingView() : p === 'about' ? aboutView() : listView(p);

function show(forward) {
  const old = ui.view, p = page();
  if (p !== 'nowPlaying' && isVideo(radio.station) && radio.playing) stop();
  const view = makeView(p);
  ui.view = view;
  $('pages').append(view.el);
  view.update();
  const title = $('title');
  if (title.textContent !== TITLES[p]) {
    title.textContent = TITLES[p];
    if (old && !reducedMotion.matches) title.animate?.([{ opacity: 0 }, { opacity: 1 }], { duration: 200 });
  }
  if (!old) return entered(p);
  if (reducedMotion.matches || !view.el.animate) { old.el.remove(); return entered(p); }
  const options = { duration: 250, easing: 'ease-in-out' };
  view.el.animate([{ transform: `translateX(${forward ? 100 : -100}%)` }, { transform: 'none' }], options);
  old.el.animate([{ transform: 'none' }, { transform: `translateX(${forward ? -100 : 100}%)` }], options).finished.finally(() => old.el.remove());
  entered(p);
}

let songsTimer = 0;
function entered(p) {
  clearInterval(songsTimer);
  if (p === 'playlists') void refreshPlaylists();
  // While a station list is open, keep its song lines current.
  if (p.startsWith('band:')) { void refreshSongs(); songsTimer = setInterval(refreshSongs, 20000); }
}

function push(next) {
  if (next.startsWith('band:')) {
    const index = stationsIn(next.slice(5)).indexOf(radio.station);
    if (index >= 0) ui.selection[next] = index;
  }
  ui.stack.push(next);
  show(true);
}

function menu() {
  touched();
  if (spotify.showConnect) { spotify.showConnect = false; return changed(); }
  if (ui.stack.length <= 1) return;
  ui.stack.pop();
  show(false);
}

function rotate(steps) {
  touched();
  if (spotify.showConnect) return;
  if (page() === 'nowPlaying') {
    setVolume(radio.volume + steps * 0.04);
    ui.showVolume = true;
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => { ui.showVolume = false; changed(); }, 1600);
    feedback.tick();
    return changed();
  }
  const count = rows(page()).length;
  if (!count) return;
  const current = ui.selection[page()] ?? 0;
  const next = Math.min(count - 1, Math.max(0, current + steps));
  if (next === current) return;
  ui.selection[page()] = next;
  feedback.tick();
  changed();
}

// Tapping a row moves the highlight there first, so you see what you picked.
function tapRow(index) {
  touched();
  wakeClicker();
  feedback.click();
  ui.selection[page()] = index;
  ui.view.update();
  select();
}

function select() {
  touched();
  if (spotify.showConnect) return;
  const p = page(), index = ui.selection[p] ?? 0;
  if (p === 'main') { if (MAIN_PAGES[index]) push(MAIN_PAGES[index]); }
  else if (p.startsWith('band:')) {
    const station = stationsIn(p.slice(5))[index];
    if (!station) return;
    tune(station);
    if (page() !== 'nowPlaying') push('nowPlaying');  // a video station already went there
  } else if (p === 'playlists') {
    // Spotify plays its own music: a playlist opens in Spotify.
    const playlist = playlistRows()[index];
    if (playlist) window.open(playlist.url, '_blank', 'noopener,noreferrer'); else openConnect();
  } else if (p === 'settings') {
    const title = rows(p)[index]?.title;
    if (title === 'Clicker') { settings.clicker = !settings.clicker; wakeClicker(); }
    else if (title === 'Spotify') { if (spotify.connected) disconnectSpotify(); else openConnect(); }
    else if (title === 'Backlight') {
      const options = [10, 30, 60, 0];
      settings.backlight = options[(Math.max(0, options.indexOf(settings.backlight)) + 1) % options.length];
      touched();
    }
    savePrefs();
    changed();
  } else if (p === 'nowPlaying') toggle();
  else if (p === 'about') menu();
}

// MARK: Click wheel

const REGIONS = ['menu', 'next', 'play', 'previous'];
const HUB = 0.36, DETENT = Math.PI * 2 / 18;
function buildWheel() {
  const wheel = $('wheel');
  // One quarter of the ring per button, centered on it.
  const point = (radius, degrees) => `${(radius * Math.cos(degrees * Math.PI / 180)).toFixed(3)} ${(radius * Math.sin(degrees * Math.PI / 180)).toFixed(3)}`;
  const wedge = middle => `M${point(50, middle - 45)}A50 50 0 0 1 ${point(50, middle + 45)}L${point(50 * HUB, middle + 45)}A${50 * HUB} ${50 * HUB} 0 0 0 ${point(50 * HUB, middle - 45)}Z`;
  wheel.innerHTML = `<svg class="wedges" viewBox="-50 -50 100 100" aria-hidden="true"><defs><radialGradient id="wedge" cx="0" cy="0" r="50" gradientUnits="userSpaceOnUse"><stop offset="${HUB}" stop-color="rgba(0,0,0,.03)"/><stop offset="1" stop-color="rgba(0,0,0,.13)"/></radialGradient></defs>`
    + REGIONS.map((region, i) => `<path data-region="${region}" fill="url(#wedge)" d="${wedge(-90 + i * 90)}"/>`).join('') + '</svg>'
    + '<span class="glow" aria-hidden="true"></span>'
    + `<button class="label" data-region="menu" type="button" style="--x:0;--y:-1" aria-label="Menu">MENU</button>`
    + `<button class="label" data-region="next" type="button" style="--x:1;--y:0" aria-label="Next song">${ICON.next}</button>`
    + `<button class="label" data-region="play" type="button" style="--x:0;--y:1" aria-label="Play or stop">${ICON.playPause}</button>`
    + `<button class="label" data-region="previous" type="button" style="--x:-1;--y:0" aria-label="Previous song">${ICON.previous}</button>`
    + `<button class="hub" data-region="center" type="button" aria-label="Select"></button>`;
  // Screen readers and keyboards press the buttons; pointers use the wheel itself.
  wheel.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (button && event.detail === 0) { wakeClicker(); act(button.dataset.region); }
  });
  let last = null, accumulated = 0, rotated = false, onRing = false, origin = null, pressedRegion = null, releaseTimer = 0;
  const geometry = event => {
    const box = wheel.getBoundingClientRect(), dx = event.clientX - box.left - box.width / 2, dy = event.clientY - box.top - box.height / 2;
    return { dx, dy, distance: Math.hypot(dx, dy), angle: Math.atan2(dy, dx), diameter: box.width };
  };
  const regionAt = ({ dx, dy, distance, diameter }) => {
    if (distance > diameter / 2) return null;
    if (distance <= diameter * HUB / 2) return 'center';
    const angle = Math.atan2(dy, dx);
    return angle >= -3 * Math.PI / 4 && angle < -Math.PI / 4 ? 'menu' : angle >= -Math.PI / 4 && angle < Math.PI / 4 ? 'next' : angle >= Math.PI / 4 && angle < 3 * Math.PI / 4 ? 'play' : 'previous';
  };
  const glow = wheel.querySelector('.glow');
  wheel.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    window.focus();  // keys go to the player after a click, even inside the desktop's frame
    wheel.setPointerCapture(event.pointerId);
    clearTimeout(releaseTimer);
    wakeClicker();
    const g = geometry(event);
    last = g.angle; accumulated = 0; rotated = false; onRing = g.distance > g.diameter * HUB / 2;
    origin = { x: event.clientX, y: event.clientY };
    touched();
    pressedRegion = regionAt(g);
    press(pressedRegion);
  });
  wheel.addEventListener('pointermove', event => {
    const g = geometry(event);
    if (last === null) { if (event.pointerType === 'mouse') hover(regionAt(g)); return; }
    if (!onRing || g.distance < g.diameter * HUB * 0.3) return;
    let delta = g.angle - last;
    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;
    last = g.angle;
    accumulated += delta;
    if (rotated || Math.abs(accumulated) > DETENT * 0.5) {
      press(null);
      // A soft glow under the finger while scrolling.
      const reach = g.diameter * (1 + HUB) / 4;
      glow.style.transform = `translate(${Math.cos(g.angle) * reach}px, ${Math.sin(g.angle) * reach}px)`;
      glow.classList.add('on');
    }
    while (Math.abs(accumulated) >= DETENT) {
      const step = accumulated > 0 ? 1 : -1;  // clockwise scrolls down, like the iPod
      rotate(step);
      accumulated -= step * DETENT;
      rotated = true;
    }
  });
  const end = event => {
    if (last === null) return;
    const tapped = event.type === 'pointerup' && !rotated && Math.hypot(event.clientX - origin.x, event.clientY - origin.y) < 12;
    const target = regionAt(geometry(event));
    last = null;
    glow.classList.remove('on');
    if (tapped && target) {
      feedback.click();
      act(target);
      // Hold the pressed look a beat so a quick tap still shows where it landed.
      press(target);
      releaseTimer = setTimeout(() => press(null), 130);
    } else press(null);
  };
  wheel.addEventListener('pointerup', end);
  wheel.addEventListener('pointercancel', end);
  wheel.addEventListener('pointerleave', event => { if (event.pointerType === 'mouse' && last === null) hover(null); });
}
function setRegionClass(name, region) {
  for (const node of $('wheel').querySelectorAll('[data-region]')) node.classList.toggle(name, node.dataset.region === region);
}
const press = region => setRegionClass('active', region);
const hover = region => setRegionClass('hover', region);
let flashTimer = 0;
// A key press flashes the matching part of the wheel, so the keyboard shows where it "clicked".
function flash(region) {
  press(region);
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => press(null), 140);
}
function act(region) {
  if (region === 'center') select();
  else if (region === 'menu') menu();
  else if (region === 'next') { touched(); skip(1); }
  else if (region === 'previous') { touched(); skip(-1); }
  else if (region === 'play') { touched(); toggle(); }
}
buildWheel();

// A mouse wheel or trackpad scrolls the menus too.
let scrolled = 0;
document.querySelector('.device').addEventListener('wheel', event => {
  if (spotify.showConnect) return;
  event.preventDefault();
  scrolled += event.deltaY;
  while (Math.abs(scrolled) >= 40) { const step = scrolled > 0 ? 1 : -1; rotate(step); scrolled -= step * 40; }
}, { passive: false });

addEventListener('keydown', event => {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (spotify.showConnect) { if (event.key === 'Escape') { event.preventDefault(); menu(); } return; }
  if (event.target.closest?.('input, textarea, button.heart, button.curate')) return;
  const keys = {
    ArrowUp: [null, () => rotate(-1)], ArrowDown: [null, () => rotate(1)],
    ArrowLeft: ['previous', () => skip(-1)], ArrowRight: ['next', () => skip(1)],
    Enter: ['center', select], Escape: ['menu', menu], Backspace: ['menu', menu], ' ': ['play', toggle],
  };
  const entry = keys[event.key];
  if (!entry) return;
  event.preventDefault();
  wakeClicker();
  if (entry[0]) { flash(entry[0]); feedback.click(); }
  touched();
  entry[1]();
});

// MARK: Spotify connect screen

const connect = $('connect');
$('sp-connect').addEventListener('click', connectSpotify);
$('sp-later').addEventListener('click', () => { spotify.showConnect = false; changed(); });
$('sp-own').addEventListener('click', () => { spotify.showSetup = true; changed(); $('sp-client').value = spotify.own || ''; validateClient(); });
$('sp-back').addEventListener('click', () => { spotify.showSetup = false; changed(); });
$('sp-shared').addEventListener('click', () => { useOwnApp(null); spotify.showSetup = false; changed(); });
$('sp-copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(SPOTIFY_REDIRECT); $('sp-copy').textContent = 'Copied'; } catch { $('sp-copy').textContent = 'Select and copy'; }
});
const validateClient = () => { $('sp-own-connect').disabled = !isClientId($('sp-client').value); };
$('sp-client').addEventListener('input', validateClient);
$('sp-own-connect').addEventListener('click', () => { useOwnApp($('sp-client').value); connectSpotify(); });
function renderConnect() {
  connect.hidden = !spotify.showConnect;
  $('connect-intro').hidden = spotify.showSetup;
  $('connect-setup').hidden = !spotify.showSetup;
  $('sp-own').textContent = spotify.own ? 'Using your own Spotify app' : 'Use your own Spotify app';
  $('sp-shared').hidden = !spotify.own;
  for (const node of connect.querySelectorAll('.sp-problem')) node.textContent = spotify.problem || '';
}

// MARK: Render

let frame = 0;
function changed() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const state = $('state');
    const icon = radio.playing ? 'play' : 'pause';
    if (state.dataset.icon !== icon) { state.dataset.icon = icon; state.innerHTML = ICON[icon]; }
    state.classList.toggle('buffering', radio.buffering);
    ui.view?.update();
    syncVideo();
    renderConnect();
    updateMediaSession();
    sendStatus();
  });
}
setInterval(() => { if (page() === 'nowPlaying' && radio.playing) ui.view?.tick(); }, 500);
// The synth rotations move on by themselves; keep the open list's song lines honest.
setInterval(() => { if (page().startsWith('band:')) changed(); }, 5000);

// `?page=radio|synth|nowPlaying|playlists|settings|about` opens on that screen.
const opening = { radio: 'band:radio', synth: 'band:synth', nowPlaying: 'nowPlaying', playlists: 'playlists', settings: 'settings', about: 'about' }[params.get('page')];
if (opening) {
  ui.stack.push(opening);
  if (opening.startsWith('band:')) ui.selection[opening] = Math.max(0, stationsIn(opening.slice(5)).indexOf(radio.station));
}
show(true);
touched();
changed();
void loadConfig();
if (spotify.connected) void refreshPlaylists();
if (params.get('autoplay') === '1') start();
void loadVideoStations();
