// HIFI TV: procedural VHS "music videos" for the Synth Sounds stations.
// Every frame is drawn here from canvas primitives. Motion follows the real
// AnalyserNode data the receiver passes in; nothing moves to the beat unless
// sound is actually playing. No video files and no third-party footage.

const W = 480, H = 360;
const VHS = '"VCR OSD Mono", "Lucida Console", "Courier New", monospace';
const MONO = '"Lucida Console", "Courier New", monospace';
const SANS = 'Helvetica, Arial, sans-serif';
const TAU = Math.PI * 2;

// Each station is a different tape: its own era, timestamp and set of shots.
const ERA = {
  'night-build': { date: 'OCT. 5 1988', minutes: 3 * 60 + 14 },
  'dial-up': { date: 'MAR. 9 1996', minutes: 22 * 60 + 41 },
  'shareware-summer': { date: 'JUL. 4 1994', minutes: 16 * 60 + 20 },
  'pixel-drift': { date: 'NOV. 2 1985', minutes: 23 * 60 + 5 },
};

function hash(n) {
  n = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b); n ^= n >>> 13;
  n = Math.imul(n, 0xc2b2ae35); n ^= n >>> 16;
  return (n >>> 0) / 4294967296;
}
function seedOf(text) {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
}
function rr(c, x, y, w, h, r) {
  c.beginPath(); c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath();
}
function glow(c, x, y, r, rgb, alpha) {
  if (alpha <= 0) return;
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${alpha})`); g.addColorStop(1, `rgba(${rgb},0)`);
  c.fillStyle = g; c.fillRect(x - r, y - r, r * 2, r * 2);
}
function vgrad(c, y0, y1, stops) {
  const g = c.createLinearGradient(0, y0, 0, y1);
  stops.forEach((s, i) => g.addColorStop(i / (stops.length - 1), s));
  return g;
}

// ---------- audio levels (from the real analyser) ----------
function createLevels() {
  return { bass: 0, mid: 0, high: 0, level: 0, beat: 0, beats: 0, avgBass: 0, cool: 0,
    history: new Float32Array(72), histPos: 0, histT: 0 };
}
function updateLevels(L, samples, dt, live) {
  const ease = (cur, v, up, down) => cur + (v - cur) * Math.min(1, (v > cur ? up : down) * dt);
  let bass = 0, mid = 0, high = 0;
  if (live) {
    const avg = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += samples[i]; return s / ((b - a) * 255); };
    bass = avg(0, 6); mid = avg(6, 40); high = avg(40, 100);
  }
  L.bass = ease(L.bass, bass, 20, 6); L.mid = ease(L.mid, mid, 14, 5); L.high = ease(L.high, high, 18, 6);
  L.level = L.bass * 0.5 + L.mid * 0.35 + L.high * 0.15;
  L.avgBass += (bass - L.avgBass) * Math.min(1, dt * 1.5);
  L.cool -= dt;
  if (live && bass > L.avgBass * 1.15 + 0.03 && L.cool <= 0) { L.beat = 1; L.cool = 0.24; L.beats++; }
  L.beat = Math.max(0, L.beat - dt * 4);
  L.histT += dt;
  if (L.histT >= 0.15) { L.histT = 0; L.history[L.histPos] = L.level; L.histPos = (L.histPos + 1) % L.history.length; }
}
// Oldest-to-newest history sample i of n.
function hist(L, i, n) {
  const len = L.history.length, k = Math.floor(i / n * len);
  return L.history[(L.histPos + k) % len];
}

// ---------- shared props ----------
function crtBox(c, x, y, w, h, beige = '#d8d0b8') {
  rr(c, x, y, w, h, 10); c.fillStyle = beige; c.fill();
  c.strokeStyle = 'rgba(0,0,0,0.45)'; c.lineWidth = 2; c.stroke();
  c.fillStyle = 'rgba(255,255,255,0.18)'; c.fillRect(x + 8, y + 4, w - 16, 3);
  const sx = x + w * 0.09, sy = y + h * 0.1, sw = w * 0.82, sh = h * 0.7;
  rr(c, sx - 4, sy - 4, sw + 8, sh + 8, 8); c.fillStyle = '#5d5747'; c.fill();
  return { sx, sy, sw, sh };
}
function screenGlass(c, sx, sy, sw, sh) {
  const g = c.createRadialGradient(sx + sw * 0.35, sy + sh * 0.3, 2, sx + sw / 2, sy + sh / 2, sw * 0.75);
  g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(0.6, 'rgba(255,255,255,0)'); g.addColorStop(1, 'rgba(0,0,0,0.45)');
  rr(c, sx, sy, sw, sh, 8); c.fillStyle = g; c.fill();
}
// A Lotus-style worksheet whose numbers tick over on real beats and whose
// bar column is the live spectrum.
function worksheet(c, x, y, w, h, s, size) {
  const { L, seed, samples } = s;
  c.save(); rr(c, x, y, w, h, 8); c.clip();
  c.fillStyle = '#04201d'; c.fillRect(x, y, w, h);
  const ink = '#5ff2d6', dim = '#2a8f80';
  c.font = `${size}px ${MONO}`; c.textBaseline = 'top';
  const lh = size + 3, cols = Math.max(3, Math.floor((w - 30) / (size * 6)));
  c.fillStyle = ink; c.fillRect(x, y, w, lh + 2);
  c.fillStyle = '#04201d'; c.fillText(` NIGHTBLD.WK1   ${'ABCDEFG'.slice(0, cols).split('').join('      ')}`, x + 2, y + 2);
  const rows = Math.floor((h - lh * 3) / lh);
  for (let r = 0; r < rows; r++) {
    const ry = y + (r + 1.3) * lh;
    c.fillStyle = dim; c.fillText(String(r + 1).padStart(3, ' '), x + 2, ry);
    for (let col = 0; col < cols - 1; col++) {
      const v = Math.floor(hash(seed + r * 31 + col * 7 + Math.floor(L.beats / (1 + (col % 3)))) * 99999);
      c.fillStyle = (r + col + L.beats) % 11 === 0 ? '#ffffff' : ink;
      c.fillText(String(v).padStart(6, ' '), x + 28 + col * size * 6, ry);
    }
    // Last column: a block bar graph of the live spectrum.
    const bin = samples ? samples[2 + r * 3] / 255 : 0;
    c.fillStyle = ink;
    c.fillRect(x + 28 + (cols - 1) * size * 6, ry + 2, Math.max(1, bin * size * 6), size - 3);
  }
  const by = y + h - lh - 2;
  c.fillStyle = ink; c.fillRect(x, by, w, lh + 2);
  c.fillStyle = '#04201d';
  c.fillText(` READY   BUILD ${1988}.${String(L.beats % 1000).padStart(3, '0')} ${Math.floor(s.T * 2) % 2 ? 'OK' : '  '}`, x + 2, by + 2);
  c.restore();
}

// ---------- NIGHT BUILD: the 1988 night shift ----------
function nightGuy(c, cx, s, { sip = true } = {}) {
  const { L, t, T, calm } = s;
  const breathe = calm ? 0 : Math.sin(T * 1.6) * 1.5;
  const sipPhase = sip ? (T % 9) / 9 : 1; // lifts the mug every nine seconds
  const lift = sip && sipPhase > 0.55 && sipPhase < 0.85 ? Math.sin((sipPhase - 0.55) / 0.3 * Math.PI) : 0;
  // shirt
  c.fillStyle = vgrad(c, 210, 360, ['#f3f1ea', '#d8d5cb']);
  c.beginPath(); c.moveTo(cx - 140, 360); c.bezierCurveTo(cx - 135, 260, cx - 90, 225 + breathe, cx - 20, 222 + breathe);
  c.lineTo(cx + 60, 222 + breathe); c.bezierCurveTo(cx + 130, 225 + breathe, cx + 165, 260, cx + 170, 360); c.closePath(); c.fill();
  c.strokeStyle = 'rgba(120,115,100,0.5)'; c.lineWidth = 2;
  c.beginPath(); c.moveTo(cx - 95, 290); c.quadraticCurveTo(cx - 80, 320, cx - 88, 360); c.stroke();
  // neck
  c.fillStyle = '#c98e6c'; c.fillRect(cx - 4, 182, 48, 46);
  // collar
  c.fillStyle = '#fbfaf5';
  c.beginPath(); c.moveTo(cx - 8, 214 + breathe); c.lineTo(cx + 20, 246); c.lineTo(cx - 26, 238); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(cx + 52, 214 + breathe); c.lineTo(cx + 20, 246); c.lineTo(cx + 66, 238); c.closePath(); c.fill();
  // the tie, with a line graph of the music running down it
  tie(c, cx + 20, 238, 32, 360 - 238, s);
  // head
  const hx = cx + 20, hy = 128 + breathe * 0.5;
  c.fillStyle = '#d99b77'; c.beginPath(); c.ellipse(hx - 50, hy + 8, 9, 15, 0, 0, TAU); c.fill();
  c.beginPath(); c.ellipse(hx + 50, hy + 8, 9, 15, 0, 0, TAU); c.fill();
  c.fillStyle = vgrad(c, hy - 60, hy + 66, ['#e8b08b', '#d4936d']);
  c.beginPath(); c.ellipse(hx, hy, 50, 64, 0, 0, TAU); c.fill();
  // curly hair
  c.fillStyle = '#5b3a22';
  for (let i = 0; i < 13; i++) {
    const a = Math.PI * (1.05 + i / 12 * 0.9);
    c.beginPath(); c.arc(hx + Math.cos(a) * 46, hy - 26 + Math.sin(a) * 40, 13 + (i % 3) * 2, 0, TAU); c.fill();
  }
  c.beginPath(); c.ellipse(hx, hy - 52, 44, 18, 0, 0, TAU); c.fill();
  // brows + deadpan eyes
  c.fillStyle = '#4a2e1a'; c.fillRect(hx - 34, hy - 16, 24, 5); c.fillRect(hx + 10, hy - 16, 24, 5);
  for (const ex of [hx - 22, hx + 22]) {
    c.fillStyle = '#f6efe6'; c.beginPath(); c.ellipse(ex, hy - 2, 10, 6, 0, 0, TAU); c.fill();
    c.fillStyle = '#6f93b5'; c.beginPath(); c.arc(ex + 1, hy - 1, 4.2, 0, TAU); c.fill();
    c.fillStyle = '#111'; c.beginPath(); c.arc(ex + 1, hy - 1, 2, 0, TAU); c.fill();
    c.fillStyle = '#d4936d'; c.fillRect(ex - 11, hy - 9, 22, 5); // heavy lids
  }
  // nose
  c.strokeStyle = '#a8694a'; c.lineWidth = 2.5;
  c.beginPath(); c.moveTo(hx + 2, hy); c.quadraticCurveTo(hx + 10, hy + 18, hx, hy + 22); c.stroke();
  // the mustache
  c.fillStyle = '#6b4226';
  c.beginPath(); c.moveTo(hx - 32, hy + 40);
  c.bezierCurveTo(hx - 26, hy + 22, hx - 8, hy + 24, hx, hy + 30);
  c.bezierCurveTo(hx + 8, hy + 24, hx + 26, hy + 22, hx + 32, hy + 40);
  c.bezierCurveTo(hx + 16, hy + 36, hx + 6, hy + 40, hx, hy + 37);
  c.bezierCurveTo(hx - 6, hy + 40, hx - 16, hy + 36, hx - 32, hy + 40); c.fill();
  c.strokeStyle = '#8a5a3c'; c.lineWidth = 2; c.beginPath(); c.moveTo(hx - 10, hy + 48); c.lineTo(hx + 10, hy + 48); c.stroke();
  // coffee: arm, hand and mug, raised for a sip on a slow cycle
  const my = 300 - lift * 118, mx = cx - 72 + lift * 46;
  c.strokeStyle = '#e9e6dd'; c.lineWidth = 34; c.lineCap = 'round';
  c.beginPath(); c.moveTo(cx - 118, 300); c.quadraticCurveTo(cx - 130, my + 50, mx - 6, my + 20); c.stroke();
  c.lineCap = 'butt';
  c.fillStyle = '#d4936d'; c.beginPath(); c.ellipse(mx - 2, my + 16, 15, 12, 0, 0, TAU); c.fill();
  mug(c, mx + 4, my - 6, s);
  if (!lift) steam(c, mx + 16, my - 10, s);
}
function mug(c, x, y, s) {
  c.fillStyle = '#efe9db'; rr(c, x - 4, y - 2, 40, 38, 6); c.fill();
  c.strokeStyle = '#efe9db'; c.lineWidth = 6; c.beginPath(); c.arc(x + 38, y + 16, 9, -1.2, 1.2); c.stroke();
  c.fillStyle = '#2b170d'; c.beginPath(); c.ellipse(x + 16, y, 18, 5, 0, 0, TAU); c.fill();
  c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(x + 22, y + 2, 12, 32);
}
function steam(c, x, y, s) {
  c.strokeStyle = 'rgba(255,255,255,0.25)'; c.lineWidth = 3;
  for (let k = 0; k < 3; k++) {
    c.beginPath();
    for (let i = 0; i < 12; i++) {
      const py = y - i * 5, px = x + k * 9 + Math.sin(s.T * 2 + i * 0.6 + k) * 4;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
  }
}
// The tie: navy silk, a knot, and a little stock chart of the last ten seconds
// of music repeated down the blade.
function tie(c, x, y, wTop, len, s) {
  const { L } = s, wBot = wTop * 1.7;
  c.save();
  c.fillStyle = '#7a1f2b';
  c.beginPath(); c.moveTo(x - 13, y - 22); c.lineTo(x + 13, y - 22); c.lineTo(x + 9, y + 4); c.lineTo(x - 9, y + 4); c.closePath(); c.fill();
  c.beginPath(); c.moveTo(x - wTop / 2, y); c.lineTo(x + wTop / 2, y); c.lineTo(x + wBot / 2, y + len); c.lineTo(x - wBot / 2, y + len); c.closePath();
  c.fillStyle = '#1d2a55'; c.fill(); c.clip();
  c.strokeStyle = 'rgba(160,190,255,0.18)'; c.lineWidth = 1;
  for (let gy = y; gy < y + len; gy += 9) { c.beginPath(); c.moveTo(x - wBot, gy); c.lineTo(x + wBot, gy); c.stroke(); }
  const panels = 3, ph = len / panels;
  for (let p = 0; p < panels; p++) {
    const top = y + p * ph + 6, half = (wTop + (wBot - wTop) * ((p + 0.5) / panels)) / 2 - 5;
    c.strokeStyle = p % 2 ? '#ffcc4d' : '#ff5a5f'; c.lineWidth = 2.2;
    c.beginPath();
    for (let i = 0; i <= 14; i++) {
      const px = x - half + i / 14 * half * 2;
      const v = hist(L, Math.floor(i / 14 * 60) + p * 4, 72);
      const py = top + ph - 14 - (i / 14) * (ph * 0.35) - v * ph * 0.5;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
    c.fillStyle = c.strokeStyle; // the arrowhead: up and to the right
    c.beginPath(); c.moveTo(x + half + 2, top + 8); c.lineTo(x + half - 6, top + 9); c.lineTo(x + half, top + 16); c.fill();
  }
  c.restore();
}
function blindsWindow(c, x, y, w, h, s, { clock = false } = {}) {
  const { L, T, seed, calm } = s;
  c.save(); c.beginPath(); c.rect(x, y, w, h); c.clip();
  c.fillStyle = vgrad(c, y, y + h, ['#050a1f', '#132251', '#2c2b5c']); c.fillRect(x, y, w, h);
  c.fillStyle = '#f2ecd2'; c.beginPath(); c.arc(x + w * 0.82, y + h * 0.2, Math.max(6, h * 0.08), 0, TAU); c.fill();
  // skyline
  let bx = x - 4, i = 0;
  while (bx < x + w) {
    const bw = 18 + hash(seed + i * 3) * (w * 0.12), bh = h * (0.25 + hash(seed + i * 5) * 0.5);
    c.fillStyle = '#070912'; c.fillRect(bx, y + h - bh, bw, bh);
    for (let wy = y + h - bh + 6; wy < y + h - 4; wy += 7) for (let wx = bx + 3; wx < bx + bw - 3; wx += 6) {
      const on = hash(seed + Math.floor(wx) * 17 + Math.floor(wy) * 3 + Math.floor(L.beats / 6) * (hash(i) > 0.7 ? 1 : 0)) > 0.72;
      if (on) { c.fillStyle = hash(Math.floor(wx + wy)) > 0.5 ? '#ffd27a' : '#9fd8ff'; c.fillRect(wx, wy, 3, 3); }
    }
    if (hash(seed + i * 11) > 0.6) {
      const blink = calm ? 0.6 : (Math.floor(T * 1.5 + i) % 2 ? 1 : 0.15) * (0.6 + L.beat * 0.4);
      glow(c, bx + bw / 2, y + h - bh - 3, 7, '255,60,60', blink);
    }
    bx += bw + 2; i++;
  }
  // venetian blinds
  for (let sy = y; sy < y + h; sy += Math.max(8, h / 11)) {
    c.fillStyle = 'rgba(214,205,180,0.92)'; c.fillRect(x, sy, w, Math.max(4, h / 26));
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.fillRect(x, sy + Math.max(4, h / 26), w, 1);
  }
  c.restore();
  c.strokeStyle = '#1c140e'; c.lineWidth = 5; c.strokeRect(x, y, w, h);
  if (clock) wallClock(c, x + w + 40, y + 50, 26, s);
}
function wallClock(c, x, y, r, s) {
  const m = (3 * 60 + 14 + s.T / 60) % 720;
  c.fillStyle = '#f1ecdc'; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  c.strokeStyle = '#2a211a'; c.lineWidth = 3; c.stroke();
  c.lineCap = 'round';
  const hand = (a, len, lw) => { c.lineWidth = lw; c.beginPath(); c.moveTo(x, y); c.lineTo(x + Math.sin(a) * len, y - Math.cos(a) * len); c.stroke(); };
  hand(m / 720 * TAU, r * 0.5, 3); hand((m % 60) / 60 * TAU, r * 0.8, 2);
  c.strokeStyle = '#c0392b'; hand((s.T % 60) / 60 * TAU, r * 0.85, 1);
  c.lineCap = 'butt';
}
function woodWall(c) {
  c.fillStyle = vgrad(c, 0, H, ['#2e2219', '#140d08']); c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(0,0,0,0.28)'; for (let x = 0; x < W; x += 36) c.fillRect(x, 0, 2, H);
  c.fillStyle = 'rgba(255,220,180,0.04)'; for (let x = 12; x < W; x += 36) c.fillRect(x, 0, 6, H);
}
const NIGHT_BUILD = [
  function desk(c, s) {
    woodWall(c);
    blindsWindow(c, 250, 14, 210, 118, s);
    c.fillStyle = '#3d2a1c'; c.fillRect(0, 276, W, 84); c.fillStyle = '#5a4030'; c.fillRect(0, 272, W, 6);
    glow(c, 80, 170, 230, '255,190,110', 0.2 + (s.calm ? 0 : s.L.high * 0.06));
    const scr = crtBox(c, 14, 118, 196, 158);
    worksheet(c, scr.sx, scr.sy, scr.sw, scr.sh, s, 7);
    screenGlass(c, scr.sx, scr.sy, scr.sw, scr.sh);
    glow(c, scr.sx + scr.sw / 2, scr.sy + scr.sh / 2, 120, '95,242,214', 0.07 + s.L.level * 0.08);
    // dot-matrix paper and a pen cup
    c.fillStyle = '#f2efe6'; c.fillRect(20, 286, 120, 74);
    c.fillStyle = 'rgba(0,0,0,0.15)'; for (let y = 292; y < 360; y += 6) c.fillRect(28, y, 104, 1);
    c.fillStyle = '#1a1a1a'; c.fillRect(160, 250, 26, 34);
    nightGuy(c, 300, s);
  },
  function screen(c, s) {
    c.fillStyle = '#cfc7ae'; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.12)'; c.fillRect(0, H - 40, W, 40);
    worksheet(c, 30, 24, W - 60, H - 72, s, 12);
    screenGlass(c, 30, 24, W - 60, H - 72);
    if (Math.floor(s.T * 2) % 2) { c.fillStyle = '#5ff2d6'; c.fillRect(70 + (s.L.beats % 5) * 72, 70 + (s.L.beats % 9) * 15, 10, 13); }
  },
  function window(c, s) {
    woodWall(c);
    blindsWindow(c, 40, 24, 300, 300, s, { clock: true });
    c.fillStyle = '#1a120c'; c.fillRect(380, 150, 80, 210);
    c.fillStyle = '#6b5440'; for (let y = 170; y < 350; y += 60) { c.fillRect(388, y, 64, 44); c.fillStyle = '#a58a5f'; c.fillRect(412, y + 18, 16, 5); c.fillStyle = '#6b5440'; }
  },
  function tieShot(c, s) {
    c.fillStyle = vgrad(c, 0, H, ['#f1efe7', '#cfccc2']); c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(0,0,0,0.06)'; for (let x = 0; x < W; x += 6) c.fillRect(x, 0, 1, H);
    c.save(); c.translate(W * 0.42, 0); c.rotate(-0.06);
    c.fillStyle = '#d5d2c8'; for (let y = 60; y < H; y += 70) { c.beginPath(); c.arc(52, y, 5, 0, TAU); c.fill(); }
    tie(c, 0, 26, 92, 380, s);
    c.restore();
    c.fillStyle = '#efe9db'; rr(c, 330, 220, 110, 120, 14); c.fill();
    c.fillStyle = '#2b170d'; c.beginPath(); c.ellipse(385, 222, 52, 12, 0, 0, TAU); c.fill();
    c.strokeStyle = '#efe9db'; c.lineWidth = 14; c.beginPath(); c.arc(442, 270, 24, -1.3, 1.3); c.stroke();
    c.fillStyle = '#1c2a55'; c.font = `bold 15px ${SANS}`; c.textAlign = 'center'; c.fillText('WORLD\'S OKAYEST', 385, 270); c.fillText('NIGHT SHIFT', 385, 290); c.textAlign = 'left';
    steam(c, 370, 210, s); steam(c, 390, 205, s);
  },
];

// ---------- DIAL-UP: a 1996 bedroom online ----------
function modemPanel(c, x, y, w, h, s) {
  const { L, T, calm } = s;
  rr(c, x, y, w, h, 6); c.fillStyle = '#d9d3c3'; c.fill(); c.strokeStyle = '#6d675a'; c.lineWidth = 2; c.stroke();
  c.fillStyle = '#2b2b2b'; c.fillRect(x + 8, y + h * 0.42, w - 16, h * 0.34);
  const labels = ['HS', 'AA', 'CD', 'OH', 'RD', 'SD', 'TR', 'MR'];
  const step = (w - 24) / labels.length;
  labels.forEach((lab, i) => {
    const lx = x + 12 + step * (i + 0.5), ly = y + h * 0.59;
    let on = i < 4 || i > 5;
    if (lab === 'RD') on = calm ? true : L.mid > 0.18 && (L.beats + Math.floor(T * 9)) % 2 === 0;
    if (lab === 'SD') on = calm ? true : L.high > 0.08 && Math.floor(T * 13) % 3 !== 0;
    glow(c, lx, ly, step * 0.45, '255,70,50', on ? 0.6 : 0);
    c.fillStyle = on ? '#ff5a43' : '#5a1d17'; c.beginPath(); c.arc(lx, ly, Math.max(2.5, step * 0.12), 0, TAU); c.fill();
    c.fillStyle = '#d9d3c3'; c.font = `bold ${Math.max(7, step * 0.24)}px ${SANS}`; c.textAlign = 'center';
    c.fillText(lab, lx, y + h * 0.36);
  });
  c.textAlign = 'left';
  c.fillStyle = '#4b4639'; c.font = `bold ${Math.max(8, h * 0.13)}px ${SANS}`; c.fillText('SPORTSTER 56K', x + 10, y + h * 0.92);
}
function win95Window(c, x, y, w, h, title) {
  c.fillStyle = '#c0c0c0'; c.fillRect(x, y, w, h);
  c.fillStyle = '#fff'; c.fillRect(x, y, w, 2); c.fillRect(x, y, 2, h);
  c.fillStyle = '#404040'; c.fillRect(x, y + h - 2, w, 2); c.fillRect(x + w - 2, y, 2, h);
  const g = c.createLinearGradient(x, 0, x + w, 0); g.addColorStop(0, '#000080'); g.addColorStop(1, '#1084d0');
  c.fillStyle = g; c.fillRect(x + 3, y + 3, w - 6, 16);
  c.fillStyle = '#fff'; c.font = `bold 11px ${SANS}`; c.fillText(title, x + 8, y + 15);
}
const DIAL_UP = [
  function bedroom(c, s) {
    const { t } = s;
    c.fillStyle = vgrad(c, 0, H, ['#2f7f80', '#1d5556']); c.fillRect(0, 0, W, H);
    c.fillStyle = '#ffd400'; c.save(); c.translate(400, 70); c.rotate(0.08); c.fillRect(-46, -36, 92, 72);
    c.fillStyle = '#000'; c.font = `bold 13px ${SANS}`; c.textAlign = 'center'; c.fillText('THE', 0, -12); c.fillText('INFORMATION', 0, 4); c.fillText('SUPERHIGHWAY', 0, 20); c.restore(); c.textAlign = 'left';
    c.fillStyle = '#6b4f36'; c.fillRect(0, 268, W, 92); c.fillStyle = '#86664a'; c.fillRect(0, 264, W, 6);
    // tower
    rr(c, 352, 130, 92, 150, 4); c.fillStyle = '#d8d0b8'; c.fill(); c.strokeStyle = '#6d675a'; c.lineWidth = 2; c.stroke();
    c.fillStyle = '#9b9482'; c.fillRect(364, 150, 68, 10); c.fillRect(364, 170, 68, 10); c.fillStyle = '#3cd070'; c.fillRect(368, 250, 6, 4);
    const scr = crtBox(c, 70, 64, 250, 206);
    c.fillStyle = '#008080'; c.fillRect(scr.sx, scr.sy, scr.sw, scr.sh);
    const steps = ['Dialing 555-0156...', 'Verifying user name and password...', 'Logging on to network...', 'Connected at 28,800 bps'];
    const k = Math.min(3, Math.floor(t / 2.4));
    win95Window(c, scr.sx + 18, scr.sy + 30, scr.sw - 36, 96, 'Connect To');
    c.fillStyle = '#000'; c.font = `11px ${SANS}`; c.fillText(steps[k], scr.sx + 30, scr.sy + 70);
    c.fillStyle = '#fff'; c.fillRect(scr.sx + 30, scr.sy + 84, scr.sw - 60, 14);
    c.fillStyle = '#000080'; for (let i = 0; i < Math.min(12, Math.floor(t * 1.4)); i++) c.fillRect(scr.sx + 32 + i * 12, scr.sy + 86, 10, 10);
    screenGlass(c, scr.sx, scr.sy, scr.sw, scr.sh);
    modemPanel(c, 34, 290, 170, 52, s);
    // coiled phone cord
    c.strokeStyle = '#e8e2cf'; c.lineWidth = 3; c.beginPath();
    for (let i = 0; i < 40; i++) { const px = 210 + i * 3.2, py = 316 + Math.sin(i * 1.4) * 6; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke();
    c.fillStyle = '#e8e2cf'; rr(c, 340, 296, 96, 40, 8); c.fill();
  },
  function handshake(c, s) {
    c.fillStyle = '#0b0f0b'; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(80,255,120,0.12)'; c.lineWidth = 1;
    for (let x = 0; x <= W; x += 40) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, 220); c.stroke(); }
    for (let y = 0; y <= 220; y += 40) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    // the actual waveform, drawn as line noise on the scope
    const wave = s.waveform;
    c.strokeStyle = '#59ff7a'; c.lineWidth = 2.5; c.shadowColor = '#59ff7a'; c.shadowBlur = 8; c.beginPath();
    for (let i = 0; i < 128; i++) { const v = wave ? (wave[i * 2] - 128) / 128 : 0; const px = i / 127 * W, py = 110 + v * 95; i ? c.lineTo(px, py) : c.moveTo(px, py); }
    c.stroke(); c.shadowBlur = 0;
    c.fillStyle = '#59ff7a'; c.font = `12px ${MONO}`; c.fillText('ATDT 555-0156   CARRIER 28800   PROTOCOL: LAP-M', 12, 210);
    modemPanel(c, 20, 236, W - 40, 110, s);
  },
  function chat(c, s) {
    const { L, seed } = s;
    c.fillStyle = '#d8d0b8'; c.fillRect(0, 0, W, H);
    c.fillStyle = '#008080'; c.fillRect(22, 18, W - 44, H - 52);
    win95Window(c, 40, 32, 300, 270, 'Chat Room: Night Owls');
    c.fillStyle = '#fff'; c.fillRect(48, 54, 284, 210);
    const lines = [
      ['NetSurfer96', 'anyone else still up'], ['xX_n8_Xx', 'a/s/l?'], ['dial_up_dave', 'brb mom needs the phone'],
      ['FloppyQueen', 'this song is so good'], ['Webmaster_Jim', 'my page is under construction'], ['ModemMan', 'lol'],
      ['GeoCitizen', 'sign my guestbook!!'], ['NetSurfer96', 'whats playing'], ['xX_n8_Xx', 'HIFI radio, dial-up station'],
      ['dial_up_dave', 'back. what did i miss'], ['FloppyQueen', '*dances*'], ['ModemMan', 'gtg 28.8 is crawling'],
    ];
    const first = L.beats % lines.length;
    c.font = `11px ${SANS}`;
    for (let i = 0; i < 12; i++) {
      const [who, msg] = lines[(first + i) % lines.length];
      const color = ['#c00000', '#0000c0', '#008000', '#800080'][seedOf(who) % 4];
      c.fillStyle = color; c.font = `bold 11px ${SANS}`; c.fillText(`${who}:`, 54, 70 + i * 16);
      const ww = c.measureText(`${who}: `).width;
      c.fillStyle = '#000'; c.font = `11px ${SANS}`; c.fillText(msg, 54 + ww, 70 + i * 16);
    }
    win95Window(c, 350, 32, 92, 270, 'Buddies');
    c.fillStyle = '#fff'; c.fillRect(356, 54, 80, 242);
    ['NetSurfer96', 'xX_n8_Xx', 'dial_up_dave', 'FloppyQueen', 'ModemMan', 'GeoCitizen'].forEach((b, i) => {
      c.fillStyle = i % 3 === (L.beats % 3) ? '#000080' : '#000'; c.font = `10px ${SANS}`; c.fillText(b, 360, 70 + i * 16);
    });
    screenGlass(c, 22, 18, W - 44, H - 52);
  },
];

// ---------- SHAREWARE SUMMER: poolside, trial version ----------
function poolWater(c, s, x = 0, y = 0, w = W, h = H) {
  const { T, L, calm } = s;
  c.fillStyle = vgrad(c, y, y + h, ['#38d0e3', '#1ba3c4']); c.fillRect(x, y, w, h);
  const speed = calm ? 0.3 : 0.6 + L.mid * 1.2;
  c.strokeStyle = 'rgba(255,255,255,0.32)'; c.lineWidth = 2;
  for (let row = 0; row < 10; row++) {
    c.beginPath();
    for (let i = 0; i <= 24; i++) {
      const px = x + i / 24 * w;
      const py = y + (row + 0.5) * h / 10 + Math.sin(i * 0.9 + T * speed + row) * 8 + Math.sin(i * 0.37 - T * speed * 0.7 + row * 2) * 6;
      i ? c.lineTo(px, py) : c.moveTo(px, py);
    }
    c.stroke();
  }
  if (!calm) for (let i = 0; i < 10; i++) {
    const a = L.high * 1.6 * hash(i + Math.floor(T * 3));
    glow(c, x + hash(i * 7 + Math.floor(T)) * w, y + hash(i * 13 + Math.floor(T)) * h, 14, '255,255,255', Math.min(0.7, a));
  }
}
function floppy(c, x, y, size, rot, label = 'TRIAL') {
  c.save(); c.translate(x, y); c.rotate(rot); const k = size / 100;
  c.fillStyle = '#26262b'; c.fillRect(-50 * k, -50 * k, 100 * k, 100 * k);
  c.fillStyle = '#bfc3c9'; c.fillRect(-26 * k, -50 * k, 52 * k, 32 * k); c.fillStyle = '#26262b'; c.fillRect(8 * k, -45 * k, 10 * k, 22 * k);
  c.fillStyle = '#fff'; c.fillRect(-38 * k, 4 * k, 76 * k, 42 * k);
  c.fillStyle = '#ff5fa2'; c.fillRect(-38 * k, 4 * k, 76 * k, 8 * k);
  c.fillStyle = '#222'; c.font = `bold ${14 * k}px ${SANS}`; c.textAlign = 'center'; c.fillText(label, 0, 34 * k); c.textAlign = 'left';
  c.restore();
}
function ring(c, x, y, r, rot) {
  c.save(); c.translate(x, y); c.rotate(rot);
  c.fillStyle = 'rgba(0,60,80,0.25)'; c.beginPath(); c.arc(6, 8, r, 0, TAU); c.arc(6, 8, r * 0.45, 0, TAU, true); c.fill();
  for (let i = 0; i < 8; i++) {
    c.fillStyle = i % 2 ? '#fff6f0' : '#ff5fa2';
    c.beginPath(); c.arc(0, 0, r, i / 8 * TAU, (i + 1) / 8 * TAU); c.arc(0, 0, r * 0.45, (i + 1) / 8 * TAU, i / 8 * TAU, true); c.closePath(); c.fill();
  }
  c.restore();
}
function palm(c, x, y, h, sway) {
  c.strokeStyle = '#2a0f2e'; c.lineWidth = 8; c.lineCap = 'round';
  c.beginPath(); c.moveTo(x, y); c.quadraticCurveTo(x + 18 + sway * 6, y - h * 0.5, x + 10 + sway * 10, y - h); c.stroke();
  c.fillStyle = '#2a0f2e';
  const tx = x + 10 + sway * 10, ty = y - h;
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI + i / 6 * Math.PI + sway * 0.1;
    c.beginPath(); c.moveTo(tx, ty);
    c.quadraticCurveTo(tx + Math.cos(a) * 50, ty + Math.sin(a) * 40 - 14, tx + Math.cos(a) * 80, ty + Math.sin(a) * 30 + 24);
    c.quadraticCurveTo(tx + Math.cos(a) * 46, ty + Math.sin(a) * 30 + 6, tx, ty); c.fill();
  }
  c.lineCap = 'butt';
}
const SHAREWARE_SUMMER = [
  function pool(c, s) {
    const { T, calm } = s;
    c.fillStyle = '#e9e1cf'; c.fillRect(0, 0, W, H);
    poolWater(c, s, 30, 20, W - 60, H - 40);
    c.strokeStyle = '#ffffff'; c.lineWidth = 6; c.strokeRect(30, 20, W - 60, H - 40);
    c.strokeStyle = '#c6c9cc'; c.lineWidth = 4;
    for (const lx of [W - 70, W - 50]) { c.beginPath(); c.moveTo(lx, 14); c.lineTo(lx, 70); c.stroke(); }
    const drift = calm ? 0 : T;
    ring(c, 150 + Math.sin(drift * 0.3) * 40, 150 + Math.cos(drift * 0.23) * 30, 42, drift * 0.2);
    // a floppy disk taking the afternoon off on a lilo
    const fx = 320 + Math.cos(drift * 0.2) * 30, fy = 230 + Math.sin(drift * 0.27) * 20;
    c.save(); c.translate(fx, fy); c.rotate(0.3 + Math.sin(drift * 0.3) * 0.1);
    c.fillStyle = 'rgba(0,60,80,0.25)'; rr(c, -60, -24, 132, 60, 26); c.fill();
    c.fillStyle = '#ffd23f'; rr(c, -66, -32, 132, 60, 26); c.fill();
    c.fillStyle = '#ffe680'; for (let i = -50; i < 60; i += 22) c.fillRect(i, -28, 8, 52);
    c.restore();
    floppy(c, fx, fy - 6, 40, 0.3 + Math.sin(drift * 0.3) * 0.1, 'SUMMER');
  },
  function sunset(c, s) {
    const { T, L, calm } = s;
    c.fillStyle = vgrad(c, 0, 230, ['#2b0f4c', '#a2286e', '#ff7a59', '#ffcf6b']); c.fillRect(0, 0, W, 230);
    const sunR = 86 + (calm ? 0 : L.bass * 6);
    c.save(); c.beginPath(); c.arc(W / 2, 214, sunR, Math.PI, 0); c.clip();
    c.fillStyle = vgrad(c, 128, 214, ['#fff27a', '#ff6fa8']); c.fillRect(0, 100, W, 130);
    c.fillStyle = '#c3366e';
    for (let i = 0; i < 6; i++) { const y = 150 + i * 12 + (calm ? 0 : (T * 8) % 12); c.fillRect(0, y, W, 2 + i); }
    c.restore();
    c.fillStyle = vgrad(c, 230, H, ['#3b1460', '#14062a']); c.fillRect(0, 230, W, H - 230);
    for (let i = 0; i < 14; i++) {
      const y = 236 + i * 9, wv = calm ? 0 : Math.sin(T * 1.4 + i) * 10;
      c.fillStyle = `rgba(255,${150 + i * 6},120,${0.6 - i * 0.04})`;
      c.fillRect(W / 2 - 60 + i * 2 + wv, y, 120 - i * 4, 2);
    }
    const sway = calm ? 0 : Math.sin(T * 0.8) + L.mid * 0.6;
    palm(c, 70, 330, 190, sway); palm(c, 420, 340, 160, -sway * 0.8);
    c.fillStyle = '#14062a'; c.fillRect(0, 326, W, 34);
  },
  function nag(c, s) {
    const { T, L, calm } = s;
    poolWater(c, s);
    const bob = calm ? 0 : Math.sin(T * 1.2) * 6;
    const x = 80, y = 90 + bob, w = 320, h = 160;
    c.fillStyle = 'rgba(0,50,70,0.3)'; c.fillRect(x + 10, y + 12, w, h);
    win95Window(c, x, y, w, h, 'Shareware Summer - Unregistered');
    c.fillStyle = '#000'; c.font = `13px ${SANS}`;
    c.fillText('Thank you for evaluating SUMMER.EXE!', x + 18, y + 48);
    c.fillText(`Your trial has ${29 - (L.beats % 30)} days left. Relax anyway.`, x + 18, y + 70);
    const pressed = !calm && L.beat > 0.5;
    for (const [label, bx] of [['Register...', x + 40], ['Later', x + 190]]) {
      const down = pressed && label === 'Later';
      c.fillStyle = '#c0c0c0'; c.fillRect(bx, y + 100, 100, 30);
      c.fillStyle = down ? '#404040' : '#fff'; c.fillRect(bx, y + 100, 100, 2); c.fillRect(bx, y + 100, 2, 30);
      c.fillStyle = down ? '#fff' : '#404040'; c.fillRect(bx, y + 128, 100, 2); c.fillRect(bx + 98, y + 100, 2, 30);
      c.fillStyle = '#000'; c.textAlign = 'center'; c.fillText(label, bx + 50 + (down ? 1 : 0), y + 120 + (down ? 1 : 0)); c.textAlign = 'left';
    }
    // the cursor, hovering over Later
    const cx = x + 248, cy = y + 120;
    c.fillStyle = '#fff'; c.strokeStyle = '#000'; c.lineWidth = 1;
    c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx, cy + 18); c.lineTo(cx + 5, cy + 13); c.lineTo(cx + 9, cy + 21); c.lineTo(cx + 12, cy + 20); c.lineTo(cx + 8, cy + 12); c.lineTo(cx + 14, cy + 12); c.closePath(); c.fill(); c.stroke();
  },
];

// ---------- PIXEL DRIFT: the arcade after closing ----------
function drawGame(p, s) {
  // 120x90 pixel playfield, scaled up without smoothing.
  const { T, L, seed, calm } = s;
  p.fillStyle = '#05010f'; p.fillRect(0, 0, 120, 90);
  for (let i = 0; i < 60; i++) {
    const layer = 1 + (i % 3), sp = (calm ? 4 : 10 + L.level * 30) * layer;
    const x = Math.floor((hash(seed + i) * 120 - T * sp) % 120 + 120) % 120, y = Math.floor(hash(seed + i * 9) * 90);
    p.fillStyle = layer === 3 ? '#ffffff' : layer === 2 ? '#8fa8ff' : '#3c4a8a'; p.fillRect(x, y, 1, 1);
  }
  for (let a = 0; a < 3; a++) {
    const x = Math.floor(((hash(seed + a * 5) * 140 - T * (6 + a * 3)) % 140 + 140) % 140) - 10, y = 15 + Math.floor(hash(seed + a * 3) * 60);
    p.fillStyle = '#8a6d5a'; p.fillRect(x, y, 6, 5); p.fillRect(x + 1, y - 1, 4, 7); p.fillStyle = '#5c473a'; p.fillRect(x + 1, y + 1, 2, 2);
  }
  const sy = Math.floor(45 + Math.sin(T * 0.9) * 18), sx = 22;
  p.fillStyle = '#ff3fa4'; p.fillRect(sx - 6, sy - 1, 3, 3);
  if (!calm && L.beat > 0.2) { p.fillStyle = '#ffd23f'; p.fillRect(sx - 9, sy, 3, 1); }
  p.fillStyle = '#e8f1ff'; p.fillRect(sx - 3, sy - 2, 8, 5); p.fillRect(sx + 5, sy - 1, 3, 3); p.fillRect(sx - 1, sy - 4, 3, 2); p.fillRect(sx - 1, sy + 3, 3, 2);
  p.fillStyle = '#4fd6ff'; p.fillRect(sx + 2, sy - 1, 2, 2);
  if (!calm) for (let b = 0; b < 4; b++) { const bx = (Math.floor(T * 90) + b * 30) % 100 + sx + 10; p.fillStyle = '#ffd23f'; p.fillRect(bx, sy, 3, 1); }
  p.fillStyle = '#ffffff'; p.font = '7px monospace'; p.textBaseline = 'top';
  p.fillText(`1UP ${String(L.beats * 50).padStart(6, '0')}`, 2, 1); p.fillText('HI 999950', 72, 1);
}
function neonGrid(c, s, y0 = 190) {
  const { T, L, calm } = s;
  c.fillStyle = vgrad(c, 0, y0, ['#0a0220', '#3a0a52', '#ff3fa4']); c.fillRect(0, 0, W, y0);
  c.fillStyle = '#ffd23f'; c.beginPath(); c.arc(W / 2, y0, 70, Math.PI, 0); c.fill();
  c.fillStyle = '#0a0220';
  for (let i = 0; i < 5; i++) c.fillRect(W / 2 - 80, y0 - 12 - i * 11, 160, 2 + i);
  c.fillStyle = '#12052a';
  c.beginPath(); c.moveTo(0, y0); [[60, 140], [120, 172], [190, 120], [260, 168], [330, 130], [400, 160], [480, 125]].forEach(([x, y]) => c.lineTo(x, y + (y0 - 190))); c.lineTo(W, y0); c.fill();
  c.fillStyle = '#0a0220'; c.fillRect(0, y0, W, H - y0);
  c.strokeStyle = `rgba(255,63,164,${0.55 + (calm ? 0 : L.bass * 0.45)})`; c.lineWidth = 2;
  for (let i = -12; i <= 12; i++) { c.beginPath(); c.moveTo(W / 2 + i * 8, y0); c.lineTo(W / 2 + i * 90, H); c.stroke(); }
  const speed = calm ? 0.2 : 0.5 + L.level * 1.4, phase = (T * speed) % 1;
  for (let k = 0; k < 10; k++) { const z = (k + phase) / 10, y = y0 + (H - y0) * z * z; c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
}
function makePixel() {
  const canvas = document.createElement('canvas'); canvas.width = 120; canvas.height = 90; return canvas;
}
const PIXEL_DRIFT = [
  function cabinet(c, s) {
    const { L, calm } = s;
    c.fillStyle = '#0b0614'; c.fillRect(0, 0, W, H);
    // arcade carpet
    for (let i = 0; i < 80; i++) {
      c.fillStyle = ['#ff3fa4', '#4fd6ff', '#ffd23f', '#7c4dff'][i % 4]; c.globalAlpha = 0.35;
      c.fillRect(hash(i * 3) * W, 300 + hash(i * 7) * 60, 6, 3); c.globalAlpha = 1;
    }
    for (const sx of [40, 380]) { rr(c, sx, 70, 70, 240, 6); c.fillStyle = '#1b1030'; c.fill(); glow(c, sx + 35, 120, 50, '79,214,255', 0.15); }
    rr(c, 130, 20, 220, 320, 8); c.fillStyle = '#231445'; c.fill();
    c.fillStyle = '#ff3fa4'; c.fillRect(130, 20, 8, 320); c.fillRect(342, 20, 8, 320);
    c.fillStyle = '#120a24'; c.fillRect(150, 30, 180, 40);
    glow(c, 240, 50, 120, '255,63,164', 0.25 + (calm ? 0 : L.beat * 0.25));
    c.fillStyle = '#ffd23f'; c.font = `bold 22px ${SANS}`; c.textAlign = 'center'; c.fillText('PIXEL DRIFT', 240, 58); c.textAlign = 'left';
    drawGame(s.pixCtx, s);
    c.save(); c.imageSmoothingEnabled = false; c.drawImage(s.pix, 160, 84, 160, 120); c.restore();
    screenGlass(c, 160, 84, 160, 120);
    c.fillStyle = '#3a2370'; c.fillRect(146, 220, 188, 50);
    c.fillStyle = '#111'; c.beginPath(); c.arc(190, 246, 6, 0, TAU); c.fill(); c.fillRect(188, 228, 4, 18);
    c.fillStyle = '#e03131'; c.beginPath(); c.arc(190, 228, 8, 0, TAU); c.fill();
    [[250, '#ffd23f'], [276, '#4fd6ff'], [302, '#ff3fa4']].forEach(([bx, col], i) => {
      const lit = !calm && L.beats % 3 === i && L.beat > 0.3;
      glow(c, bx, 246, 16, '255,255,255', lit ? 0.5 : 0);
      c.fillStyle = col; c.beginPath(); c.arc(bx, 246, 8, 0, TAU); c.fill();
    });
    c.fillStyle = '#ffd23f'; c.font = `bold 10px ${SANS}`; c.fillText('INSERT COIN', 210, 300);
  },
  function ingame(c, s) {
    drawGame(s.pixCtx, s);
    c.save(); c.imageSmoothingEnabled = false; c.drawImage(s.pix, 0, 0, W, H); c.restore();
  },
  function grid(c, s) {
    neonGrid(c, s);
    drawGame(s.pixCtx, s);
  },
];

const SCENES = { 'night-build': NIGHT_BUILD, 'dial-up': DIAL_UP, 'shareware-summer': SHAREWARE_SUMMER, 'pixel-drift': PIXEL_DRIFT };
export const tvStations = Object.keys(SCENES);

// ---------- the tape: post-processing and on-screen display ----------
function osd(c, text, x, y, align = 'left', size = 18) {
  c.font = `bold ${size}px ${VHS}`; c.textAlign = align; c.textBaseline = 'alphabetic';
  c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillText(text, x + 2, y + 2);
  c.fillStyle = '#f4f4f4'; c.fillText(text, x, y);
  c.textAlign = 'left';
}
function tape(c, s, glitch) {
  const { T, calm } = s;
  c.save();
  c.globalCompositeOperation = 'lighter'; c.globalAlpha = 0.07; c.drawImage(c.canvas, 2, 0, W, H);
  c.globalCompositeOperation = 'source-over'; c.globalAlpha = 1;
  if (glitch > 0 && !calm) {
    for (let i = 0; i < 9; i++) {
      const y = Math.random() * H, h = 3 + Math.random() * 18, dx = (Math.random() - 0.5) * 60 * glitch;
      c.drawImage(c.canvas, 0, y, W, h, dx, y, W, h);
    }
    c.fillStyle = `rgba(255,255,255,${0.15 * glitch})`; c.fillRect(0, 0, W, H);
  }
  if (!calm) {
    const by = (T * 21) % (H + 80) - 40;
    c.fillStyle = 'rgba(255,255,255,0.05)'; c.fillRect(0, by, W, 12);
    for (let i = 0; i < 14; i++) { c.fillStyle = `rgba(255,255,255,${0.1 + Math.random() * 0.2})`; c.fillRect(Math.random() * W, by + Math.random() * 12, 4 + Math.random() * 14, 1); }
    for (let i = 0; i < 30; i++) { c.fillStyle = `rgba(255,255,255,${Math.random() * 0.12})`; c.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1); }
  }
  c.fillStyle = 'rgba(0,0,0,0.14)'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
  const v = c.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.82);
  v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(1, 'rgba(0,0,0,0.5)'); c.fillStyle = v; c.fillRect(0, 0, W, H);
  c.restore();
}
function credits(c, track, station, t) {
  // MTV-style lower third while a track opens.
  const a = Math.min(1, (t - 1.2) * 2, (9 - t) * 2);
  if (a <= 0) return;
  c.save(); c.globalAlpha = a; c.textBaseline = 'alphabetic';
  const lines = [[`"${track.title}"`, `bold 16px ${SANS}`], [track.artist, `15px ${SANS}`],
    [station.name.toLowerCase().replace(/\b\w/g, ch => ch.toUpperCase()), `15px ${SANS}`], ['HIFI TV', `bold 11px ${SANS}`]];
  lines.forEach(([text, font], i) => {
    c.font = font; const y = 262 + i * 19;
    c.fillStyle = 'rgba(0,0,0,0.6)'; c.fillText(text, 28, y + 2);
    c.fillStyle = '#ffffff'; c.fillText(text, 26, y);
  });
  c.restore();
}
function standby(c, s, station) {
  c.fillStyle = '#1028c8'; c.fillRect(0, 0, W, H);
  osd(c, 'STOP ■', 24, 40);
  osd(c, 'CH 03', W - 24, 40, 'right');
  osd(c, station?.name || 'HIFI TV', W / 2, H / 2 - 6, 'center', 26);
  osd(c, 'PRESS PLAY', W / 2, H / 2 + 30, 'center', 16);
  c.fillStyle = 'rgba(0,0,0,0.12)'; for (let y = 0; y < H; y += 3) c.fillRect(0, y, W, 1);
}

export function createTV(canvas) {
  canvas.width = W; canvas.height = H;
  const c = canvas.getContext('2d');
  const L = createLevels();
  const pix = makePixel(), pixCtx = pix.getContext('2d');
  let stationId = null, trackKey = '', shot = 0, shotT = 0, shotLen = 10, glitch = 0, trackT = 0, T = 0, seed = 1;
  function cut(now = false) {
    const shots = SCENES[stationId]?.length || 1;
    shot = (shot + 1 + (shots > 2 && hash(seed + shot * 7 + Math.floor(T)) > 0.6 ? 1 : 0)) % shots;
    shotT = 0; shotLen = 8 + hash(seed + shot + Math.floor(T)) * 6; glitch = now ? 0.35 : 0.25;
  }
  return {
    has: id => Object.hasOwn(SCENES, id),
    next() { cut(true); },
    setShot(i) { shot = i % (SCENES[stationId]?.length || 1); shotT = 0; glitch = 0; },
    draw(dt, { station, track, live, samples, waveform, calm }) {
      if (station?.id !== stationId) { stationId = station?.id; shot = 0; shotT = 0; trackT = 0; glitch = 0.35; }
      const key = `${station?.id}:${track?.title}`;
      if (key !== trackKey) { trackKey = key; trackT = 0; seed = seedOf(key); if (live) cut(true); }
      updateLevels(L, samples, dt, live);
      if (!live || !SCENES[stationId]) { standby(c, null, station); return; }
      T += dt; shotT += dt; trackT += dt; glitch = Math.max(0, glitch - dt);
      if (shotT > shotLen) cut();
      const s = { t: shotT, T, L, seed, samples, waveform, calm, pix, pixCtx };
      c.save();
      const zoom = 1 + (calm ? 0 : shotT / shotLen * 0.06 + L.beat * 0.012);
      c.translate(W / 2, H / 2); c.scale(zoom, zoom); c.translate(-W / 2, -H / 2);
      SCENES[stationId][shot](c, s);
      c.restore();
      tape(c, s, glitch);
      const era = ERA[stationId];
      if (shotT < 3 && trackT < 12) osd(c, 'PLAY ▶', 24, 40);
      osd(c, 'SP', W - 24, 40, 'right');
      const m = Math.floor(era.minutes + T / 60) % 1440, h12 = Math.floor(m / 60) % 12 || 12;
      osd(c, `${m < 720 ? 'AM' : 'PM'} ${h12}:${String(m % 60).padStart(2, '0')}`, W - 24, H - 46, 'right', 16);
      osd(c, era.date, W - 24, H - 24, 'right', 16);
      if (track) credits(c, track, station, trackT);
    },
  };
}
