/** Fixed pool; emit returns false when full. Position units and lifetime seconds. */
export class ParticlePool {
  constructor(capacity = 256) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 256) throw new RangeError('Capacity must be 1–256');
    this.items = Array.from({ length: capacity }, () => ({ life: 0 }));
  }
  emit({ x = 0, y = 0, vx = 0, vy = 0, gravity = 0, life = 0.5, size = 1, color = '#fff' } = {}) {
    const p = this.items.find(p => p.life <= 0);
    if (!p) return false;
    Object.assign(p, { x, y, vx, vy, gravity, life, duration: life, size, color }); return true;
  }
  update(dt) {
    for (const p of this.items) if (p.life > 0) {
      p.life = Math.max(0, p.life - dt); p.vy += p.gravity * dt; p.x += p.vx * dt; p.y += p.vy * dt;
    }
  }
  draw(ctx) {
    ctx.save();
    for (const p of this.items) if (p.life > 0) {
      ctx.globalAlpha = p.life / p.duration; ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.restore();
  }
  clear() { for (const p of this.items) p.life = 0; }
}
