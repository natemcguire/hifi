'use strict';
// HIFI TV on the Echo Show: the station's clips fill the screen while the station plays, as in
// the app's full-screen TV. The clip loops muted; the song, the artist and the station sit in the
// lower left, "HIFI TV" in the corner, the dial strip (dial-hint.js) along the bottom.
//
// Alexa won't put a skill's own screen (APL) over its AudioPlayer: a response can't carry
// RenderDocument and AudioPlayer.Play together, and while AudioPlayer plays the Echo Show shows
// its own Now Playing screen, a still picture. So on a screen that can play video the station
// plays inside the APL document instead: one Video component for the clip (no sound) and a
// second, one pixel big, for the stream or the tracks on Alexa's background music channel. The
// session stays open with the microphone closed, so "Alexa, next", "pause" and "stop" come back
// to the skill. If the stream won't play there, the skill hands it to AudioPlayer (fallback()).
// Echo devices without a screen never see any of this.

const about = require('./about');
let dial = null;
try { dial = require('./dial-hint'); } catch { /* the dial strip is optional */ }

const EVENT = 'hifi-tv';
const MIN_APL = '2022.2';           // onTrackFail, named sequencers, SetValue on bound values
const CLIP_PLAYS = 6;               // a 5.5-second clip shown six times: a new clip every ~30 s, like the app
const TICK_MS = 30000;              // how often the screen asks for the song

const newer = (a, b) => {           // '2023.1' >= '2022.2'
  const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return true;
};

// A screen that runs APL new enough and says it can play video. The listener can switch it off
// ("Alexa, ask HIFI radio for audio only"), which keeps the plain Now Playing screen.
function canShow(envelope) {
  const apl = envelope.context?.System?.device?.supportedInterfaces?.['Alexa.Presentation.APL'];
  const codecs = envelope.context?.Viewport?.video?.codecs;
  return Boolean(apl) && newer(apl.runtime?.maxVersion || '1.0', MIN_APL) && Array.isArray(codecs) && codecs.length > 0;
}
const on = (envelope, state = {}) => state.video !== false && canShow(envelope);

// The token of what is on screen: "hifi-tv:jazz24:lq3k9a" (station, then a part that only makes it new).
let shows = 0;
const tokenFor = station => `${EVENT}:${station.id}:${Date.now().toString(36)}${(shows++ % 1296).toString(36)}`;
function showing(envelope) {
  const token = envelope.context?.['Alexa.Presentation.APL']?.token || '';
  const m = /^hifi-tv:([a-z0-9-]+):/.exec(token);
  return m ? { id: m[1], token } : null;
}

// The clip the app would show for this station now (app.js tvClip), then the others in turn.
function clipOrder(station) {
  let hash = 0;
  for (const char of station.id) hash = (hash * 31 + char.codePointAt(0)) >>> 0;
  const start = (Math.floor(Date.now() / 30000) + hash) % station.tv.length;
  return [...station.tv.slice(start), ...station.tv.slice(0, start)];
}
// A list long enough for an evening; the last item repeats for good so the screen never goes black.
function loop(items, total) {
  const out = [];
  while (out.length < total) out.push(...items);
  out.length = Math.max(total, items.length);
  out[out.length - 1] = { ...out[out.length - 1], repeatCount: -1 };
  return out;
}

const tick = { type: 'SendEvent', arguments: [EVENT, 'tick', '${tv.id}', '${failed}', '${track}'] };
const media = (id, command) => ({ type: 'ControlMedia', componentId: id, command });

// Type sizes in dp from Amazon's Alexa type ramp, by how far away the screen is read: an Echo
// Show 5 on a nightstand (Display 6, Body, Metadata), an Echo Show 8 or 10 or an Echo Hub across
// a kitchen (Display 5), an Echo Show 15 or 21 on a wall (Display 4), Fire TV across a room. A
// later block wins where its "when" holds. Nothing is smaller than 24 dp, Amazon's smallest.
const SIZES = [
  { dimensions: { songSize: 48, artistSize: 36, placeSize: 28, cornerSize: 32 } },
  { when: "${viewport.height < 600 || viewport.shape == 'round'}", dimensions: { songSize: 40, artistSize: 32, placeSize: 24, cornerSize: 28 } },
  { when: "${viewport.width >= 1920 || viewport.height >= 1920}", dimensions: { songSize: 74, artistSize: 48, placeSize: 40, cornerSize: 48 } },
  { when: "${viewport.mode == 'tv'}", dimensions: { songSize: 48, artistSize: 36, placeSize: 32, cornerSize: 32 } },
];
const ROUND = "viewport.shape == 'round'";
const STILL = 'Math.min(viewport.width * 0.36, viewport.height * 0.5)';   // the cover's side, in dp
// What a pause says: a touch screen can be tapped, a TV has a remote, every one hears "resume".
const PAUSED = "${viewport.mode == 'tv' ? 'Paused. Say “Alexa, resume.”' : 'Paused. Tap to play, or say “Alexa, resume.”'}";

