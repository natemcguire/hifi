'use strict';
// The Echo screen against Amazon's design guidance, on every screen the skill says it supports:
// type no smaller than 24 dp, sized for the distance it is read from; arrows that are buttons of
// at least 68 dp; a strip and words that fit a portrait Echo Show 15 and a round Echo Spot; a
// pause line a TV can follow; and a screen that can't time out while the station plays.
// Run: node --test alexa/lambda/*.test.js (alexa/scripts/apl-preview.mjs draws the real thing)
const test = require('node:test');
const assert = require('node:assert');
const dial = require('./dial-hint');
const tv = require('./tv');
const manifest = require('../skill-package/skill.json');

// The screens, in dp: the Alexa Skills Toolkit's example device for each viewport profile.
const SCREENS = {
  'Echo Show 5': { width: 960, height: 480, shape: 'rectangle', mode: 'hub' },
  'Echo Show 8': { width: 960, height: 600, shape: 'rectangle', mode: 'hub' },
  'Echo Show 10': { width: 1280, height: 800, shape: 'rectangle', mode: 'hub' },
  'Echo Show 15': { width: 1920, height: 1080, shape: 'rectangle', mode: 'hub' },
  'Echo Show 15 upright': { width: 1080, height: 1920, shape: 'rectangle', mode: 'hub' },
  'Echo Spot': { width: 480, height: 480, shape: 'round', mode: 'hub' },
  'Fire TV': { width: 960, height: 540, shape: 'rectangle', mode: 'tv' },
};

// APL expressions here are plain JavaScript expressions over `viewport`.
const value = (v, viewport) => {
  if (typeof v !== 'string' || !v.startsWith('${')) return v;
  return new Function('viewport', 'Math', `return (${v.slice(2, -1)});`)(viewport, Math);
};
const walk = (node, out = []) => {
  if (Array.isArray(node)) node.forEach(n => walk(n, out));
  else if (node && typeof node === 'object') { out.push(node); Object.values(node).forEach(v => walk(v, out)); }
  return out;
};
// The document's sizes on a screen: later resource blocks win where their `when` holds.
const sizes = (doc, viewport) => doc.resources
  .filter(r => !r.when || value(r.when, viewport))
  .reduce((all, r) => ({ ...all, ...r.dimensions }), {});

test('the manifest lists every Echo screen, so none is scaled and letterboxed', () => {
  const apl = manifest.manifest.apis.custom.interfaces.find(i => i.type === 'ALEXA_PRESENTATION_APL');
  for (const [name, s] of Object.entries(SCREENS)) {
    const fits = apl.supportedViewports.some(v => v.mode === s.mode.toUpperCase() && v.shape === s.shape.toUpperCase()
      && s.width >= v.minWidth && s.width <= v.maxWidth && s.height >= v.minHeight && s.height <= v.maxHeight);
    assert.ok(fits, `${name} ${s.width}x${s.height}`);
  }
});

test('type is 24 dp or more everywhere, and larger the farther away the screen is read', () => {
  const doc = tv.document();
  const texts = walk(doc).filter(n => n.type === 'Text');
  for (const [name, viewport] of Object.entries(SCREENS)) {
    const size = sizes(doc, viewport);
    for (const t of texts) {
      const px = typeof t.fontSize === 'string' && t.fontSize.startsWith('@') ? size[t.fontSize.slice(1)] : value(t.fontSize, viewport);
      assert.ok(typeof px === 'number' && px >= 24, `${name}: "${t.text}" at ${px}`);
    }
  }
  const show5 = sizes(doc, SCREENS['Echo Show 5']), show10 = sizes(doc, SCREENS['Echo Show 10']), show15 = sizes(doc, SCREENS['Echo Show 15']);
  assert.ok(show5.songSize < show10.songSize && show10.songSize < show15.songSize, 'the song grows with the screen');
  assert.ok(sizes(doc, SCREENS['Fire TV']).placeSize >= 28, 'the station line reads from a sofa');
});

test('the arrows are buttons of at least 68 dp and the strip fits every screen', () => {
  const strip = dial.layer();
  for (const [name, viewport] of Object.entries(SCREENS)) {
    const height = value(strip.height, viewport);
    assert.ok(height >= 96 && height <= viewport.height * 0.22, `${name}: strip ${height} dp high`);
    const words = strip.item.items[1];
    assert.ok(value(words.fontSize, viewport) >= 28, `${name}: "Next or Back" at ${value(words.fontSize, viewport)}`);
    for (const arrow of [strip.item.items[0], strip.item.items[2]]) {
      const frame = arrow.item, art = frame.item;
      const across = value(art.width, viewport) + 2 * value(frame.paddingLeft, viewport);
      assert.ok(Math.max(frame.minWidth, across) >= 68 && Math.max(frame.minHeight, value(art.height, viewport)) >= 68, `${name}: ${arrow.id}`);
    }
  }
  assert.ok(value(strip.bottom, SCREENS['Echo Spot']) > 0, 'drawn up from the bottom of a round screen');
});

test('a pause tells a TV to say resume, a touch screen to tap or say it', () => {
  const paused = walk(tv.document()).find(n => n.type === 'Text' && /Paused/.test(n.text));
  assert.doesNotMatch(value(paused.text, SCREENS['Fire TV']), /Tap/);
  assert.match(value(paused.text, SCREENS['Fire TV']), /Alexa, resume/);
  assert.match(value(paused.text, SCREENS['Echo Show 8']), /Tap to play, or say “Alexa, resume\.”/);
});

test('the screen holds itself up while the station plays', () => {
  const doc = tv.document();
  const videos = walk(doc).filter(n => n.type === 'Video');
  assert.strictEqual(videos.length, 2);
  for (const v of videos) assert.strictEqual(v.screenLock, true, v.id);
  const ticks = doc.mainTemplate.item.onMount.find(c => c.sequencer === 'hifi-tick');
  assert.strictEqual(ticks.screenLock, true);
});
