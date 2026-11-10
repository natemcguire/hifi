// Offline checks for the channel tools: node --test channel/tools/test.mjs (npm run channel:test).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { flags, inSeason, redactor } from './lib.mjs';
import { shotList, shotAt } from '../stream/tape.js';

test('flags', () => {
  assert.deepEqual(flags(['night-build', '--seconds', '30', '--clean']), { _: ['night-build'], seconds: '30', clean: true });
});

test('Christmas season wraps past New Year', () => {
  const season = { from: '12-01', to: '01-06' };
  assert.equal(inSeason(season, new Date(2026, 11, 24)), true);
  assert.equal(inSeason(season, new Date(2027, 0, 6)), true);
  assert.equal(inSeason(season, new Date(2027, 0, 7)), false);
  assert.equal(inSeason(season, new Date(2026, 10, 10)), false);
  assert.equal(inSeason(undefined), true);
});

test('the stream key never reaches the log', () => {
  const key = 'abcd-efgh-ijkl-mnop-qrst', r = redactor(key);
  const line = `[flv @ 0x1] Failed to connect to rtmps://a.rtmps.youtube.com/live2/${key}: I/O error (key ${key})`;
  assert.ok(!r(line).includes(key));
  assert.ok(!r(line).includes('live2/'));
});

test('close-ups stay clear of the loop seam and the record flips', () => {
  const tracks = [], records = [{ start: 0, end: 400 }, { start: 408, end: 800 }];
  for (let t = 5.4; t < 790; t += 130) tracks.push({ start: t, end: t + 126 });
  const shots = shotList({ tracks, records });
  assert.ok(shots.length > 4);
  for (const s of shots) for (const e of [0, 400, 408, 800]) assert.ok(s.to < e - 6 || s.from > e + 6, `shot ${s.from}-${s.to} near ${e}`);
  assert.equal(shotAt(shots, 1).kind, 'wide');
  assert.equal(shotAt(shots, shots[0].from + 1).kind, 'deck');
});

test('every planned stream has a title YouTube accepts and a thumbnail clip', () => {
  const plan = JSON.parse(readFileSync(new URL('../channel.json', import.meta.url), 'utf8'));
  assert.equal(plan.streams.length, 6);
  for (const s of plan.streams) {
    assert.ok(s.title.length <= 100, s.id);
    assert.ok(!/[<>]/.test(s.title + s.about), s.id);
    assert.ok(s.thumbClip >= 1 && s.thumbClip <= 4, s.id);
  }
  assert.ok(plan.channel.description.length <= 1000);
});