function document() {
  // The words sit above the dial strip (dial-hint.js), and on a round screen in the middle,
  // inside the circle.
  const above = dial ? `\${${dial.HEIGHT.slice(2, -1)} + viewport.height * (${ROUND} ? 0.13 : 0.03)}` : '6vh';
  const words = {
    type: 'Container', position: 'absolute', bottom: above,
    left: `\${${ROUND} ? '14vw' : '4vw'}`, right: `\${${ROUND} ? '14vw' : '22vw'}`,
    alignItems: `\${${ROUND} ? 'center' : 'start'}`,
    items: [
      // Until the sound starts: "HIFI Live Radio", "Starting up stream". Then a track station
      // names its track; a live station the song the skill last heard of, or its genre.
      { type: 'Text', id: 'hifi-song', text: "${!started ? 'HIFI Live Radio' : tv.tracks.length > 0 ? tv.tracks[track % tv.tracks.length].title : (song != '' ? song : tv.genre)}", fontSize: '@songSize', fontWeight: 'bold', color: '#FFFFFF', maxLines: 1 },
      { type: 'Text', id: 'hifi-artist', text: "${!started ? 'Starting up stream' : tv.tracks.length > 0 ? tv.tracks[track % tv.tracks.length].artist : singer}", fontSize: '@artistSize', fontWeight: '600', color: '#FFFFFF', opacity: 0.9, maxLines: 1,
        display: "${started && tv.tracks.length == 0 && singer == '' ? 'none' : 'normal'}" },   // no empty line under a live station's genre
      // The station and where it's from, small: "Jazz24 · Seattle" (about.js).
      { type: 'Text', text: '${tv.place}', fontSize: '@placeSize', fontWeight: 'bold', color: '${tv.color}', maxLines: 1, paddingTop: '0.6vh' },
    ],
  };
  return {
    type: 'APL', version: MIN_APL, theme: 'dark', resources: SIZES,
    ...(dial ? { graphics: dial.graphics } : {}),
    mainTemplate: {
      parameters: ['tv'],
      item: {
        type: 'Container', id: 'hifi-tv', width: '100vw', height: '100vh',
        bind: [
          { name: 'paused', value: false }, { name: 'failed', value: false }, { name: 'track', value: 0 }, { name: 'started', value: false },
          { name: 'song', value: '${tv.song}' }, { name: 'singer', value: '${tv.artist}' },
          { name: 'clip', value: false },   // the clip is playing; until then the still shows
        ],
        // The song comes from the skill every half minute; the first ask, after 8 seconds, also
        // tells the skill whether the stream played. Here, not on the document, so the ask sees
        // the values bound above; on a named sequencer, so touches and voice commands don't stop it.
        // screenLock holds the screen up while the ticks run (about eight hours). Before APL
        // 2024.2 some Echo devices time a document out while its videos play on the background
        // channel or muted, which would close the screen and stop the station with it.
        onMount: [{
          type: 'Sequential', sequencer: 'hifi-tick', screenLock: true,
          commands: [{ type: 'Idle', delay: 8000 }, tick, { type: 'Sequential', repeatCount: 1000, commands: [{ type: 'Idle', delay: TICK_MS }, tick] }],
        }],
        items: [
          // The sound: the stream (or the tracks in turn), out of sight under the clip.
          {
            type: 'Video', id: 'hifi-audio', position: 'absolute', top: 0, left: 0, width: 1, height: 1,
            source: '${tv.audio}', autoplay: true, audioTrack: 'background', screenLock: true, scale: 'best-fit',
            onPlay: [
              { type: 'SetValue', componentId: 'hifi-tv', property: 'paused', value: false },
              { type: 'SetValue', componentId: 'hifi-tv', property: 'started', value: true },
            ],
            onPause: [{ type: 'SetValue', componentId: 'hifi-tv', property: 'paused', value: true }],
            onTrackUpdate: [{ type: 'SetValue', componentId: 'hifi-tv', property: 'track', value: '${event.trackIndex}' }],
            onTrackFail: [{ type: 'SetValue', componentId: 'hifi-tv', property: 'failed', value: true }],
          },
          // Under the clip, the station's still: its cover blurred across the screen and sharp in
          // the middle. It is what shows while a clip loads, between clips, and for good if a clip
          // won't play, so the screen is never black while the station plays.
          { type: 'Frame', position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: '#14181C' },
          {
            type: 'Image', position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
            source: '${tv.still}', scale: 'best-fill', filters: [{ type: 'Blur', radius: 40 }],
          },
          { type: 'Frame', position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.35)' },
          // The sharp cover in the middle, cut off above the arrows strip drawn into its lower
          // part (make-covers.py: the strip starts 23/32 of the way down), so the screen shows one
          // strip, the real one with buttons, and the cover clears the words on every screen. Not
          // on a round screen, where the words take the middle.
          {
            type: 'Frame', position: 'absolute', top: '11vh', left: `\${(viewport.width - ${STILL}) / 2}`,
            width: `\${${STILL}}`, height: `\${${STILL} * 23 / 32}`,
            display: "${clip || viewport.shape == 'round' ? 'invisible' : 'normal'}",
            item: { type: 'Image', width: `\${${STILL}}`, height: `\${${STILL}}`, source: '${tv.still}', scale: 'fill' },
          },
          // The picture: the clip, full screen and silent, shown once it plays. A tap pauses both,
          // another plays them.
          {
            type: 'TouchWrapper', position: 'absolute', top: 0, left: 0, width: '100vw', height: '100vh',
            accessibilityLabel: 'Pause or play', role: 'button',
            onPress: [
              media('hifi-clip', "${paused ? 'play' : 'pause'}"),
              media('hifi-audio', "${paused ? 'play' : 'pause'}"),
            ],
            item: {
              type: 'Video', id: 'hifi-clip', width: '100vw', height: '100vh', scale: 'best-fill',
              source: '${tv.clips}', autoplay: true, audioTrack: 'none', screenLock: true, opacity: '${clip ? 1 : 0}',
              onPlay: [{ type: 'SetValue', componentId: 'hifi-tv', property: 'clip', value: true }],
              onTrackFail: [{ type: 'SetValue', componentId: 'hifi-tv', property: 'clip', value: false }],
            },
          },
          // A dark fade under the words, the way the app's lower third sits on glass.
          {
            type: 'Frame', position: 'absolute', left: 0, right: 0, bottom: 0, height: '55vh',
            background: { type: 'linear', colorRange: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.72)'], inputRange: [0, 1], angle: 180 },
          },
          {
            type: 'Text', text: 'HIFI TV', position: 'absolute', top: `\${${ROUND} ? '12vh' : '4vh'}`,
            left: '4vw', right: '4vw', textAlign: `\${${ROUND} ? 'center' : 'right'}`,
            fontSize: '@cornerSize', fontWeight: '900', fontStyle: 'italic', color: '#FFFFFF',
          },
          {
            type: 'Text', text: PAUSED, position: 'absolute', top: `\${${ROUND} ? '22vh' : '4vh'}`,
            left: `\${${ROUND} ? '14vw' : '4vw'}`, right: `\${${ROUND} ? '14vw' : '24vw'}`, textAlign: `\${${ROUND} ? 'center' : 'left'}`, maxLines: 2,
            fontSize: '@cornerSize', fontWeight: 'bold', color: '#FFFFFF', display: "${paused ? 'normal' : 'invisible'}",
          },
          words,
          ...(dial ? [dial.layer()] : []),
        ],
      },
    },
  };
}

