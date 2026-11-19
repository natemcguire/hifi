'use strict';
// What a station is and where it's from (about.js). Run: node --test alexa/lambda
const test = require('node:test');
const assert = require('node:assert');
const about = require('./about');
const { bundled } = require('./catalog');

const stations = bundled();
const get = id => stations.find(s => s.id === id);

test('Jazz24: classic jazz from Seattle', () => {
  assert.strictEqual(about.describe(get('jazz24')), 'This is Classic jazz from Jazz24 in Seattle.');
  assert.strictEqual(about.line(get('jazz24')), 'Jazz24 · Seattle');
});

test('the house stations name their network and city, the synth stations HIFI', () => {
  assert.strictEqual(about.describe(get('lofi-beats')), 'This is Lo-fi beats from SomaFM in San Francisco.');
  assert.strictEqual(about.describe(get('dial-up')), 'This is lo-fi soft breaks, made by HIFI.');
  assert.strictEqual(about.line(get('dial-up')), 'DIAL-UP · HIFI Studio');
  assert.strictEqual(about.describe(get('z100')), 'This is Top 40 hits from Z100 in New York.');
  assert.strictEqual(about.describe(get('hot-995')), 'This is Top 40 hits from HOT 99.5 in Washington, D.C.');
});

test('a city falls back to the "Live from … in …" of the description', () => {
  assert.strictEqual(about.city({ tagline: 'Indie. Live from KEXP 90.3 in Seattle, listener-supported.' }), 'Seattle');
});

test('every station gets one short sentence and a line that fits the screen', () => {
  for (const s of stations) {
    const said = about.describe(s);
    assert.match(said, /^This is [^.]+(\.[^ ][^.]*)*\.$/, s.id);
    assert.ok(said.length <= 90, `${s.id}: ${said}`);
    assert.ok(about.line(s).length <= 40, `${s.id}: ${about.line(s)}`);
  }
});

test('HIFI TV says "HIFI Live Radio", "Starting up stream" until the sound starts, then the station and city small', () => {
  const tv = require('./tv');
  const doc = JSON.stringify(tv.document());
  assert.ok(doc.includes("!started ? 'HIFI Live Radio'") && doc.includes("!started ? 'Starting up stream'"));
  assert.ok(doc.includes('${tv.place}'));
  let directive;
  tv.render({ addDirective: d => { directive = d; } }, get('jazz24'));
  assert.strictEqual(directive.datasources.tv.place, 'Jazz24 · Seattle');
});
