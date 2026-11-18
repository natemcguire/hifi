'use strict';
// Ranked station search, the same scheme as the app's StationSearch (ios/Sources/Search.swift):
// folded tokens, weighted fields, exact / prefix / substring / initials / typo matches, and
// every query word must land somewhere. A spoken request is only ever a few words, so the
// first result is what plays.

const WEIGHTS = { name: 3, tags: 2.2, genre: 1.8, subtitle: 1.4, tagline: 1 };

// Things Alexa hears several ways, folded to one spelling on both sides.
const ALIASES = [
  [/\blow?[ -]?fi\b/g, 'lofi'], [/\bhip[ -]?hop\b/g, 'hiphop'], [/\bchill[ -]?out\b/g, 'chillout'], [/\btrip[ -]?hop\b/g, 'triphop'],
  [/\b(y ?2 ?k|y two k|why two k|two thousand)\b/g, 'y2k'], [/\br ?(and|n) ?b\b/g, 'rnb'], [/\b(8|eight)[ -]?bit\b/g, '8bit'], [/\b(16|sixteen)[ -]?bit\b/g, '16bit'],
  [/\bx-?mas\b/g, 'christmas'], [/\bdial[ -]?up\b/g, 'dialup'], [/\b(nineties|90's)\b/g, '90s'], [/\b(eighties|80's)\b/g, '80s'],
  [/\br ?& ?b\b/g, 'rnb'], [/\bkiis\b/g, 'kiss'],  // KIIS FM is said "kiss FM"
];
// Words that carry no station: "play something for work" is a question about work.
const FILLER = new Set(['play', 'put', 'on', 'tune', 'to', 'the', 'a', 'an', 'some', 'something', 'anything', 'for', 'me', 'my', 'music', 'radio', 'station', 'channel', 'please', 'of', 'and', 'with', 'that', 'this', 'like', 'i', 'want', 'hear', 'listen', 'go', 'switch', 'change']);

