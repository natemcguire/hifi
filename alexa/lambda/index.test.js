'use strict';
// What Alexa says when a station starts: the same "Now listening to live radio on HIFI: …" line
// for open, resume, a station by name, next and previous. Run: node --test alexa/lambda
const test = require('node:test');
const assert = require('node:assert');

globalThis.fetch = async () => { throw new Error('offline in tests'); }; // the bundled catalog
const { skill } = require('./index');
const stations = require('./catalog').bundled();

const user = `amzn1.ask.account.test-${process.pid}`;
function envelope(request) {
  return {
    version: '1.0',
    session: { new: false, sessionId: 's', application: { applicationId: 'a' }, user: { userId: user } },
    context: { System: { application: { applicationId: 'a' }, user: { userId: user }, device: { deviceId: 'd', supportedInterfaces: { AudioPlayer: {} } } } },
    request: { requestId: 'r', timestamp: new Date().toISOString(), locale: 'en-US', ...request },
  };
}
const intent = (name, slots = {}) => envelope({ type: 'IntentRequest', intent: { name, confirmationStatus: 'NONE', slots } });
const said = async env => (await skill.invoke(env)).response.outputSpeech?.ssml?.replace(/<\/?speak>/g, '') ?? null;
const line = id => `Now listening to live radio on HIFI: ${stations.find(s => s.id === id).label || ''}`;

test('open the first time welcomes and announces the station', async () => {
  const speech = await said(envelope({ type: 'LaunchRequest' }));
  assert.match(speech, /^Welcome\. Now listening to live radio on HIFI: /);
});

test('a station by name, resume, open, next and previous all announce it', async () => {
  const heart = stations.findIndex(s => s.id === 'heart');
  assert.ok(heart > 0);
  const station = { name: 'station', value: 'heart', confirmationStatus: 'NONE' };
  assert.strictEqual(await said(intent('PlayStationIntent', { station })), `${line('heart')}.`);
  assert.strictEqual(await said(intent('AMAZON.ResumeIntent')), `${line('heart')}.`);
  assert.strictEqual(await said(envelope({ type: 'LaunchRequest' })), `${line('heart')}.`);
  assert.match(await said(intent('AMAZON.NextIntent')), /^Now listening to live radio on HIFI: .+\.$/);
  assert.strictEqual(await said(intent('AMAZON.PreviousIntent')), `${line('heart')}.`);
});

test('the play button on the device stays quiet', async () => {
  assert.strictEqual(await said(envelope({ type: 'PlaybackController.NextCommandIssued' })), null);
});
