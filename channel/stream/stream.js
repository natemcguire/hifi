// Loads one stream (?s=<id>) and its program (/sides/<id>/program.json + record-*.vis, from tools/sides.mjs),
// builds the tape and the deck, and exposes window.HIFI for tools/render.mjs:
//   await HIFI.ready            -> { duration, fps }
//   await HIFI.frame(t)         -> draws program time t (seconds) and the lower third for it
import { Tape } from './tape.js';
import { Deck } from './deck.js';

const q = new URLSearchParams(location.search), id = q.get('s') || 'night-build', rendering = q.has('render');
const $ = (x) => document.getElementById(x);
const clock = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

async function boot() {
  const { streams } = await (await fetch('/streams.json')).json();
  const stream = streams.find((s) => s.id === id);
  if (!stream) throw Error(`no stream ${id} in streams.json`);
  const side = await (await fetch(`/sides/${id}/program.json`)).json();
  for (const r of side.records) {
    r.rec.rTab = new Float64Array(Uint8Array.from(atob(r.rec.rTab), (c) => c.charCodeAt(0)).buffer);
    r.vis = { data: new Uint8Array(await (await fetch(`/sides/${id}/${r.vis.file}`)).arrayBuffer()), cols: r.vis.cols, rows: r.vis.rows };
  }

  const room = $('room');
  room.style.setProperty('--c', stream.color);
  if (stream.christmas) room.classList.add('christmas');
  $('sname').textContent = `${stream.name} · ${stream.frequency}`;
  $('sgenre').textContent = stream.genre.replace(' / ', ' · ').toUpperCase();
  $('s').textContent = `${stream.name} · HIFI 24/7`;

  const clips = await Promise.all(stream.tv.map((src) => new Promise((res, rej) => {
    const v = document.createElement('video');
    Object.assign(v, { muted: true, playsInline: true, preload: 'auto', src });
    v.addEventListener('loadeddata', () => res(v), { once: true });
    v.addEventListener('error', () => rej(Error(`clip ${src} failed to load`)), { once: true });
  })));
  const deckCanvas = $('deck');
  const deck = new Deck(deckCanvas, stream, side);
  const tape = new Tape($('tape'), stream, side, { deck, deckCanvas, clips });
  await tape.load();
  await document.fonts.ready;

  let shown = -1;
  async function frame(t) {
    const info = await tape.frame(t);
    if (info.index !== shown) {
      shown = info.index;
      $('t').textContent = info.track.title;
      $('a').textContent = info.track.artist + (info.track.year ? ` · ${info.track.year}` : '');
    }
    const len = info.track.end - info.track.start;
    $('bar').style.width = `${(info.elapsed / len) * 100}%`;
    $('e').textContent = clock(info.elapsed);
    $('r').textContent = `-${clock(len - info.elapsed)}`;
    return info;
  }
  return { stream, side, frame };
}

const ready = boot();
window.HIFI = {
  ready: ready.then(({ side }) => ({ duration: side.duration, fps: 30 })),
  frame: async (t) => (await ready).frame(t),
};
ready.catch((err) => { console.error(err); document.title = `ERROR ${err.message}`; });

// Preview: the side on the wall clock, like the stream; a click plays the side's audio in step.
if (!rendering) ready.then(({ side, frame }) => {
  const pos = () => (Date.now() / 1000) % side.duration;
  let busy = false;
  const loop = () => { requestAnimationFrame(loop); if (busy) return; busy = true; frame(pos()).finally(() => { busy = false; }); };
  loop();
  const hint = Object.assign(document.createElement('div'), { className: 'hint', textContent: 'Click for sound' });
  document.body.append(hint);
  addEventListener('click', () => {
    const a = new Audio(`/sides/${id}/program.m4a`);
    a.currentTime = pos(); a.play(); hint.remove();
    setInterval(() => { if (Math.abs(a.currentTime - pos()) > 0.5) a.currentTime = pos(); }, 5000);
  }, { once: true });
});
