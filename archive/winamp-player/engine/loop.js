/** Pure accumulator. Seconds throughout; excess whole ticks are discarded. */
export function createAccumulator({ dt = 1 / 120, maxTicks = 5, substeps = 1 } = {}) {
  if (!(dt > 0 && Number.isFinite(dt)) || !Number.isInteger(maxTicks) || maxTicks < 1 ||
      !Number.isInteger(substeps) || substeps < 1) throw new RangeError('Invalid timestep options');
  let remainder = 0;
  return {
    reset() { remainder = 0; },
    advance(seconds, update) {
      if (!Number.isFinite(seconds) || seconds < 0) throw new RangeError('Invalid elapsed time');
      const total = remainder + seconds;
      const available = Math.floor((total + dt * 1e-10) / dt);
      const ticks = Math.min(available, maxTicks);
      remainder = Math.max(0, total - available * dt);
      for (let tick = 0; tick < ticks; tick++) {
        for (let substep = 0; substep < substeps; substep++) update(dt / substeps, substep);
      }
      return { ticks, alpha: remainder / dt, dropped: (available - ticks) * dt };
    },
  };
}
/** No rAF until start(); explicit pause survives visibility changes. */
export function createLoop({ update, render = () => {}, ...options }) {
  const accumulator = createAccumulator(options);
  let running = false, paused = false, previous = null, request = null;
  const active = () => running && !paused && !document.hidden;
  function sync() {
    if (request !== null) cancelAnimationFrame(request);
    request = null;
    previous = null;
    accumulator.reset();
    if (active()) request = requestAnimationFrame(frame);
  }
  function frame(now) {
    request = null;
    if (!active()) return;
    const result = accumulator.advance(previous === null ? 0 : (now - previous) / 1000, update);
    previous = now;
    render(result.alpha);
    if (active() && request === null) request = requestAnimationFrame(frame);
  }
  document.addEventListener('visibilitychange', sync);
  return {
    start() { running = true; sync(); },
    stop() { running = false; sync(); },
    pause() { paused = true; sync(); },
    resume() { paused = false; sync(); },
    get paused() { return paused || document.hidden; },
    destroy() { running = false; sync(); document.removeEventListener('visibilitychange', sync); },
  };
}
