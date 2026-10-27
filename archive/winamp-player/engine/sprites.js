export function pixelCanvas(canvas, scale = 1) {
  if (!Number.isInteger(scale) || scale < 1) throw new RangeError('Scale must be a positive integer');
  canvas.style.imageRendering = 'pixelated';
  canvas.style.width = `${canvas.width * scale}px`;
  canvas.style.height = `${canvas.height * scale}px`;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return ctx;
}
export function sheetFrame(sheet, width, height, index) {
  const columns = Math.floor(sheet.width / width);
  return { x: (index % columns) * width, y: Math.floor(index / columns) * height, width, height };
}
export function blit(ctx, sheet, frame, x, y, width = frame.width, height = frame.height) {
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(sheet, frame.x, frame.y, frame.width, frame.height, x, y, width, height);
}
/** Paint once; use returned canvas as an ordinary sheet in SpriteLayer. */
export function cacheLayer(width, height, paint) {
  const canvas = document.createElement('canvas');
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  paint(ctx);
  return canvas;
}
function bounds(s) {
  const w = s.frame.width * s.scale, h = s.frame.height * s.scale;
  const c = Math.cos(s.rotation), t = Math.sin(s.rotation);
  const corners = [[0, 0], [w, 0], [0, h], [w, h]].map(([x, y]) => {
    x -= s.offsetX * s.scale; y -= s.offsetY * s.scale;
    return [s.x + x * c - y * t, s.y + x * t + y * c];
  });
  const xs = corners.map(p => p[0]), ys = corners.map(p => p[1]);
  const x = Math.floor(Math.min(...xs)) - 1, y = Math.floor(Math.min(...ys)) - 1;
  return { x, y, width: Math.ceil(Math.max(...xs)) - x + 1, height: Math.ceil(Math.max(...ys)) - y + 1 };
}
/** Flat ordered sprites. set/remove invalidate old AND new bounds; flush clips repaint. */
export class SpriteLayer {
  constructor(canvas, { scale = 1 } = {}) {
    this.canvas = canvas; this.ctx = pixelCanvas(canvas, scale);
    this.sprites = new Map(); this.dirty = [];
  }
  set(id, patch) {
    const old = this.sprites.get(id);
    if (old) this.dirty.push(bounds(old));
    const sprite = { x: 0, y: 0, offsetX: 0, offsetY: 0, scale: 1, rotation: 0, layer: 0, alpha: 1, ...old, ...patch };
    this.sprites.set(id, sprite); this.dirty.push(bounds(sprite));
    return sprite;
  }
  remove(id) {
    const old = this.sprites.get(id);
    if (old) { this.dirty.push(bounds(old)); this.sprites.delete(id); }
  }
  invalidate() { this.dirty.push({ x: 0, y: 0, width: this.canvas.width, height: this.canvas.height }); }
  flush() {
    if (!this.dirty.length) return 0;
    const ctx = this.ctx, count = this.dirty.length;
    ctx.save(); ctx.beginPath();
    for (const r of this.dirty) ctx.rect(r.x, r.y, r.width, r.height);
    ctx.clip(); ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const s of [...this.sprites.values()].sort((a, b) => a.layer - b.layer)) {
      ctx.save(); ctx.translate(s.x, s.y); ctx.rotate(s.rotation); ctx.scale(s.scale, s.scale);
      ctx.globalAlpha = s.alpha;
      blit(ctx, s.sheet, s.frame, -s.offsetX, -s.offsetY);
      ctx.restore();
    }
    ctx.restore(); this.dirty.length = 0;
    return count;
  }
}
/** Attach to a positioned parent; move a card stack by transforming its parent. */
export function domSprite(sheetURL, frame, { element = document.createElement('div'), duration = 120 } = {}) {
  Object.assign(element.style, { position: 'absolute', imageRendering: 'pixelated',
    backgroundImage: `url("${sheetURL}")`, backgroundRepeat: 'no-repeat',
    transition: `transform ${duration}ms ease`, transformStyle: 'preserve-3d' });
  const api = {
    element,
    frame(f) { Object.assign(element.style, { width: `${f.width}px`, height: `${f.height}px`, backgroundPosition: `${-f.x}px ${-f.y}px` }); },
    move(x, y, { flip = false, scale = 1 } = {}) { element.style.transform = `translate(${x}px, ${y}px) scale(${scale}) rotateY(${flip ? 180 : 0}deg)`; },
  };
  api.frame(frame); return api;
}
/** Targets: {rect:{x,y,width,height}, ...}; first wins ties, null for no overlap. */
export function largestOverlap(rect, targets) {
  let best = null, area = 0;
  for (const target of targets) {
    const b = target.rect;
    const overlap = Math.max(0, Math.min(rect.x + rect.width, b.x + b.width) - Math.max(rect.x, b.x)) *
      Math.max(0, Math.min(rect.y + rect.height, b.y + b.height) - Math.max(rect.y, b.y));
    if (overlap > area) { area = overlap; best = target; }
  }
  return best;
}