// The directive that puts a station on screen and plays it. `index` is the first track of a
// track station; `now` the song a live station is playing, if it says.
function render(responseBuilder, station, { index = 0, now = null } = {}) {
  const tracks = station.tracks.length
    ? [...station.tracks.slice(index % station.tracks.length), ...station.tracks.slice(0, index % station.tracks.length)]
    : [];
  const audio = station.stream
    ? [{ url: station.stream, repeatCount: -1 }]      // a dropped stream starts again
    : loop(tracks.map(t => ({ url: t.src })), tracks.length * 12);
  const clips = station.tv.length ? loop(clipOrder(station).map(url => ({ url, repeatCount: CLIP_PLAYS - 1 })), station.tv.length * 15) : [];
  const token = tokenFor(station);
  responseBuilder.addDirective({
    type: 'Alexa.Presentation.APL.RenderDocument', token, document: document(),
    datasources: {
      tv: {
        id: station.id, name: station.name, place: about.line(station), genre: station.genre, color: station.color,
        still: station.cover, song: now?.title || '', artist: now?.artist || '',
        tracks: tracks.map(t => ({ title: t.title, artist: t.artist })), audio, clips,
      },
    },
  });
  return token;
}

// What the screen sent: { kind: 'tick', id, failed, track } or null when it isn't ours.
function event(request) {
  const args = request?.type === 'Alexa.Presentation.APL.UserEvent' ? request.arguments || [] : [];
  if (args[0] !== EVENT) return null;
  return { kind: args[1], id: String(args[2] || ''), failed: args[3] === true || args[3] === 'true', track: Number(args[4]) || 0 };
}

// Commands to the document on screen.
const commands = (token, list) => ({ type: 'Alexa.Presentation.APL.ExecuteCommands', token, commands: list });
const pause = token => commands(token, [media('hifi-clip', 'pause'), media('hifi-audio', 'pause')]);
const resume = token => commands(token, [media('hifi-clip', 'play'), media('hifi-audio', 'play')]);
const song = (token, now) => commands(token, [
  { type: 'SetValue', componentId: 'hifi-tv', property: 'song', value: now?.title || '' },
  { type: 'SetValue', componentId: 'hifi-tv', property: 'singer', value: now?.artist || '' },
]);

module.exports = { EVENT, canShow, on, showing, render, event, pause, resume, song, document, clipOrder };
