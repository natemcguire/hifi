'use strict';
// What a station is and where it's from, for what Alexa says ("This is classic jazz from Jazz24
// in Seattle.") and for the small line on the screen ("Jazz24 · Seattle"). Built from the
// catalog's genre ("Live / Classic jazz"), its city, and who streams it; `sayGenre` in
// stations.json says the genre when the label reads badly aloud.

// "Live / Classic jazz" → "Classic jazz"; "Christmas 1 / Soul · R&B" → "Soul and R&B". Spoken
// only, so the capitals don't matter.
function genre(station) {
  if (station.sayGenre) return station.sayGenre;
  const kind = String(station.genre || '').split('/').pop().trim();
  if (!kind) return '';
  const words = kind.split(/\s*·\s*/);
  const said = words.length < 2 ? words[0] : `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}`;
  return said.replace(/^Top 40$/, 'Top 40 hits');
}

// The city, from the catalog, or the "Live from … in Seattle" in its description.
function city(station) {
  if (station.city) return station.city;
  const m = /\bLive from (?:[^.]|\.\d)*? in ([A-Z][^.,]*)/.exec(station.tagline || '');
  return m ? m[1].trim() : '';
}

// Who it's from: the network for the house stations (SomaFM), the station itself otherwise.
const label = station => station.label || station.name;
const from = (station, spoken) => (!station.country && station.provider ? station.provider : spoken(station));
const made = station => !station.stream;   // the synth stations: HIFI's own tracks

// One short sentence after the station's name, or '' when there is nothing to add.
function describe(station, spoken = label) {
  const what = genre(station);
  if (!what) return '';
  if (made(station)) return `This is ${what}, made by HIFI.`;
  const where = city(station);
  return `This is ${what} from ${from(station, spoken)}${where ? ` in ${where}` : ''}`.replace(/\.?$/, '.');
}

// The small line under "HIFI Live Radio": the station and where it's from.
function line(station) {
  const where = made(station) ? 'HIFI Studio' : city(station);
  return where ? `${label(station)} · ${where}` : label(station);
}

module.exports = { genre, city, describe, line };
