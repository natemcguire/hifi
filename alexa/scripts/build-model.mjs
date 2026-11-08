// Writes the voice model from stations.json, so a new station is one catalog edit away from
// Alexa, and bundles a copy of the catalog with the Lambda for when the site can't be reached.
//   node alexa/scripts/build-model.mjs
import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const catalog = JSON.parse(await readFile(root + 'stations.json', 'utf8'));
const stations = catalog.stations.filter(s => s.stream || (s.tracks && s.tracks.length));

const clean = text => text.toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
// Spoken forms of a name: "LO-FI BEATS TO WORK TO" is also said "lo fi beats" and "lofi beats".
function spokenForms(name) {
  const base = clean(name);
  const forms = new Set([base, base.replace(/\bradio\b/g, '').trim(), base.replace(/\blo fi\b/g, 'lofi'), base.replace(/\by2k\b/g, 'y two k'), base.replace(/\by2k\b/g, 'two thousand')]);
  const words = base.split(' ');
  if (words.length > 2 && !['for', 'all', 'at', 'around', 'to', 'the', 'of', 'and'].includes(words[1])) forms.add(words.slice(0, 2).join(' '));
  return [...forms].filter(f => f.length > 1 && f !== 'radio');
}
// Tags shared by many stations ("evening", "work") are left to the ranker; distinctive ones
// go in the model so Alexa hears them as station names.
const tagCount = new Map();
for (const s of stations) for (const t of new Set((s.tags || []).map(clean))) tagCount.set(t, (tagCount.get(t) || 0) + 1);

const values = stations.map(s => {
  const synonyms = new Set(spokenForms(s.name));
  for (const t of (s.tags || []).map(clean)) if (t && tagCount.get(t) === 1 && synonyms.size < 24 && t.split(' ').length <= 3) synonyms.add(t);
  synonyms.delete(clean(s.name));
  return { id: s.id, name: { value: clean(s.name), synonyms: [...synonyms] } };
});

const model = {
  interactionModel: {
    languageModel: {
      invocationName: 'hifi radio',
      modelConfiguration: { fallbackIntentSensitivity: { level: 'LOW' } },
      intents: [
        { name: 'PlayStationIntent', slots: [{ name: 'station', type: 'HIFI_STATION' }], samples: [
          'play {station}', 'play {station} radio', 'play the {station} station', 'put on {station}', 'tune to {station}', 'tune in to {station}',
          'switch to {station}', 'change to {station}', 'go to {station}', 'start {station}', 'i want {station}', 'i want to hear {station}',
          'something {station}', 'play something {station}', 'play some {station}', '{station} please', '{station} station', '{station}',
        ] },
        { name: 'PlayAnythingIntent', slots: [], samples: [
          'play', 'play radio', 'play something', 'play anything', 'start', 'start playing', 'turn on', 'turn on the radio', 'resume radio', 'keep playing', 'play my station', 'play where i left off',
        ] },
        { name: 'WhatsPlayingIntent', slots: [], samples: [
          'what is playing', 'what is this', 'what song is this', 'who is this', 'who sings this', 'what is this song', 'what am i listening to', 'what station is this', 'which station is this', 'what is on', 'what is the song',
        ] },
        { name: 'ListStationsIntent', slots: [], samples: [
          'list stations', 'list the stations', 'what stations are there', 'what stations do you have', 'which stations are there', 'what can i listen to', 'what are my options', 'stations',
        ] },
        { name: 'AMAZON.NextIntent', samples: ['next station', 'another station', 'something else', 'skip station', 'change the station', 'change station'] },
        { name: 'AMAZON.PreviousIntent', samples: ['previous station', 'last station', 'go back a station', 'back a station'] },
        { name: 'AMAZON.ResumeIntent', samples: [] }, { name: 'AMAZON.PauseIntent', samples: [] }, { name: 'AMAZON.StopIntent', samples: [] },
        { name: 'AMAZON.CancelIntent', samples: [] }, { name: 'AMAZON.HelpIntent', samples: [] }, { name: 'AMAZON.FallbackIntent', samples: [] },
        { name: 'AMAZON.NavigateHomeIntent', samples: [] }, { name: 'AMAZON.StartOverIntent', samples: [] }, { name: 'AMAZON.RepeatIntent', samples: [] },
        { name: 'AMAZON.LoopOnIntent', samples: [] }, { name: 'AMAZON.LoopOffIntent', samples: [] }, { name: 'AMAZON.ShuffleOnIntent', samples: [] }, { name: 'AMAZON.ShuffleOffIntent', samples: [] },
      ],
      types: [{ name: 'HIFI_STATION', values }],
    },
  },
};

await writeFile(root + 'alexa/skill-package/interactionModels/custom/en-US.json', JSON.stringify(model, null, 2) + '\n');
await copyFile(root + 'stations.json', root + 'alexa/lambda/stations.json');
console.log(`Voice model: ${values.length} stations, ${values.reduce((n, v) => n + v.name.synonyms.length + 1, 0)} spoken forms.`);
