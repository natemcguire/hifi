import { pixelCanvas, sheetFrame, blit } from './sprites.js';
/** Construct with new TileLayer(canvas, sheetImg, tileW, tileH[, {scale}]). */
export class TileLayer {
  constructor(canvas, sheetImg, tileW, tileH, { scale = 1 } = {}) {
    if (![tileW, tileH].every(n => Number.isInteger(n) && n > 0)) throw new RangeError('Invalid tile size');
    this.ctx = pixelCanvas(canvas, scale); this.sheet = sheetImg;
    this.tileW = tileW; this.tileH = tileH;
    this.cols = Math.floor(canvas.width / tileW); this.rows = Math.floor(canvas.height / tileH);
    this.cells = new Int32Array(this.cols * this.rows).fill(-1); this.dirty = new Set();
  }
  set(col, row, spriteIndex) {
    if (!Number.isInteger(col) || !Number.isInteger(row) || col < 0 || row < 0 || col >= this.cols || row >= this.rows) throw new RangeError('Cell outside layer');
    if (!Number.isInteger(spriteIndex) || spriteIndex < -1) throw new RangeError('Invalid sprite index');
    const index = row * this.cols + col;
    if (this.cells[index] !== spriteIndex) { this.cells[index] = spriteIndex; this.dirty.add(index); }
  }
  flush() {
    const count = this.dirty.size;
    for (const index of this.dirty) {
      const x = index % this.cols * this.tileW, y = Math.floor(index / this.cols) * this.tileH;
      this.ctx.clearRect(x, y, this.tileW, this.tileH);
      if (this.cells[index] >= 0) blit(this.ctx, this.sheet, sheetFrame(this.sheet, this.tileW, this.tileH, this.cells[index]), x, y);
    }
    this.dirty.clear(); return count;
  }
}
