import { installWindowShortcuts } from './engine/windowShortcuts.js';
import { getAudio, installAudioUnlock } from './engine/audio.js';
import { createStorage } from './engine/storage.js';
import { rotationAt } from './engine/scheduler.js';
import { createTicker } from './engine/ticker.js';
import { createTV } from './tv.js';

const $ = id => document.getElementById(id);
const deck = document.querySelector('.deck');
const embedded = window.parent !== window;
if (embedded) document.documentElement.classList.add('embedded');
let parentOrigin = null, lastStatus = '', playbackError = false;
function trustedParent(origin) {
  try {
    const url = new URL(origin);
    return (url.protocol === 'https:' && (url.hostname === 'hifi.nates-software.com' || /^(?:www\.)?nates-software\.com$/.test(url.hostname) || /^(?:[a-z0-9-]+\.)?nates-software\.pages\.dev$/.test(url.hostname)))
      || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname));
  } catch { return false; }
}
function sendHeight() {
  if (!embedded || !parentOrigin) return;
  // Report the natural content height, not the host-imposed fill height.
  deck.classList.add('measure');
  const height = Math.ceil(deck.getBoundingClientRect().height);
  deck.classList.remove('measure');
  if (height > 0) window.parent.postMessage({type:'hifi:height',height},parentOrigin);
}
// A clipped rotation (short embedded window) keeps the playing row in view
// without scrolling any ancestor document.
function keepRowVisible(row) {
  const box = $('tracks');
  if (!row || box.scrollHeight <= box.clientHeight) return;
  const boxRect = box.getBoundingClientRect(), rowRect = row.getBoundingClientRect();
  if (rowRect.top < boxRect.top || rowRect.bottom > boxRect.bottom) box.scrollTop += rowRect.top - boxRect.top;
}
function sendStatus(force = false) {
  if (!embedded || !parentOrigin) return;
  const current = station && catalog ? position().track : null;
  const track = current?.placeholder ? null : current;
  const state = busy || session?.buffering ? 'loading' : playbackError ? 'error' : !playing ? 'standby' : audio?.context.state !== 'running' ? 'interrupted' : Number($('volume').value) === 0 ? 'muted' : 'playing';
  const payload = {type:'hifi:status',version:1,state,station:String(station?.name || '').slice(0,64),stationId:String(station?.id || '').slice(0,64),skin:String(document.body.dataset.theme || '').slice(0,32),track:String(track?.title || '').slice(0,160),artist:String(track?.artist || '').slice(0,120),link:String(track?.spotify || '').slice(0,300),trackId:String(track?.trackId || '').slice(0,40)};
  const serialized = JSON.stringify(payload);
  if (force || serialized !== lastStatus) { lastStatus = serialized; window.parent.postMessage(payload,parentOrigin); }
}
document.addEventListener('hifi:skin', () => sendStatus(true));
window.addEventListener('message', event => {
  if (embedded && event.source === window.parent && event.origin === parentOrigin && event.data?.type === 'hifi:owner' && event.data?.version === 1) {
    const d = event.data;
    owner = d.enabled === true && typeof d.trackId === 'string' ? { trackId: d.trackId, saved: d.saved === true, error: d.error === true } : null;
    saving = false; renderHeart(); return;
  }
  if (!embedded || event.source !== window.parent || !trustedParent(event.origin) || event.data?.type !== 'hifi:connect' || event.data?.version !== 1) return;
  parentOrigin = event.origin;
  sendHeight(); sendStatus(true);
});
if (new URLSearchParams(location.search).get('compact') === '1') document.documentElement.classList.add('compact');
const preferences = createStorage('hifi.preferences', {
  defaults: () => ({ station: 'radio-paradise', volume: 0.65 }),
  validate: p => p && typeof p.station === 'string' && Number.isFinite(p.volume) && p.volume >= 0 && p.volume <= 1,
});
const saved = preferences.get();
const ticker = createTicker($('ticker'), { speed: 27 });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let catalog, station, audio, session, playing = false, busy = false;
let remaining = false, visualMode = reducedMotion.matches ? 'off' : 'spectrum', lastTitle = '', previousFrame = 0;
const visualModes = ['spectrum', 'scope', 'orbit', 'silk', 'waterfall', 'off'];
if (!reducedMotion.matches && visualModes.includes(saved.visualMode)) visualMode = saved.visualMode;
const paletteNames = ['Station', 'Ice', 'Ember', 'Violet'];
let paletteIndex = Number.isInteger(saved.palette) && saved.palette >= 0 && saved.palette < 4 ? saved.palette : 0;
let variation = Number.isInteger(saved.variation) && saved.variation >= 0 && saved.variation < 3 ? saved.variation : 0;
const variationNames = {
  spectrum: ['Classic', 'Fine', 'Mirror'], scope: ['Trace', 'Layers', 'Ribbon'],
  orbit: ['Halo', 'Petals', 'Prism'], silk: ['Ribbons', 'Weave', 'Mirrors'],
  waterfall: ['Scroll', 'Mirror', 'Contour'], off: ['Classic', 'Fine', 'Mirror'],
};
const peaks = new Float32Array(64);
const waveform = new Uint8Array(256);
let lastVisualFrame = 0, visualPhase = 0;
const buffers = new Map();
const samples = new Uint8Array(128);
const canvas = $('scope'), pen = canvas.getContext('2d');
$('volume').value = saved.volume;
$('volume-value').value = Math.round(saved.volume * 100);
// Two bands of presets: live Radio (the default) and generated Synth Sounds.
const bands = {
  radio: { label: 'Radio stations', note: 'Live, listener-supported internet radio' },
  synth: { label: 'Synth Sounds stations', note: 'Generated synth music for coding and focus' },
};
let band = Object.hasOwn(bands, saved.tab) ? saved.tab : 'radio';
// HIFI TV opens for the Synth Sounds stations unless the listener closed it
// (or prefers reduced motion, where it stays closed until asked for).
const tv = createTV($('tv'));
let tvWanted = typeof saved.tv === 'boolean' ? saved.tv : !reducedMotion.matches;
const save = () => preferences.set({ station: station.id, volume: Number($('volume').value), visualMode, palette: paletteIndex, variation, tab: band, tv: tvWanted });
// A live station's song is only named when its broadcaster publishes it; until
// then the placeholder is never reported to a host as a song title.
let liveTrack = null, nowPlayingFor = null, nowPlayingTimer = 0, playlistUrl = '';
// Owner-only save heart: the nates-software.com desktop tells an embedded HIFI
// when its signed-in owner may curate, and performs the authenticated save.
let owner = null, saving = false;
const liveNow = () => liveTrack && liveTrack.station === station.id ? liveTrack : { title: 'Live broadcast', artist: station.name, placeholder: true };
const position = (at = Date.now()) => station.stream ? { track: liveNow(), offset: 0, remaining: 0 } : rotationAt(station.tracks, catalog.epoch, at);
async function refreshNowPlaying(target) {
  let delay = 30;
  try {
    const response = await fetch(target.nowPlaying, { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw Error(`Now playing: ${response.status}`);
    const data = await response.json();
    if (nowPlayingFor !== target.id) return;
    if (typeof data.title === 'string' && data.title) {
      const spotify = typeof data.spotify === 'string' && data.spotify.startsWith('https://open.spotify.com/') ? data.spotify : '';
      const trackId = typeof data.trackId === 'string' && /^[A-Za-z0-9]{22}$/.test(data.trackId) ? data.trackId : '';
      const share = trackId && typeof data.share === 'string' && data.share === `https://nates-software.com/hifi/song/${trackId}` ? data.share : '';
      playlistUrl = typeof data.playlist === 'string' && data.playlist.startsWith('https://open.spotify.com/playlist/') ? data.playlist : '';
      liveTrack = { station: target.id, title: data.title, artist: typeof data.artist === 'string' && data.artist ? data.artist : target.name, spotify: share || spotify, shared: Boolean(share), trackId };
      // Poll again shortly after the broadcaster says this song ends.
      if (Number.isFinite(data.remaining)) delay = Math.min(60, Math.max(8, data.remaining + 3));
      // Stations without a song length suggest their own polling interval.
      else if (Number.isFinite(data.poll)) delay = Math.min(60, Math.max(10, data.poll));
    }
  } catch (error) { console.warn('Now-playing metadata unavailable', error); }
  if (nowPlayingFor === target.id) nowPlayingTimer = setTimeout(() => void refreshNowPlaying(target), delay * 1000);
}
function syncNowPlaying() {
  const want = playing && station?.stream && station.nowPlaying ? station : null;
  if ((want?.id || null) === nowPlayingFor) return;
  clearTimeout(nowPlayingTimer); liveTrack = null; nowPlayingFor = want?.id || null;
  if (want) void refreshNowPlaying(want);
}
const time = seconds => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;

// Keep only the current and upcoming decoded tracks, independent of catalog size.
async function loadTrack(track) {
  if (!buffers.has(track.src)) buffers.set(track.src, fetch(track.src, {signal: AbortSignal.timeout(20000)}).then(response => {
    if (!response.ok) throw Error(`Track fetch failed: ${response.status}`);
    return response.arrayBuffer();
  }).then(data => audio.context.decodeAudioData(data)));
  const pending = buffers.get(track.src);
  try { return await pending; }
  catch (error) { if (buffers.get(track.src) === pending) buffers.delete(track.src); throw error; }
}
function trimBuffers(state) {
  for (const key of buffers.keys()) if (key !== state.track.src && key !== state.next.src) buffers.delete(key);
}
let restarting = false;
function signalFailure(error) {
  console.error('Radio playback failed', error);
  fadeOut(session); session = null; playing = false; playbackError = true;
  $('gate').hidden = false;
  $('status').textContent = 'Signal interrupted. Press Play to reconnect.';
  renderPower();
}
function fadeOut(old) {
  if (!old) return;
  if (old.media) { old.media.pause(); old.media.removeAttribute('src'); old.media.load(); old.source.disconnect(); old.bus.disconnect(); return; }
  const now = audio.context.currentTime;
  old.bus.gain.cancelAndHoldAtTime(now);
  old.bus.gain.linearRampToValueAtTime(0, now + 1);
  for (const source of old.sources) source.stop(now + 1);
  setTimeout(() => old.bus.disconnect(), 1100);
}
function scheduleVoice(target, track, when, offset, duration) {
  const source = audio.context.createBufferSource(), gain = audio.context.createGain();
  source.buffer = target.decoded.get(track.src);
  // Extend the outgoing tail by one second so fades overlap without shortening
  // the manifest rotation. Even one-track stations have a soft loop boundary.
  source.loop = true;
  source.loopEnd = Math.min(track.duration, source.buffer.duration);
  source.loopStart = Math.max(0, source.loopEnd - 1);
  source.connect(gain); gain.connect(target.bus);
  gain.gain.setValueAtTime(0, when);
  gain.gain.linearRampToValueAtTime(1, when + Math.min(1, duration));
  gain.gain.setValueAtTime(1, when + duration);
  gain.gain.linearRampToValueAtTime(0, when + duration + 1);
  source.start(when, Math.min(offset, source.loopEnd - 0.001));
  source.stop(when + duration + 1);
  target.sources.add(source);
  source.onended = () => { target.sources.delete(source); source.disconnect(); gain.disconnect(); };
}
async function startStation() {
  const selected = station, previousSession = session;
  let state;
  // Recheck the wall clock after loading, including when a short seed ends mid-fetch.
  for (;;) {
    state = position();
    await loadTrack(state.track);
    if (station !== selected || session !== previousSession) return;
    if (position().track.src === state.track.src) break;
  }
  const now = audio.context.currentTime, wall = Date.now();
  state = position(wall);
  const decoded = new Map([[state.track.src, await loadTrack(state.track)]]);
  trimBuffers(state);
  const nextSession = { bus: audio.context.createGain(), sources: new Set(), decoded,
    wall, contextTime: now, nextWall: wall + state.remaining * 1000,
    nextIndex: (state.index + 1) % station.tracks.length };
  nextSession.bus.connect(audio.analyser);
  fadeOut(session);
  session = nextSession;
  scheduleVoice(session, state.track, now, state.offset, state.remaining);
  playing = true;
  pump();
}
function startStream(target) {
  const media = new Audio(); media.crossOrigin = 'anonymous'; media.preload = 'none';
  media.src = target.stream;
  const source = audio.context.createMediaElementSource(media), bus = audio.context.createGain();
  source.connect(bus); bus.connect(audio.analyser);
  fadeOut(session);
  const next = { media, source, bus };
  session = next;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(Error('Live stream timed out')), 15000);
    const fail = () => {
      clearTimeout(timeout);
      if (session !== next) return;
      if (busy) { reject(Error('Live stream unavailable')); return; }
      playbackError = true; playing = false; fadeOut(session); session = null;
      $('gate').hidden = false;
      $('status').textContent = 'The live signal stopped. Press Play to reconnect.'; renderPower();
    };
    next.fail = fail;
    media.addEventListener('error', fail); media.addEventListener('ended', fail);
    media.addEventListener('waiting', () => { if (session === next) { next.buffering = true; next.waitingSince ||= Date.now(); renderPower(); } });
    media.addEventListener('playing', () => { if (session === next) { next.buffering = false; next.waitingSince = 0; renderPower(); } });
    // Invoke play inside the original gesture, before unlocking or fetching awaits.
    media.play().then(() => { clearTimeout(timeout); resolve(); }, error => { clearTimeout(timeout); reject(error); });
  });
}
function pump() {
  if (session?.media && session.waitingSince && Date.now() - session.waitingSince > 20000) { session.fail(); return; }
  if (busy || !playing || !session || session.media || audio.context.state !== 'running') return;
  const now = audio.context.currentTime;
  // Recover from background timer throttling or a changed system clock.
  const drift = Date.now() - (session.wall + (now - session.contextTime) * 1000);
  if (Math.abs(drift) > 1500 || session.nextWall < Date.now() - 1500) {
    if (!restarting) {
      restarting = true;
      const recovering = session;
      void startStation().catch(error => { if (session === recovering) signalFailure(error); }).finally(() => { restarting = false; });
    }
    return;
  }
  const target = session, track = station.tracks[target.nextIndex];
  if (!target.decoded.has(track.src) && !target.loading) {
    target.loading = true;
    void loadTrack(track).then(buffer => {
      if (session === target) target.decoded.set(track.src, buffer);
    }).catch(error => { if (session === target) signalFailure(error); })
      .finally(() => { target.loading = false; });
  }
  if (target.nextWall < Date.now() + 2500 && target.decoded.has(track.src)) {
    const when = target.contextTime + (target.nextWall - target.wall) / 1000;
    const offset = Math.max(0, now - when);
    scheduleVoice(target, track, Math.max(now, when), offset, Math.max(0.01, track.duration - offset));
    target.nextWall += track.duration * 1000;
    target.nextIndex = (target.nextIndex + 1) % station.tracks.length;
    const upcoming = station.tracks[target.nextIndex];
    for (const key of target.decoded.keys()) if (key !== track.src && key !== upcoming.src) target.decoded.delete(key);
    trimBuffers({track, next: upcoming});
  }
}
function renderHeart() {
  const id = station?.stream && liveTrack?.station === station.id ? liveTrack.trackId : '';
  const show = Boolean(owner && id && owner.trackId === id);
  $('heart').hidden = !show;
  if (!show) return;
  $('heart').textContent = owner.saved ? '♥' : '♡';
  $('heart').setAttribute('aria-pressed', owner.saved);
  $('heart').title = owner.error ? 'Spotify save failed; try again' : owner.saved ? "Saved to Nate's Software playlist (click to remove)" : "Save to Nate's Software playlist";
  $('heart').setAttribute('aria-label', $('heart').title);
  $('heart').disabled = saving;
}
$('heart').addEventListener('click', () => {
  if (!owner || saving || !parentOrigin) return;
  saving = true; renderHeart();
  window.parent.postMessage({ type: 'hifi:save', version: 1, trackId: owner.trackId, save: !owner.saved }, parentOrigin);
  setTimeout(() => { if (saving) { saving = false; renderHeart(); } }, 10000);
});
function renderStation() {
  document.documentElement.style.setProperty('--signal', station.color);
  $('station-name').textContent = station.name;
  $('tagline').textContent = station.tagline;
  $('provider').hidden = !station.stream;
  $('provider').href = station.website || '#';
  $('provider').textContent = station.providerLabel || 'Radio Paradise · support the station ↗';
  // Listener-supported broadcasters with a separate donation page get a direct link.
  $('support').hidden = !(station.stream && station.support);
  if (station.support) { $('support').href = station.support; $('support').textContent = `Support ${station.provider || 'the station'} ↗`; }
  else $('support').removeAttribute('href');
  $('provider-links').hidden = !station.stream;
  $('clock').disabled = Boolean(station.stream);
  $('clock').setAttribute('aria-label', station.stream ? 'Live broadcast' : 'Track elapsed time; click for remaining');
  $('mix-mode').textContent = station.stream ? 'LIVE BROADCAST' : 'CONTINUOUS MIX';
  for (const button of $('stations').children) button.setAttribute('aria-pressed', button.dataset.id === station.id);
  const list = $('tracks');
  list.replaceChildren();
  const tracks = station.stream ? [{ title: 'Live broadcast', duration: null }] : station.tracks;
  for (const [index, track] of tracks.entries()) {
    const row = document.createElement('li'); row.dataset.index = index;
    const title = document.createElement('span'); title.className = 'track-name'; title.textContent = track.title;
    const duration = document.createElement('span'); duration.className = 'track-length'; duration.textContent = track.duration ? time(track.duration) : 'Live';
    row.append(title, duration); list.append(row);
  }
  peaks.fill(0);
  lastTitle = '';
  renderTV();
  sendStatus();
}
const tabs = [...document.querySelectorAll('[role=tab]')];
function renderBand() {
  for (const tab of tabs) {
    const selected = tab.dataset.band === band;
    tab.setAttribute('aria-selected', selected);
    tab.tabIndex = selected ? 0 : -1;
    if (selected) $('band-panel').setAttribute('aria-labelledby', tab.id);
  }
  $('band-note').textContent = bands[band].note;
  $('stations').setAttribute('aria-label', bands[band].label);
  let count = 0;
  for (const button of $('stations').children) {
    const visible = button.dataset.band === band;
    button.hidden = !visible; if (visible) count++;
  }
  if (catalog) $('station-count').textContent = `${count} station${count === 1 ? '' : 's'}`;
}
function selectBand(next, { remember = true, focus = false } = {}) {
  if (!Object.hasOwn(bands, next)) return;
  band = next; renderBand();
  if (focus) tabs.find(tab => tab.dataset.band === band)?.focus();
  if (remember && station) save();
}
for (const tab of tabs) {
  tab.addEventListener('click', () => selectBand(tab.dataset.band));
  tab.addEventListener('keydown', event => {
    const index = tabs.indexOf(tab);
    const target = { ArrowRight: index + 1, ArrowDown: index + 1, ArrowLeft: index - 1, ArrowUp: index - 1, Home: 0, End: tabs.length - 1 }[event.key];
    if (target === undefined) return;
    event.preventDefault();
    selectBand(tabs[(target + tabs.length) % tabs.length].dataset.band, { focus: true });
  });
}
renderBand();
function renderPower() {
  $('previous-station').disabled = $('next-station').disabled = busy || !catalog;
  $('power').textContent = playing ? (audio.context.state === 'running' ? '■ Stop' : '▶ Resume') : '▶ Play';
  $('lamp').classList.toggle('lit', playing && audio?.context.state === 'running');
  syncNowPlaying();
  $('air-label').textContent = busy ? 'TUNING' : session?.buffering ? 'BUFFERING' : playbackError ? 'No signal' : playing ? (audio.context.state === 'running' ? (Number($('volume').value) === 0 ? 'MUTED' : 'ON AIR') : 'TAP RESUME') : 'STANDBY';
  sendStatus();
}
async function tune(target = station) {
  if (busy) return;
  playbackError = false;
  busy = true; $('power').disabled = true;
  for (const button of $('stations').children) button.disabled = true;
  $('status').textContent = 'Tuning your frequency…';
  sendStatus();
  try {
    // Music playback must use the media audio session on iPhone. WebAudio's
    // default ambient session follows the Ring/Silent switch even while running.
    try { if ('audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch {}
    audio = getAudio();
    const unlock = audio.unlock();
    const streamStart = target.stream ? startStream(target) : null;
    // Attach immediately so a media rejection during unlock is handled.
    streamStart?.catch(() => {});
    // Start a real tuning cue before any fetch/await loses the initiating gesture.
    audio.tone({ frequency: 440, endFrequency: 660, duration: 0.12, gain: 0.07 });
    await Promise.race([unlock, new Promise((_, reject) => setTimeout(() => reject(Error('Audio activation timed out')), 4000))]);
    if (audio.context.state !== 'running') throw Error('Audio output is interrupted');
    if (Number($('volume').value) === 0) { $('volume').value = 0.65; $('volume-value').value = 65; }
    audio.volume(Number($('volume').value));
    station = target; renderStation();
    if (streamStart) { await streamStart; playing = true; }
    else { await startStation(); }
    renderStation(); save();
    $('status').textContent = 'Sound on. Use Stop to tune out.';
    $('gate').hidden = true;
    $('power').focus({ preventScroll: true });
  } catch (error) {
    playbackError = true;
    console.error('Radio tuning failed', error);
    fadeOut(session); session = null; playing = false;
    $('gate').hidden = false;
    $('status').textContent = audio && audio.context.state !== 'running' ? 'Audio paused by your device. Tap below to resume sound.' : station?.stream ? 'Live signal unavailable. Press Play to retry, or choose a bundled station.' : 'Signal unavailable. Check your connection and press Play to retry.';
  } finally {
    busy = false; $('power').disabled = false;
    for (const button of $('stations').children) button.disabled = false;
    renderPower();
  }
}
installAudioUnlock(document, event => (playing || busy) && !event.target.closest('#power, #stations button'));
$('power').addEventListener('click', () => {
  if (!playing || audio.context.state !== 'running') { void tune(); return; }
  playing = false; fadeOut(session); session = null; renderPower();
});
$('volume').addEventListener('input', () => {
  const volume = Number($('volume').value);
  $('volume-value').value = Math.round(volume * 100); audio?.volume(volume);
  if (station) save();
});
$('clock').addEventListener('click', () => {
  if (station?.stream) return;
  remaining = !remaining;
  $('clock').setAttribute('aria-label', `Track ${remaining ? 'remaining' : 'elapsed'} time; click to toggle`);
});
function clearVisual() {
  pen.clearRect(0, 0, canvas.width, canvas.height);
  peaks.fill(0);
  visualPhase = 0;
}
function renderVisualMode() {
  $('visual-mode').value = visualMode;
  canvas.setAttribute('aria-label', visualMode === 'off' ? 'Visualization off' : `Live audio ${visualMode}`);
  $('visual-palette').textContent = `Color: ${paletteNames[paletteIndex]}`;
  $('visual-variation').textContent = `Style: ${variationNames[visualMode][variation]}`;
  $('visual-palette').disabled = $('visual-variation').disabled = visualMode === 'off';
  clearVisual();
  if (station) save();
}
$('visual-mode').addEventListener('change', () => {
  visualMode = $('visual-mode').value;
  renderVisualMode();
});
$('visual-palette').addEventListener('click', () => { paletteIndex = (paletteIndex + 1) % paletteNames.length; renderVisualMode(); });
$('visual-variation').addEventListener('click', () => { variation = (variation + 1) % 3; renderVisualMode(); });
$('visual-expand').addEventListener('click', () => {
  const expanded = document.querySelector('.visual-panel').classList.toggle('visual-large');
  $('visual-expand').textContent = expanded ? 'Shrink' : 'Expand';
  $('visual-expand').setAttribute('aria-expanded', expanded);
});
reducedMotion.addEventListener('change', event => { if (event.matches) { visualMode = 'off'; renderVisualMode(); } });
renderVisualMode();
function changeStation(direction) {
  if (!catalog || busy) return;
  const index = catalog.stations.indexOf(station);
  const target = catalog.stations[(index + direction + catalog.stations.length) % catalog.stations.length];
  if (target.band !== band) selectBand(target.band, { remember: false });
  if (playing) void tune(target);
  else { station = target; renderStation(); save(); }
}
$('previous-station').addEventListener('click', () => changeStation(-1));
$('next-station').addEventListener('click', () => changeStation(1));
$('shade').addEventListener('click', () => {
  const shaded = deck.classList.toggle('shaded');
  $('shade').setAttribute('aria-expanded', !shaded);
  $('shade').setAttribute('aria-label', shaded ? 'Expand player' : 'Collapse player');
  $('shade').textContent = shaded ? '+' : '−';
  ticker.measure();
});
document.addEventListener('pointerdown', event => {
  window.focus();
  if (!event.target.closest('button,input')) deck.focus({ preventScroll: true });
});
const heightObserver = new ResizeObserver(() => {
  canvas.width = Math.round(canvas.clientWidth * Math.min(devicePixelRatio, 2));
  canvas.height = Math.round(canvas.clientHeight * Math.min(devicePixelRatio, 2));
  ticker.measure();
  sendHeight();
  keepRowVisible($('tracks').querySelector('[aria-current=true]'));
});
heightObserver.observe(deck);
heightObserver.observe($('tracks'));
const tvOpen = () => Boolean(station && tvWanted && tv.has(station.id));
function renderTV() {
  const able = Boolean(station && tv.has(station.id)), open = tvOpen();
  $('tv-panel').hidden = !open;
  document.querySelector('.expanded').classList.toggle('tv-on', open);
  $('tv-open').hidden = !able || open;
  $('tv-channel').textContent = station?.name || '';
}
function setTV(open) {
  tvWanted = open;
  if (!open) { $('tv-panel').classList.remove('tv-large'); $('tv-big').textContent = 'Expand'; $('tv-big').setAttribute('aria-expanded', false); }
  renderTV(); if (station) save();
  (open ? $('tv-close') : $('tv-open')).focus({ preventScroll: true });
}
$('tv-open').addEventListener('click', () => setTV(true));
$('tv-close').addEventListener('click', () => setTV(false));
$('tv-cut').addEventListener('click', () => tv.next());
$('tv-big').addEventListener('click', () => {
  const large = $('tv-panel').classList.toggle('tv-large');
  $('tv-big').textContent = large ? 'Shrink' : 'Expand';
  $('tv-big').setAttribute('aria-expanded', large);
});
function drawTV(dt) {
  const audible = Boolean(audio && playing && !busy && audio.context.state === 'running' && !session?.buffering);
  if (audible) { audio.analyser.getByteFrequencyData(samples); audio.analyser.getByteTimeDomainData(waveform); }
  tv.draw(dt, { station, track: position().track, live: audible, samples, waveform, calm: reducedMotion.matches });
}
function visualColors() {
  return [
    [station?.color || '#b5ed88', '#f0f6cf', '#578447'],
    ['#6fdbff', '#d4f6ff', '#586fdd'],
    ['#ffab65', '#ffe5a1', '#d55355'],
    ['#cc9fff', '#ffc9ea', '#5d83d6'],
  ][paletteIndex];
}
function drawVisual(dt) {
  const w = canvas.width, h = canvas.height, pixel = Math.min(devicePixelRatio, 2);
  if (!w || !h) return;
  const audible = audio && playing && !busy && audio.context.state === 'running' && !session?.buffering;
  const enabled = visualMode !== 'off';
  $('visual-status').hidden = Boolean(audible && enabled);
  $('visual-status').textContent = !enabled ? 'Visualization off' : busy || session?.buffering ? 'Waiting for audio…' : playing ? 'Resume sound to see the visualization' : 'Press Play to see the sound';
  if (!audible || !enabled) {
    pen.clearRect(0, 0, w, h);
    return;
  }
  audio.analyser.getByteFrequencyData(samples);
  audio.analyser.getByteTimeDomainData(waveform);
  const rms = Math.sqrt(waveform.reduce((total, sample) => total + ((sample - 128) / 128) ** 2, 0) / waveform.length);
  const bass = samples.slice(0, 12).reduce((total, value) => total + value, 0) / (12 * 255);
  const energy = samples.reduce((total, value) => total + value, 0) / (samples.length * 255);
  // Phase advances with measured energy, not an independent animation timer.
  visualPhase += dt * energy * 0.65;
  const [primary, highlight, secondary] = visualColors();
  const trail = visualMode === 'orbit' || visualMode === 'silk';
  if (visualMode !== 'waterfall') {
    pen.fillStyle = trail ? 'rgba(8,13,10,0.2)' : '#080d0a';
    pen.fillRect(0, 0, w, h);
  }
  pen.lineJoin = 'round'; pen.lineCap = 'round';
  pen.lineWidth = pixel; pen.strokeStyle = primary; pen.fillStyle = primary;
  if (visualMode === 'spectrum') {
    const count = variation === 1 ? 64 : 40, step = w / count;
    const mirrored = variation === 2;
    const gradient = pen.createLinearGradient(0, h, 0, 0);
    gradient.addColorStop(0, secondary); gradient.addColorStop(0.65, primary); gradient.addColorStop(1, highlight);
    pen.fillStyle = gradient;
    for (let i = 0; i < count; i++) {
      const level = samples[Math.floor(i * 96 / count)] / 255 * (h - 5 * pixel) * (mirrored ? 0.5 : 1);
      peaks[i] = Math.max(level, peaks[i] - h * dt * 0.45);
      pen.fillRect(i * step, mirrored ? h / 2 - level : h - level, Math.max(pixel, step - 2 * pixel), level * (mirrored ? 2 : 1));
    }
    pen.fillStyle = '#080d0a';
    for (let y = 0; y < h; y += 5 * pixel) pen.fillRect(0, y, w, pixel);
    pen.fillStyle = highlight;
    for (let i = 0; i < count; i++) pen.fillRect(i * step, (mirrored ? h / 2 : h) - peaks[i] - 2 * pixel, Math.max(pixel, step - 2 * pixel), pixel);
  } else if (visualMode === 'scope') {
    const layers = variation === 1 ? 3 : 1;
    for (let layer = 0; layer < layers; layer++) {
      const mid = h * (layer + 1) / (layers + 1);
      pen.strokeStyle = [primary, highlight, secondary][layer];
      pen.beginPath();
      waveform.forEach((value, i) => {
        const x = i * w / (waveform.length - 1), y = mid + (value - 128) / 128 * h * (layers > 1 ? 0.22 : 0.42);
        i ? pen.lineTo(x, y) : pen.moveTo(x, y);
      });
      if (variation === 2) { pen.lineTo(w, h / 2); pen.lineTo(0, h / 2); pen.closePath(); pen.globalAlpha = 0.25; pen.fill(); pen.globalAlpha = 1; }
      pen.stroke();
    }
  } else if (visualMode === 'orbit') {
    const cx = w / 2, cy = h / 2, radius = Math.min(w, h) * (0.18 + Math.min(rms, 0.5) * 0.25);
    const loops = variation === 0 ? 2 : variation === 1 ? 4 : 3;
    for (let loop = 0; loop < loops; loop++) {
      pen.strokeStyle = [primary, highlight, secondary][loop % 3];
      pen.globalAlpha = 0.85 - loop * 0.12; pen.beginPath();
      const points = variation === 2 ? 48 : 192;
      for (let i = 0; i <= points; i++) {
        const angle = i / points * Math.PI * 2;
        const circularPosition = (1 - Math.cos(angle)) / 2;
        const frequency = samples[Math.floor(circularPosition * 95)] / 255;
        const wave = (waveform[Math.floor(circularPosition * 255)] - 128) / 128;
        const petals = variation === 1 ? Math.sin(angle * 5 + visualPhase) * bass * radius * 0.24 : 0;
        const r = radius * (1 + loop * 0.18) + frequency * radius * 0.5 + wave * radius * 0.25 + petals;
        const theta = angle + visualPhase * (loop % 2 ? -1 : 1);
        const x = cx + Math.cos(theta) * r, y = cy + Math.sin(theta) * r;
        i ? pen.lineTo(x, y) : pen.moveTo(x, y);
      }
      pen.closePath(); pen.stroke();
    }
    pen.globalAlpha = 1;
  } else if (visualMode === 'silk') {
    const layers = variation === 0 ? 4 : 7;
    for (let layer = 0; layer < layers; layer++) {
      const phase = visualPhase + layer * 0.55;
      pen.strokeStyle = [primary, secondary, highlight][layer % 3];
      pen.globalAlpha = 0.35 + energy * 0.6; pen.beginPath();
      waveform.forEach((value, i) => {
        const position = i / (waveform.length - 1), x = position * w;
        const envelope = Math.sin(position * Math.PI);
        const bend = Math.sin(position * Math.PI * (variation === 1 ? 4 : 2) + phase) * bass * h * 0.22;
        const sample = (value - 128) / 128;
        const offset = variation === 2 ? (layer % 2 ? -1 : 1) : 1;
        const y = h / 2 + offset * (sample * h * 0.32 + bend + Math.sin(phase) * rms * h * 0.2) * envelope;
        i ? pen.lineTo(x, y) : pen.moveTo(x, y);
      });
      pen.stroke();
    }
    pen.globalAlpha = 1;
  } else if (visualMode === 'waterfall') {
    // Frequency history: newest real FFT row enters at the bottom.
    const rowHeight = Math.max(1, Math.round(pixel * 2));
    pen.drawImage(canvas, 0, -rowHeight);
    pen.fillStyle = '#080d0a'; pen.fillRect(0, h - rowHeight, w, rowHeight);
    const count = 96, step = w / count;
    for (let i = 0; i < count; i++) {
      const bin = variation === 1 ? Math.floor(Math.abs(i - count / 2) * 2) : i;
      const value = samples[bin] / 255;
      if (variation === 2 && value < 0.4) continue;
      pen.fillStyle = value > 0.72 ? highlight : value > 0.4 ? primary : secondary;
      pen.globalAlpha = value ** 1.5;
      pen.fillRect(i * step, h - rowHeight, Math.ceil(step), rowHeight);
    }
    pen.globalAlpha = 1;
  }
}
function frame(timestamp) {
  const dt = Math.min((timestamp - previousFrame) / 1000, 0.1); previousFrame = timestamp;
  if (station) {
    const state = position();
    const title = `${state.track.artist.toUpperCase()} — ${state.track.title.toUpperCase()}${station.stream ? '' : ` (${time(state.track.duration)})`}`;
    const format = station.stream ? station : state.track;
    $('format').textContent = `${format.bitrate} KBPS · ${format.sampleRate / 1000} KHZ · ${format.channels === 1 ? 'MONO' : 'STEREO'}`;
    if (title !== lastTitle) { ticker.setText(title); $('ticker').setAttribute('aria-label', title); lastTitle = title; }
    $('clock').textContent = station.stream ? 'LIVE' : `${remaining ? '−' : ''}${time(remaining ? state.remaining : state.offset)}`;
    const progress = station.stream ? 0 : Math.floor(state.offset / state.track.duration * 100);
    $('track-progress').style.width = `${progress}%`;
    $('track-progress').parentElement.hidden = Boolean(station.stream);
    $('track-progress').parentElement.setAttribute('aria-valuenow', progress);
    const spotify = state.track.spotify || '';
    if ($('spotify').getAttribute('href') !== (spotify || null)) {
      if (spotify) {
        $('spotify').href = spotify;
        $('spotify').textContent = state.track.shared ? '♫ Open in Spotify ↗' : '♫ Find on Spotify ↗';
        $('spotify').setAttribute('aria-label', `${state.track.shared ? 'Open' : 'Find'} ${state.track.artist} — ${state.track.title} in Spotify (opens a new tab)`);
      } else $('spotify').removeAttribute('href');
      $('spotify').hidden = !spotify;
      renderHeart();
    }
    const playlist = station.stream ? playlistUrl : '';
    if ($('playlist').getAttribute('href') !== (playlist || null)) {
      if (playlist) $('playlist').href = playlist; else $('playlist').removeAttribute('href');
      $('playlist').hidden = !playlist;
    }
    if (station.stream) {
      const name = $('tracks').querySelector('.track-name'), text = state.track.placeholder ? 'Live broadcast' : `${state.track.artist} — ${state.track.title}`;
      if (name && name.textContent !== text) name.textContent = text;
    }
    for (const row of $('tracks').children) {
      const current = !station.stream && Number(row.dataset.index) === state.index;
      if (current && row.getAttribute('aria-current') !== 'true') keepRowVisible(row);
      row.setAttribute('aria-current', current ? 'true' : 'false');
    }
  }
  if (!reducedMotion.matches) ticker.update(dt);
  ticker.render();
  // A bounded 30fps display; every shape is driven by the actual analyser.
  if (timestamp - lastVisualFrame >= 1000 / 30) {
    const visualDt = Math.min((timestamp - lastVisualFrame) / 1000, 0.1);
    lastVisualFrame = timestamp;
    if (tvOpen()) drawTV(visualDt); else drawVisual(visualDt);
  }
  requestAnimationFrame(frame);
}
setInterval(() => { pump(); renderPower(); }, 200);
requestAnimationFrame(frame);
try {
  const response = await fetch('./stations.json');
  if (!response.ok) throw Error(`Station directory: ${response.status}`);
  catalog = await response.json();
  const requestedStation = new URLSearchParams(location.search).get('station');
  const linked = catalog.stations.find(s => s.id === requestedStation);
  station = linked || catalog.stations.find(s => s.id === saved.station) || catalog.stations[0];
  // A ?station= link opens the tab holding that station.
  if (linked && Object.hasOwn(bands, linked.band)) band = linked.band;
  for (const preset of catalog.stations) {
    const button = document.createElement('button'); button.dataset.id = preset.id; button.dataset.band = preset.band || 'radio';
    const number = document.createElement('span'); number.textContent = preset.frequency;
    button.append(number, document.createTextNode(preset.name)); button.title = preset.genre;
    button.addEventListener('click', () => {
      if (preset === station) return;
      if (playing) void tune(preset);
      else { station = preset; renderStation(); save(); }
    });
    $('stations').append(button);
  }
  renderBand(); renderStation(); $('power').disabled = false;
  // A host may request playback right after a user gesture on its own page
  // (the desktop's Unmute button). If the browser refuses activation, tune()
  // leaves the receiver in standby with the normal Play control.
  if (new URLSearchParams(location.search).get('autoplay') === '1' && !playing) void tune();
  renderPower();
  $('status').textContent = 'Press Play to start listening. No account needed.';
} catch (error) {
  playbackError = true; sendStatus();
  console.error(error); $('status').textContent = 'Station directory unavailable. Reload to reconnect.';
}

installWindowShortcuts();
