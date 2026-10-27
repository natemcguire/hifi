let shared;
/** Lazy singleton; importing this file creates no context or listeners. */
export function getAudio() {
  if (shared) return shared;
  // Opt into media playback on iPhone; an unavailable session API is optional.
  try { if ('audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch {}
  const Context = window.AudioContext || window.webkitAudioContext;
  if (!Context) throw Error('Web Audio is unavailable');
  const context = new Context();
  const master = context.createGain(); master.connect(context.destination);
  const analyser = context.createAnalyser(); analyser.fftSize = 256; analyser.connect(master);
  const samples = new Map(), elements = new WeakMap();
  let noise;
  const api = {
    context, master, analyser,
    unlock() {
      try { if ('audioSession' in navigator) navigator.audioSession.type = 'playback'; } catch {}
      // Both operations happen synchronously inside the click/touchend gesture.
      const resumed = context.resume();
      const primer = context.createBufferSource();
      primer.buffer = context.createBuffer(1, 1, context.sampleRate);
      primer.connect(context.destination);
      primer.onended = () => primer.disconnect();
      primer.start(0);
      return resumed;
    },
    volume(value) { master.gain.setValueAtTime(Math.max(0, Math.min(1, value)), context.currentTime); },
    async loadSample(name, url) {
      if (!samples.has(name)) samples.set(name, fetch(url).then(r => {
        if (!r.ok) throw Error(`Sample fetch failed: ${r.status}`);
        return r.arrayBuffer();
      }).then(data => context.decodeAudioData(data)).catch(error => { samples.delete(name); throw error; }));
      return samples.get(name);
    },
    async playSample(name, { gain = 0.3, loop = false } = {}) {
      if (!samples.has(name)) throw Error(`Unknown sample: ${name}`);
      const buffer = await samples.get(name);
      const source = context.createBufferSource(), level = context.createGain();
      source.buffer = buffer; source.loop = loop; level.gain.value = gain;
      source.connect(level); level.connect(analyser);
      source.onended = () => { source.disconnect(); level.disconnect(); };
      source.start(); return source;
    },
    tone({ frequency = 440, endFrequency = frequency, duration = 0.1, gain = 0.1, type = 'square', delay = 0 } = {}) {
      const start = context.currentTime + delay, envelope = context.createGain();
      let source;
      if (type === 'noise') {
        if (!noise) {
          noise = context.createBuffer(1, context.sampleRate, context.sampleRate);
          const data = noise.getChannelData(0);
          for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        }
        source = context.createBufferSource(); source.buffer = noise; source.loop = true;
      } else {
        source = context.createOscillator(); source.type = 'square';
        source.frequency.setValueAtTime(frequency, start);
        source.frequency.linearRampToValueAtTime(endFrequency, start + duration);
      }
      envelope.gain.setValueAtTime(0, start);
      envelope.gain.linearRampToValueAtTime(gain, start + Math.min(0.005, duration / 2));
      envelope.gain.linearRampToValueAtTime(0, start + duration);
      source.connect(envelope); envelope.connect(analyser);
      source.onended = () => { source.disconnect(); envelope.disconnect(); };
      source.start(start); source.stop(start + duration); return source;
    },
    /** Set crossOrigin='anonymous' BEFORE assigning remote src; server must allow CORS. */
    connectElement(element, { frequencies = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000] } = {}) {
      if (elements.has(element)) return elements.get(element);
      const source = context.createMediaElementSource(element), preamp = context.createGain();
      const filters = frequencies.map(frequency => {
        const filter = context.createBiquadFilter(); filter.type = 'peaking'; filter.frequency.value = frequency; filter.Q.value = 1;
        return filter;
      });
      const pan = context.createStereoPanner(), tap = context.createAnalyser(); tap.fftSize = 256;
      let tail = source;
      for (const node of [preamp, ...filters, pan, tap]) { tail.connect(node); tail = node; }
      tap.connect(master);
      const graph = { source, preamp, filters, pan, analyser: tap };
      elements.set(element, graph); return graph;
    },
  };
  shared = api; return api;
}
/** Retain gesture recovery after interruptions; importing still creates no audio. */
export function installAudioUnlock(target = document, enabled = () => true) {
  const events = ['click', 'touchend', 'keydown'];
  function unlock(event) {
    if (!enabled(event)) return;
    try { const audio = getAudio(); if (audio.context.state !== 'running') void audio.unlock().catch(() => {}); } catch {}
  }
  for (const event of events) target.addEventListener(event, unlock, { passive: true });
  return () => { for (const event of events) target.removeEventListener(event, unlock); };
}
const tones = {
  reveal: [600, 900, 0.04], flag: [330, 660, 0.08], boom: [70, 30, 0.3, 'noise'],
  win: [523, 1046, 0.35], tick: [1200, 800, 0.025],
  flipperUp: [120, 240, 0.045], flipperDown: [160, 70, 0.045], bumper: [180, 720, 0.12],
  sling: [100, 400, 0.07], spinner: [1400, 900, 0.025], drop: [400, 150, 0.08],
  saucerLock: [600, 200, 0.18], saucerKick: [200, 900, 0.12], drain: [300, 40, 0.4], mission: [440, 1320, 0.5],
};
export function blip(name) {
  if (!tones[name]) throw new RangeError(`Unknown blip: ${name}`);
  const [frequency, endFrequency, duration, type = 'square'] = tones[name];
  return getAudio().tone({ frequency, endFrequency, duration, type });
}
