'use strict';
// What a listener says, and the station that should play. Run: node --test alexa/lambda
const test = require('node:test');
const assert = require('node:assert');
const { rank, fold } = require('./search');
const stations = require('./catalog').bundled();

const first = said => rank(stations, said)[0]?.id ?? null;

test('a station by its name', () => {
  for (const [said, id] of [
    ['radio paradise', 'radio-paradise'], ['lo fi beats', 'lofi-beats'], ['pop girl', 'pop-girl'], ['dial up', 'dial-up'],
    ['late night jazz', 'late-night-jazz'], ['jazz 24', 'jazz24'], ['kexp', 'kexp'], ['the edge', 'the-edge'], ['triple j', 'triple-j'],
    ['capital', 'capital'], ['capital extra', 'capital-xtra'], ['radio x', 'radio-x'], ['q music', 'qmusic'], ['big fm', 'bigfm'],
    ['sky radio', 'sky-radio'], ['skyrock', 'skyrock'], ['hit radio', 'hit-radio'], ['metro fm', 'metro-fm'],
  ]) assert.strictEqual(first(said), id, said);
});

test('numbers and letters the way Alexa hears them', () => {
  for (const [said, id] of [
    ['z one hundred', 'z100'], ['z100', 'z100'], ['z. 100', 'z100'], ['Z1 hundred', 'z100'], ['Q1 oh two', 'q102'], ['jazz twenty four', 'jazz24'], ['one live', '1live'],
    ['one oh three point five kiss fm', 'kiss-fm-chicago'], ['103.5 kiss fm', 'kiss-fm-chicago'], ['wild ninety four nine', 'wild-949'],
    ['hot ninety nine five', 'hot-995'], ['power ninety six one', 'power-961'], ['q one oh two', 'q102'], ['kiss one oh eight', 'kiss-108'],
    ['kiss ten sixty five', 'kiis-1065'], ['radio five three eight', 'radio-538'], ['cadena one hundred', 'cadena-100'],
    ['beat one hundred point nine', 'beat-1009'], ['d ninety nine', 'd99'], ['los forty', 'los40'], ['eighty nine f. m.', '89-fm'],
    ['k. e. x. p.', 'kexp'], ['k. c. r. w.', 'kcrw'], ['k. r. b. e.', 'krbe'], ['n. r. j.', 'nrj'], ['h. r. three', 'hr3'],
    ['s. w. r. three', 'swr3'], ['r. t. l. two', 'rtl2'], ['r. t. e. two f. m.', 'rte-2fm'], ['n. r. k. p. three', 'nrk-p3'], ['r. d. s.', 'rds'],
  ]) assert.strictEqual(first(said), id, said);
});

test('KIIS FM is said "kiss FM", and a city tells the KISS stations apart', () => {
  assert.strictEqual(first('kiss fm'), 'kiis-fm');
  assert.strictEqual(first('kiss f. m.'), 'kiis-fm');
  assert.strictEqual(first('kiss fm chicago'), 'kiss-fm-chicago');
  assert.strictEqual(first('kiss fm dallas'), 'kiss-fm-dallas');
  assert.strictEqual(first('kiss sydney'), 'kiis-1065');
  assert.strictEqual(first('nova sydney'), 'nova-969');
});

test('a genre, a mood, an artist, a city or a country', () => {
  for (const [said, id] of [
    ['jazz', 'jazz24'], ['dark academia', 'late-night-jazz'], ['something for work', 'working-for-the-weekend'], ['taylor swift', 'pop-girl'],
    ['new york', 'z100'], ['los angeles', 'kiis-fm'], ['houston', 'krbe'], ['germany', '1live'], ['france', 'nrj'],
  ]) assert.strictEqual(first(said), id, said);
  assert.strictEqual(stations.find(s => s.id === first('something from australia')).country, 'AU');
  assert.ok(first('christmas').includes('christmas'));
});

test('nothing fits: no station, not a near miss', () => {
  assert.strictEqual(first('the beatles'), null);
  assert.strictEqual(first('banana phone'), null);
  assert.strictEqual(first('play something'), null);
});

test('words that are not numbers stay words', () => {
  assert.strictEqual(fold('oh holy night'), 'oh holy night');  // "oh" alone is not a zero
  assert.strictEqual(fold('play a 100 hits'), 'play a 100 hits');  // and "a" is not a spelled letter
  assert.strictEqual(first('code all night'), 'code-all-night');
  assert.strictEqual(first('y two k chill out'), 'y2k-chill-out');
});
