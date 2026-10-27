/** Tracks have {src, duration} in seconds; epoch/now are Unix milliseconds. */
export function rotationAt(tracks, epoch, now = Date.now()) {
  if (!tracks.length || !tracks.every(t => Number.isFinite(t.duration) && t.duration > 0) ||
      !Number.isFinite(epoch) || !Number.isFinite(now)) throw new RangeError('Invalid rotation');
  const total = tracks.reduce((sum, t) => sum + t.duration, 0);
  let position = (((now - epoch) / 1000) % total + total) % total;
  for (let index = 0; index < tracks.length; index++) {
    if (position < tracks[index].duration || index === tracks.length - 1) return {
      index, track: tracks[index], offset: position,
      next: tracks[(index + 1) % tracks.length], remaining: tracks[index].duration - position,
    };
    position -= tracks[index].duration;
  }
}
/** Preloads only; consumer owns playback, seeking, and radio transition policy. */
export function createScheduler(tracks, epoch, { preload = new Audio() } = {}) {
  preload.crossOrigin = 'anonymous'; preload.preload = 'auto';
  let nextURL;
  return {
    at(now = Date.now()) {
      const state = rotationAt(tracks, epoch, now);
      if (state.next.src !== nextURL) { nextURL = state.next.src; preload.src = nextURL; preload.load(); }
      return state;
    },
    destroy() { preload.removeAttribute('src'); preload.load(); },
  };
}
