'use strict';
// HIFI TV on an Echo Show that runs APL and plays video: every station start puts up a new
// screen with that station's clips and its stream inside, keeps the session open so "next",
// "pause" and "stop" come back, and never mixes in AudioPlayer. A stream the screen can't play
// goes to AudioPlayer; "audio only" turns the screen off. Run: node --test alexa/lambda/*.test.js
const test = require('node:test');
const assert = require('node:assert');

globalThis.fetch = async () => { throw new Error('offline in tests'); }; // the bundled catalog
const { skill } = require('./index');
const tv = require('./tv');
const stations = require('./catalog').bundled();

const APL_SHOW = {
  Viewport: { shape: 'RECTANGLE', pixelWidth: 1280, pixelHeight: 800, dpi: 160, video: { codecs: ['H_264_42', 'H_264_41'] } },
};
let n = 0;
function echoShow(name) {
  const user = `amzn1.ask.account.tv-${name}-${process.pid}`;
  let screen = null;                         // the APL token on screen, as the device reports it
  let player = { playerActivity: 'IDLE' };
  async function send(request) {
    const envelope = {
      version: '1.0',
      session: { new: false, sessionId: `s-${name}`, application: { applicationId: 'a' }, user: { userId: user } },
      context: {
        System: {
          application: { applicationId: 'a' }, user: { userId: user },
          device: { deviceId: 'd', supportedInterfaces: { AudioPlayer: {}, 'Alexa.Presentation.APL': { runtime: { maxVersion: '2023.3' } } } },
        },
        AudioPlayer: player,
        ...(screen ? { 'Alexa.Presentation.APL': { token: screen, version: 'APL_WEB_RENDERER_GANDALF', componentsVisibleOnScreen: [] } } : {}),
        ...APL_SHOW,
      },
      request: { requestId: `r${n++}`, timestamp: new Date().toISOString(), locale: 'en-US', ...request },
    };
    const { response } = await skill.invoke(envelope);
    const directives = response.directives || [];
    const render = directives.find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
    const play = directives.find(d => d.type === 'AudioPlayer.Play');
    if (render) screen = render.token;
    if (play) { player = { playerActivity: 'PLAYING', token: play.audioItem.stream.token }; screen = null; }
    if (response.shouldEndSession === true) screen = null;
    return { response, directives, render, play };
  }
  return {
    send,
    intent: (intentName, slots = {}) => send({ type: 'IntentRequest', intent: { name: intentName, confirmationStatus: 'NONE', slots } }),
    event: args => send({ type: 'Alexa.Presentation.APL.UserEvent', token: screen, arguments: args, source: {}, components: {} }),
    get screen() { return screen; },
  };
}

const at = id => stations.findIndex(s => s.id === id);
const neighbour = (id, step) => stations[(at(id) + step + stations.length) % stations.length].id;

function checkScreen({ response, render, play }, id, seen) {
  assert.ok(render, `a screen for ${id}`);
  assert.ok(!play, 'no AudioPlayer in the same response (Alexa refuses the two together)');
  assert.ok(!('shouldEndSession' in response), 'the session stays open, microphone closed');
  assert.ok(!response.card, 'no card');
  assert.match(render.token, new RegExp(`^hifi-tv:${id}:`));
  assert.ok(!seen.has(render.token), 'a new screen every time');
  seen.add(render.token);
  const station = stations.find(s => s.id === id);
  const data = render.datasources.tv;
  assert.strictEqual(data.id, id);
  assert.strictEqual(data.name, station.name);
  assert.ok(data.clips.length >= station.tv.length && data.clips.every(c => station.tv.includes(c.url)), 'only this station\'s clips');
  assert.ok(new Set(data.clips.map(c => c.url)).size === station.tv.length, 'all four clips take turns');
  assert.strictEqual(data.clips.at(-1).repeatCount, -1, 'the last clip loops, so the screen never goes black');
  if (station.stream) assert.deepStrictEqual(data.audio, [{ url: station.stream, repeatCount: -1 }]);
  else assert.ok(data.audio.every(a => station.tracks.some(t => t.src === a.url)) && data.tracks.length === station.tracks.length);
  assert.ok(JSON.stringify(render).length < 24000, 'the directive stays small');
}

test('every station has its clips', () => {
  for (const s of stations) assert.strictEqual(s.tv.length, 4, s.id);
});

test('the document: the clip silent, the sound on the background channel, its expressions closed', () => {
  const doc = tv.document();
  const json = JSON.stringify(doc);
  const videos = [];
  (function walk(node) {
    if (Array.isArray(node)) return node.forEach(walk);
    if (node && typeof node === 'object') { if (node.type === 'Video') videos.push(node); Object.values(node).forEach(walk); }
  })(doc);
  assert.deepStrictEqual(videos.map(v => [v.id, v.audioTrack, v.autoplay]), [['hifi-audio', 'background', true], ['hifi-clip', 'none', true]]);
  for (const expr of json.match(/\$\{[^}]*\}?/g)) assert.ok(expr.endsWith('}'), expr);
  assert.strictEqual(doc.version, '2022.2');
});

