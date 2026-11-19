// Writes the voice model from stations.json, so a new station is one catalog edit away from
// Alexa, and bundles a copy of the catalog with the Lambda for when the site can't be reached.
//   node alexa/scripts/build-model.mjs
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(await readFile(root + 'stations.json', 'utf8'));
const stations = catalog.stations.filter(s => s.stream || (s.tracks && s.tracks.length));

const plain = text => text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/['’]/g, '').replace(/&/g, ' and ');
// A decimal point between digits stays ("103.5"); everything else that isn't a letter or digit is a space.
const clean = text => plain(text).replace(/(\d)\.(?=\d)/g, '$1\u0000').replace(/[^a-z0-9\u0000 ]+/g, ' ').replace(/\u0000/g, '.').replace(/\s+/g, ' ').trim();

// ----- numbers and letters the way they are said -----
const UNIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'];
const TEEN = ['ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TEN = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const two = d => { const n = Number(d); return n < 10 ? (d.length > 1 ? 'oh ' : '') + UNIT[n] : n < 20 ? TEEN[n - 10] : TEN[Math.floor(n / 10)] + (n % 10 ? ' ' + UNIT[n % 10] : ''); };
// A whole number in a station name: 100 "one hundred", 102 "one oh two", 538 "five thirty eight"
// or "five three eight", 1065 "ten sixty five" or "one oh six five". The likeliest comes first.
function sayWhole(d) {
  if (d.length < 3) return [two(String(Number(d)))];
  if (d.length === 3) {
    const [a, b, c] = d;
    if (b === '0' && c === '0') return [`${UNIT[a]} hundred`];
    if (b === '0') return [`${UNIT[a]} oh ${UNIT[c]}`, `${UNIT[a]} hundred ${UNIT[c]}`, `${UNIT[a]} hundred and ${UNIT[c]}`];
    return [`${UNIT[a]} ${two(b + c)}`, `${two(a + b)} ${UNIT[c]}`, `${UNIT[a]} ${UNIT[b]} ${UNIT[c]}`];
  }
  if (d.endsWith('000')) return [`${UNIT[d[0]]} thousand`];
  if (d.length === 4 && d.endsWith('00')) return [`${two(d.slice(0, 2))} hundred`];
  if (d.length === 4) { const first = sayWhole(d.slice(0, 3))[0]; return [`${two(d.slice(0, 2))} ${two(d.slice(2))}`, `${first} ${UNIT[d[3]]}`, `${first} point ${UNIT[d[3]]}`]; }
  return [[...d].map(x => UNIT[x]).join(' ')];
}
// Letters said one by one are written "k. e. x. p.". A word with no vowel is said that way.
const NOT_SPELLED = new Set(['fm', 'dj']), SPELLED = new Set(['kexp', 'krbe', 'rte']);
const initials = w => (SPELLED.has(w) || (w.length > 1 && w.length < 5 && !/[aeiouy]/.test(w) && !NOT_SPELLED.has(w))) ? [...w].map(c => c + '.').join(' ') : null;
// One word of a name, every way it is said. The written form is first.
function sayWord(w) {
  let m;
  if ((m = /^(\d+)\.(\d)$/.exec(w))) return [w, ...sayWhole(m[1]).slice(0, 2).flatMap(f => [`${f} point ${UNIT[m[2]]}`, `${f} ${UNIT[m[2]]}`])];
  if (/^\d+$/.test(w)) return [w, ...sayWhole(w)];
  if ((m = /^([a-z]+)(\d+)$/.exec(w))) return [w, ...sayWhole(m[2]).map(f => `${initials(m[1]) || m[1]} ${f}`)];
  if ((m = /^(\d+)([a-z]+)$/.exec(w)) && m[2] !== 's') return [w, `${sayWhole(m[1])[0]} ${m[2]}`];  // "1live", not "90s"
  return initials(w) ? [w, initials(w)] : [w];
}
// A phrase, every way it is said, written form first: "103.5 kiss fm", "one oh three point five kiss fm"…
function said(phrase, cap = 12) {
  let out = [''];
  for (const w of clean(phrase).split(' ').filter(Boolean)) out = out.flatMap(head => sayWord(w).map(f => (head + ' ' + f).trim())).slice(0, cap);
  return out;
}

// Spoken forms of a station: its name ("LO-FI BEATS TO WORK TO" is also said "lo fi beats" and
// "lofi beats"), the catalog's own `say` ("kiss FM" for KIIS FM), the name without its frequency
// ("kiss fm" for 103.5 KISS FM) and that with the city ("kiss fm chicago").
const SMALL = ['for', 'all', 'at', 'around', 'to', 'the', 'of', 'and', 'a'];
function spokenForms(station) {
  const base = clean(station.name.replace(/\bkiis\b/gi, 'kiss'));
  const forms = new Set(said(base));
  for (const f of [base.replace(/\bradio\b/g, '').replace(/\s+/g, ' ').trim(), base.replace(/\blo fi\b/g, 'lofi'), base.replace(/\by2k\b/g, 'y two k'), base.replace(/\by2k\b/g, 'two thousand')]) forms.add(f);
  const words = base.split(' ');
  if (words.length > 2 && !SMALL.includes(words[1]) && !/^\d/.test(words[0])) forms.add(words.slice(0, 2).join(' '));
  const unnumbered = words.filter(w => !/^\d+(\.\d)?$/.test(w));
  if (unnumbered.length < words.length && unnumbered.length && unnumbered.length < 4 && !unnumbered.every(w => ['radio', 'fm', 'la'].includes(w))) {
    for (const f of said(unnumbered.join(' '), 2)) forms.add(f);
    if (station.city) forms.add(`${unnumbered.join(' ')} ${clean(station.city)}`);
  }
  // `say` is written for Alexa's voice; it is also a name when it reads as words ("big FM"), not digits one by one.
  const say = clean(station.say || '');
  if (say && !/(^| )\d( |$)/.test(say)) forms.add(say);
  return [...forms].filter(f => f.length > 1 && f !== 'radio');
}
// A tag only one station has ("bay area", "102.7") goes in the model as another name for it.
// Tags that several share ("jazz", "germany", "top 40") go in as words Alexa should expect, with
// no station of their own: the ranker picks the station.
const tagsOf = s => [...new Set((s.tags || []).map(clean))].filter(t => t.length > 1 && t.split(' ').length <= 3);
const tagCount = new Map();
for (const s of stations) for (const t of tagsOf(s)) tagCount.set(t, (tagCount.get(t) || 0) + 1);

const values = stations.map(s => {
  const [name, ...forms] = spokenForms(s);
  const synonyms = new Set(forms);
  for (const t of tagsOf(s)) if (tagCount.get(t) === 1 && synonyms.size < 40) for (const f of said(t, 3)) synonyms.add(f);
  synonyms.delete(name);
  return { id: s.id, name: { value: name, synonyms: [...synonyms] } };
});
const named = new Set(values.flatMap(v => [v.name.value, ...v.name.synonyms]));
const shared = [...tagCount].filter(([t, n]) => n > 1 && !named.has(t) && !['radio', 'fm', 'live', 'dj'].includes(t))
  .map(([t]) => ({ id: 'tag-' + t.replace(/[^a-z0-9]+/g, '-'), name: { value: t, synonyms: [] } }));

const model = {
  interactionModel: {
    languageModel: {
      // "HIFI live radio". "HIFI radio" can't be the name: an Echo writes the spoken "HIFI radio"
      // as "hifi radio" or "hi-fi radio", and both belong to another skill (the simulator answered
      // <IntentForDifferentSkill> for each on 2026-11-19, and Nate's Echos said "Sorry, HIFI radio
      // is not supported on this device" without a request reaching the endpoint). Only the typed
      // "hi fi radio" reached HIFI. "hifi live radio" reached it from Nate's Echo Show that morning.
      invocationName: 'hifi live radio',
      modelConfiguration: { fallbackIntentSensitivity: { level: 'LOW' } },
      intents: [
        { name: 'PlayStationIntent', slots: [{ name: 'station', type: 'HIFI_STATION' }], samples: [
          'play {station}', 'play {station} radio', 'play the {station} station', 'put on {station}', 'tune to {station}', 'tune in to {station}',
          'switch to {station}', 'change to {station}', 'go to {station}', 'start {station}', 'i want {station}', 'i want to hear {station}',
          'something {station}', 'play something {station}', 'play some {station}', 'listen to {station}', '{station} please', '{station} station', '{station}',
        ] },
        { name: 'PlayAnythingIntent', slots: [], samples: [
          'play', 'play radio', 'play something', 'play anything', 'start', 'start playing', 'turn on', 'turn on the radio', 'resume radio', 'keep playing', 'play my station', 'play where i left off',
        ] },
        { name: 'WhatsPlayingIntent', slots: [], samples: [
          'what is playing', "what's playing", 'what is this', "what's this", 'what song is this', 'who is this', "who's this", 'who sings this', 'what is this song', "what's this song",
          'what am i listening to', 'what station is this', 'which station is this', 'what is on', "what's on", 'what is the song', "what's the song", 'song name', 'what song is playing', 'tell me the song', 'now playing',
        ] },
        { name: 'ListStationsIntent', slots: [], samples: [
          'list stations', 'list the stations', 'what stations are there', 'what stations do you have', 'which stations are there', 'what can i listen to', 'what are my options', 'stations',
        ] },
        // Amazon's next and previous can't take extra phrases, so the station-flavoured ones get their own intents.
        // "back" and "skip" are here too: the Echo Show's strip says "Next or Back to change stations".
        { name: 'NextStationIntent', slots: [], samples: ['next station', 'another station', 'something else', 'skip station', 'skip this station', 'change the station', 'change station', 'move along the dial', 'skip', 'skip it', 'next one', 'forward', 'go forward', 'forward one'] },
        { name: 'PreviousStationIntent', slots: [], samples: ['previous station', 'last station', 'go back a station', 'back a station', 'the station before', 'back', 'go back', 'back one', 'go back one', 'previous one', 'the one before'] },
        // HIFI TV on the Echo Show: the station's clips on screen, or the plain player.
        { name: 'VideoOffIntent', slots: [], samples: [
          'audio only', 'just audio', 'radio only', 'just the radio', 'no video', 'turn off the video', 'turn the video off', 'stop the video', 'hide the video', 'video off', 'turn off hifi tv',
        ] },
        { name: 'VideoOnIntent', slots: [], samples: [
          'show the video', 'show video', 'show the videos', 'turn on the video', 'turn the video on', 'video on', 'hifi tv', 'turn on hifi tv', 'show hifi tv', 'with video',
        ] },
        { name: 'AMAZON.NextIntent', samples: [] }, { name: 'AMAZON.PreviousIntent', samples: [] },
        { name: 'AMAZON.ResumeIntent', samples: [] }, { name: 'AMAZON.PauseIntent', samples: [] }, { name: 'AMAZON.StopIntent', samples: [] },
        { name: 'AMAZON.CancelIntent', samples: [] }, { name: 'AMAZON.HelpIntent', samples: [] }, { name: 'AMAZON.FallbackIntent', samples: [] },
        { name: 'AMAZON.NavigateHomeIntent', samples: [] }, { name: 'AMAZON.StartOverIntent', samples: [] }, { name: 'AMAZON.RepeatIntent', samples: [] },
        { name: 'AMAZON.LoopOnIntent', samples: [] }, { name: 'AMAZON.LoopOffIntent', samples: [] }, { name: 'AMAZON.ShuffleOnIntent', samples: [] }, { name: 'AMAZON.ShuffleOffIntent', samples: [] },
      ],
      types: [{ name: 'HIFI_STATION', values: [...values, ...shared] }],
    },
  },
};

// Every English Echo gets the same model: an Echo set to English (UK, Canada, Australia or India)
// never reaches a skill that lacks its language, and Alexa hands "HIFI radio" to a music service.
// The locales are the manifest's (skill.json); deploy.sh pushes one model per locale.
const { manifest } = JSON.parse(await readFile(root + 'alexa/skill-package/skill.json', 'utf8'));
for (const locale of Object.keys(manifest.publishingInformation.locales)) {
  await writeFile(root + `alexa/skill-package/interactionModels/custom/${locale}.json`, JSON.stringify(model, null, 2) + '\n');
}
await copyFile(root + 'stations.json', root + 'alexa/lambda/stations.json');
console.log(`Voice model: ${values.length} stations, ${values.reduce((n, v) => n + v.name.synonyms.length + 1, 0)} spoken forms, ${shared.length} shared words.`);
