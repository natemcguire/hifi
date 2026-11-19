'use strict';
// Switching stations on an Echo Show: next, previous and a station by name, by voice and by the
// screen's buttons, many times in both directions. Every switch has to hand the player the new
// station with a token it has never seen (so the screen can't bring back cached art), and a
// voice switch has to end the session without a card, so the player's Now Playing screen is what
// shows. Run: node --test alexa/lambda/*.test.js
const test = require('node:test');
const assert = require('node:assert');

globalThis.fetch = async () => { throw new Error('offline in tests'); }; // the bundled catalog
const { skill } = require('./index');
const stations = require('./catalog').bundled();

const SHOW = { Viewport: { shape: 'RECTANGLE', pixelWidth: 1280, pixelHeight: 800, dpi: 160 } };
let n = 0;
function device(screen) {
  const user = `amzn1.ask.account.switch-${screen ? 'show' : 'dot'}-${process.pid}`;
  let player = { playerActivity: 'IDLE' };  // what the device reports back, like a real Echo
  async function send(request, sessionNew = true) {
    const envelope = {
      version: '1.0',
      session: { new: sessionNew, sessionId: `s${n}`, application: { applicationId: 'a' }, user: { userId: user } },
      context: {
        System: { application: { applicationId: 'a' }, user: { userId: user }, device: { deviceId: 'd', supportedInterfaces: { AudioPlayer: {} } } },
        AudioPlayer: player,
        ...(screen ? SHOW : {}),
      },
      request: { requestId: `r${n++}`, timestamp: new Date().toISOString(), locale: 'en-US', ...request },
    };
    if (request.type.startsWith('PlaybackController.')) delete envelope.session;
    const { response } = await skill.invoke(envelope);
    const play = (response.directives || []).find(d => d.type === 'AudioPlayer.Play');
    if (play) player = { playerActivity: 'PLAYING', token: play.audioItem.stream.token, offsetInMilliseconds: 0 };
    return { response, play };
  }
  return { send, intent: (name, slots = {}) => send({ type: 'IntentRequest', intent: { name, confirmationStatus: 'NONE', slots } }) };
}

const idOf = token => /^(?:live|track):([a-z0-9-]+)/.exec(token)[1];
const at = id => stations.findIndex(s => s.id === id);
const neighbour = (id, step) => stations[(at(id) + step + stations.length) % stations.length].id;

function checkSwitch({ response, play }, expected, { voice, screen }, seen) {
  assert.ok(play, `a Play directive for ${expected}`);
  assert.strictEqual(play.playBehavior, 'REPLACE_ALL');
  const { token } = play.audioItem.stream;
  assert.strictEqual(idOf(token), expected, 'the player gets the station asked for');
  assert.ok(!seen.has(token), `a new token every switch, not ${token} again`);
  seen.add(token);
  const station = stations.find(s => s.id === expected);
  const { metadata } = play.audioItem;
  if (station.stream) assert.strictEqual(metadata.title, station.name, 'the screen shows the new station');
  else assert.match(metadata.subtitle, new RegExp(`${station.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`));
  assert.ok(metadata.art.sources[0].url.includes(`/${expected}.png`), 'the new station\'s art');
  if (voice) {
    assert.strictEqual(response.shouldEndSession, true, 'a voice switch ends the session, so Now Playing shows');
    assert.strictEqual(Boolean(response.card), !screen, screen ? 'no card over the Echo Show player' : 'speakers keep the app card');
  } else {
    assert.ok(!('shouldEndSession' in response) && !response.card && !response.outputSpeech, 'button presses carry only the directive');
  }
}

for (const screen of [true, false]) {
  test(`${screen ? 'Echo Show' : 'speaker'}: repeated next and previous by voice and by button, then by name`, async () => {
    const echo = device(screen);
    const seen = new Set();
    const heart = { name: 'station', value: 'heart', confirmationStatus: 'NONE' };
    let r = await echo.intent('PlayStationIntent', { station: heart });
    checkSwitch(r, 'heart', { voice: true, screen }, seen);
    let here = 'heart';
    for (let i = 0; i < 6; i++) {           // forward six by voice
      r = await echo.intent('AMAZON.NextIntent'); here = neighbour(here, 1);
      checkSwitch(r, here, { voice: true, screen }, seen);
    }
    for (let i = 0; i < 9; i++) {           // back nine by voice, past where it started
      r = await echo.intent('AMAZON.PreviousIntent'); here = neighbour(here, -1);
      checkSwitch(r, here, { voice: true, screen }, seen);
    }
    for (const [type, step] of [['Next', 1], ['Next', 1], ['Previous', -1], ['Next', 1], ['Previous', -1], ['Previous', -1]]) {
      r = await echo.send({ type: `PlaybackController.${type}CommandIssued` }); here = neighbour(here, step);
      checkSwitch(r, here, { voice: false, screen }, seen);
    }
    for (const [name, step] of [['NextStationIntent', 1], ['PreviousStationIntent', -1], ['PreviousStationIntent', -1]]) {
      r = await echo.intent(name); here = neighbour(here, step);
      checkSwitch(r, here, { voice: true, screen }, seen);
    }
    r = await echo.intent('PlayStationIntent', { station: { name: 'station', value: 'z one hundred', confirmationStatus: 'NONE' } });
    checkSwitch(r, 'z100', { voice: true, screen }, seen);
    r = await echo.intent('AMAZON.NextIntent');
    checkSwitch(r, neighbour('z100', 1), { voice: true, screen }, seen);
    r = await echo.intent('PlayStationIntent', { station: heart });   // back to a station heard before
    checkSwitch(r, 'heart', { voice: true, screen }, seen);
  });
}

test('a synth station keeps its track through the new tokens, and queues the next one', async () => {
  const synth = stations.find(s => !s.stream && s.tracks.length > 1);
  const echo = device(true);
  const { play } = await echo.intent('PlayStationIntent', { station: { name: 'station', value: synth.name, confirmationStatus: 'NONE' } });
  assert.strictEqual(idOf(play.audioItem.stream.token), synth.id);
  const token = play.audioItem.stream.token;
  const index = Number(/^track:[a-z0-9-]+:(\d+)#/.exec(token)[1]);
  const nearly = await echo.send({ type: 'AudioPlayer.PlaybackNearlyFinished', token, offsetInMilliseconds: 1000 });
  assert.strictEqual(nearly.play.playBehavior, 'ENQUEUE');
  assert.strictEqual(nearly.play.audioItem.stream.expectedPreviousToken, token);
  assert.match(nearly.play.audioItem.stream.token, new RegExp(`^track:${synth.id}:${(index + 1) % synth.tracks.length}#`));
});

test('tokens saved before the change still resume their station', async () => {
  const echo = device(true);
  const { play } = await echo.send({ type: 'AudioPlayer.PlaybackStopped', token: 'live:z100', offsetInMilliseconds: 5 });
  assert.strictEqual(play, undefined);
  const r = await echo.intent('AMAZON.ResumeIntent');
  assert.strictEqual(idOf(r.play.audioItem.stream.token), 'z100');
});
