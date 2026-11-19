'use strict';
// The "Next or Back to change stations" strip on the Echo Show. Run: node --test alexa/lambda
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const dial = require('./dial-hint');
const tv = require('./tv');
const stations = require('./catalog').bundled();

const walk = (node, out = []) => {
  if (Array.isArray(node)) node.forEach(n => walk(n, out));
  else if (node && typeof node === 'object') { out.push(node); Object.values(node).forEach(v => walk(v, out)); }
  return out;
};

test('the strip reads exactly "Next or Back to change stations" between a left and a right arrow', () => {
  const strip = dial.layer();
  assert.strictEqual(strip.position, 'absolute');
  assert.match(String(strip.bottom), /: 0\}$/, 'on the bottom edge of a rectangular screen');
  const row = strip.item.items;
  assert.strictEqual(row.length, 3);
  assert.strictEqual(row[0].type, 'TouchWrapper');
  assert.strictEqual(row[1].text, 'Next or Back to change stations');
  assert.strictEqual(row[1].color, '#FFFFFF');
  assert.strictEqual(row[2].type, 'TouchWrapper');
  assert.deepStrictEqual(row[0].onPress, [{ type: 'SendEvent', arguments: [dial.EVENT, 'previous'] }]);
  assert.deepStrictEqual(row[2].onPress, [{ type: 'SendEvent', arguments: [dial.EVENT, 'next'] }]);
  for (const node of walk(strip).filter(n => n.type === 'VectorGraphic')) assert.ok(dial.graphics[node.source], node.source);
});

test('a tap on an arrow is a step along the dial; other screen events are not', () => {
  const event = (...args) => ({ type: 'Alexa.Presentation.APL.UserEvent', arguments: args });
  assert.strictEqual(dial.step(event(dial.EVENT, 'next')), 1);
  assert.strictEqual(dial.step(event(dial.EVENT, 'previous')), -1);
  assert.strictEqual(dial.step(event(tv.EVENT, 'tick', 'jazz24', false, 0)), null);
  assert.strictEqual(dial.step(event(dial.EVENT, 'sideways')), null);
  assert.strictEqual(dial.step({ type: 'IntentRequest' }), null);
});

test('the HIFI TV screen carries the strip on top, over the clip and the words', () => {
  const doc = tv.document();
  const items = doc.mainTemplate.item.items;
  assert.strictEqual(items[items.length - 1].id, 'hifi-dial-hint', 'the strip is the last, topmost layer');
  for (const name of Object.keys(dial.graphics)) assert.ok(doc.graphics?.[name], `graphic ${name} in the document`);
});

test('every station has the cover and the full-screen background with the arrows', () => {
  const assets = path.join(__dirname, '../assets');
  for (const s of stations) {
    assert.match(s.cover, /\/alexa\/covers\/[a-z0-9-]+\.png\?v=\d+$/, s.id);
    assert.match(s.background, /\/alexa\/backgrounds\/[a-z0-9-]+\.png\?v=\d+$/, s.id);
    assert.ok(fs.existsSync(path.join(assets, 'covers', `${s.id}.png`)), `cover for ${s.id}`);
    assert.ok(fs.existsSync(path.join(assets, 'backgrounds', `${s.id}.png`)), `background for ${s.id}`);
  }
});