// Numbers come spoken ("one oh three point five", "z one hundred") or as digits ("103.5",
// "z100"), and letters come spelled ("k. e. x. p."). Both sides fold to one form: a run of
// number words or digit groups becomes one string of digits ("1035"), spelled letters join
// up ("kexp"), and digits after spelled letters join them ("z100", "hr3").
const UNITS = { zero: 0, oh: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
const TEENS = { ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const digits = w => /^\d+$/.test(w);
const numeric = w => w !== undefined && (digits(w) || (w in UNITS && w !== 'oh') || w in TEENS || w in TENS);

function numerals(words) {
  const out = [];
  let run = null;  // the digits said so far
  for (let i = 0; i < words.length; i++) {
    const w = words[i], next = words[i + 1];
    if (digits(w)) run = (run ?? '') + w;
    else if (run !== null && w === 'point' && numeric(next)) continue;
    else if (run !== null && w === 'hundred') run += '00';
    else if (w in TENS && next in UNITS && next !== 'oh' && next !== 'zero') { run = (run ?? '') + (TENS[w] + UNITS[next]); i++; }
    else if (w in TENS || w in TEENS) run = (run ?? '') + (TENS[w] ?? TEENS[w]);
    else if (w in UNITS && (w !== 'oh' || run !== null)) run = (run ?? '') + UNITS[w];
    else { if (run !== null) { out.push(run); run = null; } out.push(w); }
  }
  if (run !== null) out.push(run);
  return out;
}

function spelled(words) {
  const out = [];
  let letters = false;  // the last word out is letters that were said one by one
  for (const w of words) {
    const letter = /^[a-z]$/.test(w);
    if (letters && (letter || digits(w))) out[out.length - 1] += w;
    else out.push(w);
    letters = letter && (letters || (w !== 'a' && w !== 'i'));  // "a" and "i" are words unless they follow a letter
  }
  return out;
}

function fold(text) {
  let out = String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/['’]/g, '');
  for (const [from, to] of ALIASES) out = out.replace(from, to);
  return spelled(numerals(out.replace(/[^a-z0-9]+/g, ' ').trim().split(' '))).join(' ');
}
const tokens = text => fold(text).split(' ').filter(Boolean);
const bare = folded => folded.split(' ').filter(w => !FILLER.has(w)).join(' ');
// "coding" should find "code", "beats" should find "beat": the plain stem, when it differs.
const stem = w => w.length > 4 ? w.replace(/(ing|ers|er|ies|es|s)$/, '') : w;

function distance(a, b, cap) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const rows = [];
  for (let i = 0; i <= a.length; i++) { rows[i] = [i]; }
  for (let j = 0; j <= b.length; j++) rows[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    let best = cap + 1;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(rows[i - 1][j] + 1, rows[i][j - 1] + 1, rows[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, rows[i - 2][j - 2] + 1);
      rows[i][j] = v;
      best = Math.min(best, v);
    }
    if (best > cap) return cap + 1;
  }
  return rows[a.length][b.length];
}

// How well one query word fits one field. 0 means not at all.
function match(word, field) {
  const direct = matchWord(word, field);
  const root = stem(word);
  if (root === word || direct >= 0.85) return direct;
  const stemmed = matchWord(root, field);
  return stemmed >= 0.6 ? Math.max(direct, stemmed * 0.9) : direct;  // a stem only counts when it really appears
}
function matchWord(word, field) {
  if (field.words.includes(word)) return 1;
  if (field.words.some(w => w.startsWith(word))) return 0.85;
  if (field.text.startsWith(word)) return 0.8;
  if (field.text.includes(word)) return 0.6;
  if (field.squeezed.includes(word)) return 0.55;
  if (word.length >= 2 && field.initials.startsWith(word)) return 0.5;
  if (word.length >= 4) {
    const cap = word.length >= 7 ? 2 : 1;
    for (const w of field.words) {
      const d = distance(word, w, cap);
      if (d <= cap) return d === 1 ? 0.45 : 0.4;
    }
  }
  return 0;
}

function field(text) {
  const words = tokens(text);
  return { text: words.join(' '), words, squeezed: words.join(''), initials: words.map(w => w[0]).join('') };
}

const cache = new Map();
function fields(station) {
  let f = cache.get(station.id);
  if (!f) {
    f = Object.entries(WEIGHTS).map(([key, weight]) => {
      const value = key === 'tags' ? (station.tags || []).join(' | ') : station[key];
      return { weight, key, field: field(value), items: key === 'tags' ? (station.tags || []).map(field) : null };
    });
    cache.set(station.id, f);
  }
  return f;
}

function score(station, words, query, whole) {
  let total = 0;
  for (const word of words) {
    let best = 0;
    for (const f of fields(station)) {
      const m = f.items ? Math.max(0, ...f.items.map(item => match(word, item))) : match(word, f.field);
      best = Math.max(best, m * f.weight);
    }
    if (best === 0) return 0;
    total += best;
  }
  // The whole name said: "the edge", "radio x" (filler words dropped), "one live" for 1LIVE.
  // `whole` keeps the filler words, for names made of them ("q music" for Qmusic).
  const name = fold(station.name), run = name.replace(/ /g, '');
  if (bare(name) === query || run === query.replace(/ /g, '') || run === whole.replace(/ /g, '')) total += 5;
  else if (name.startsWith(query)) total += 4;
  else if (name.includes(query)) total += 2;
  else if ((station.tags || []).some(t => fold(t) === query)) total += 1.5;
  return total;
}

// A word has to land somewhere real: an exact tag, a name prefix, a one-letter slip in a
// name. A two-letter slip anywhere ("beatles" against "beats") doesn't count.
const MIN_PER_WORD = 1.3;

// Stations that fit the query, best first. Empty when nothing fits, or when the query was
// only filler ("play something"), which `meaningful` tells apart.
function rank(stations, query) {
  const q = fold(query);
  const words = tokens(q).filter(w => !FILLER.has(w));
  if (!words.length) return [];
  return stations.map(s => ({ s, v: score(s, words, words.join(' '), q) })).filter(x => x.v >= MIN_PER_WORD * words.length)
    .sort((a, b) => b.v - a.v).map(x => x.s);
}
const meaningful = query => tokens(query).some(w => !FILLER.has(w));

module.exports = { rank, meaningful, fold, tokens };