test('Echo Show: open, next and previous many times, by name, each a new screen with that station', async () => {
  const echo = echoShow('switch');
  const seen = new Set();
  let r = await echo.send({ type: 'LaunchRequest' });
  const first = r.render.datasources.tv.id;
  checkScreen(r, first, seen);
  assert.match(r.response.outputSpeech.ssml, /Now listening to live radio on HIFI/);
  let here = first;
  for (const [intentName, step] of [['AMAZON.NextIntent', 1], ['AMAZON.NextIntent', 1], ['NextStationIntent', 1], ['AMAZON.PreviousIntent', -1],
    ['PreviousStationIntent', -1], ['AMAZON.PreviousIntent', -1], ['AMAZON.PreviousIntent', -1]]) {
    r = await echo.intent(intentName); here = neighbour(here, step);
    checkScreen(r, here, seen);
  }
  r = await echo.intent('PlayStationIntent', { station: { name: 'station', value: 'jazz twenty four', confirmationStatus: 'NONE' } });
  checkScreen(r, 'jazz24', seen);
  r = await echo.intent('PlayStationIntent', { station: { name: 'station', value: 'dial up', confirmationStatus: 'NONE' } });
  checkScreen(r, 'dial-up', seen);
  // The screen's own arrows (dial-hint.js) move along the dial too, without speech.
  let dialEvent;
  try { dialEvent = require('./dial-hint').EVENT; } catch { /* not there */ }
  if (dialEvent) {
    r = await echo.event([dialEvent, 'next']);
    checkScreen(r, neighbour('dial-up', 1), seen);
    assert.ok(!r.response.outputSpeech);
  }
});

test('Echo Show: pause and resume hold the screen; what\'s playing answers without closing it; stop closes it', async () => {
  const echo = echoShow('controls');
  await echo.intent('PlayStationIntent', { station: { name: 'station', value: 'pixel drift', confirmationStatus: 'NONE' } });
  const token = echo.screen;
  let r = await echo.intent('AMAZON.PauseIntent');
  const pause = r.directives.find(d => d.type === 'Alexa.Presentation.APL.ExecuteCommands');
  assert.ok(pause && pause.token === token && pause.commands.every(c => c.type === 'ControlMedia' && c.command === 'pause'));
  assert.ok(!r.directives.some(d => d.type.startsWith('AudioPlayer.')) && !('shouldEndSession' in r.response));
  r = await echo.intent('AMAZON.ResumeIntent');
  const play = r.directives.find(d => d.type === 'Alexa.Presentation.APL.ExecuteCommands');
  assert.ok(play && play.commands.every(c => c.command === 'play'), 'a track station picks up where it paused');
  await echo.event(['hifi-tv', 'tick', 'pixel-drift', false, 2]);
  r = await echo.intent('WhatsPlayingIntent');
  assert.match(r.response.outputSpeech.ssml, /This is .+ by .+, on pixel drift/);
  assert.ok(!('shouldEndSession' in r.response) && !r.response.reprompt);
  r = await echo.intent('ListStationsIntent');
  assert.ok(!r.response.reprompt, 'no question that would close the screen when unanswered');
  r = await echo.intent('AMAZON.StopIntent');
  assert.strictEqual(r.response.shouldEndSession, true);
  assert.match(r.response.outputSpeech.ssml, /Bye/);
});

test('Echo Show: a stream the screen can\'t play goes to AudioPlayer; audio only and back', async () => {
  const echo = echoShow('fallback');
  await echo.intent('PlayStationIntent', { station: { name: 'station', value: 'jazz twenty four', confirmationStatus: 'NONE' } });
  let r = await echo.event(['hifi-tv', 'tick', 'jazz24', false, 0]);
  assert.ok(!r.play && !r.render, 'a tick from a playing screen changes nothing');
  r = await echo.event(['hifi-tv', 'tick', 'jazz24', true, 0]);
  assert.ok(r.play && /^live:jazz24#/.test(r.play.audioItem.stream.token) && !r.render, 'failed: AudioPlayer takes over');
  r = await echo.intent('VideoOffIntent');
  assert.ok(r.play && !r.render, 'audio only plays through AudioPlayer');
  r = await echo.intent('AMAZON.NextIntent');
  assert.ok(r.play && !r.render, 'and stays that way');
  r = await echo.intent('VideoOnIntent');
  assert.ok(r.render && !r.play, 'show the video brings HIFI TV back');
});
