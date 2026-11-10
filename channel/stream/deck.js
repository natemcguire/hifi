// The close-up of the record player: Guillermo Rauch's WebGL2 deck (vendor/vinyl, MIT), with the disc
// drawn from the cut of this stream's own side (tools/sides.mjs) and a HIFI label. The tonearm sits
// where the groove is at side time t, so the needle moves across the record as the side plays.
import { Renderer } from '../vendor/vinyl/render.js';
import { W33, alphaForRadius, grooveRadius } from '../vendor/vinyl/geometry.js';

const TAU = Math.PI * 2, S = 1024, C = S / 2;
const SANS = '"Helvetica Neue", Helvetica, Arial, sans-serif';

// A HIFI label in the station colour: the wordmark, the station, side A, the tracks.
export function hifiLabel(stream, side, titles) {
  const c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(C, C, 60, C, C, 512);
  g.addColorStop(0, stream.color); g.addColorStop(1, shade(stream.color, -0.28));
  x.fillStyle = g; x.beginPath(); x.arc(C, C, 512, 0, TAU); x.fill();
  const lum = luminance(stream.color), ink = lum > 0.45 ? '#16130f' : '#f6f1e4';
  x.fillStyle = x.strokeStyle = ink; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 4; x.beginPath(); x.arc(C, C, 486, 0, TAU); x.stroke();
  x.lineWidth = 1.5; x.beginPath(); x.arc(C, C, 450, 0, TAU); x.stroke();
  x.font = `800 150px ${SANS}`; x.fillText('HIFI', C, C - 250);
  x.font = `700 46px ${SANS}`; x.fillText(stream.name, C, C - 150, 640);
  x.font = `600 28px ${SANS}`;
  x.fillText(`SIDE ${side}`, C - 300, C - 16); x.fillText('STEREO', C - 300, C + 20);
  x.fillText('33⅓', C + 300, C - 16); x.fillText('RPM', C + 300, C + 20);
  x.font = `500 27px ${SANS}`;
  titles.slice(0, 6).forEach((t, i) => {
    const dy = 170 + i * 38, w = 2 * Math.sqrt(440 * 440 - dy * dy) - 50;
    x.fillText(`${i + 1}. ${t}`, C, C + dy, w);
  });
  x.font = `600 20px ${SANS}`; x.fillText('HIFI STUDIO · ORIGINAL RECORDINGS', C, C + 418, 520);
  return c;
}

export class Deck {
  // program: tools/sides.mjs program.json, each record's rTab decoded to a Float64Array and its vis loaded.
  constructor(canvas, stream, program) {
    this.canvas = canvas; this.program = program; this.current = -1;
    this.r = new Renderer(canvas);
    const deck = this;
    this.r.setLabel = function () {               // the vinyl renderer calls this from setRecord
      const gl = this.gl, rec = program.records[deck.current];
      gl.bindTexture(gl.TEXTURE_2D, this.tex.label);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, hifiLabel(stream, rec ? rec.side : 'A', rec ? rec.rec.tracks.map((t) => t.title) : []));
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    };
  }
  // t: seconds into the program. cam: {az, el, zoom} for this frame.
  draw(t, cam) {
    const recs = this.program.records;
    let k = recs.findIndex((r) => t < r.end); if (k < 0) k = recs.length - 1;
    if (k !== this.current) { this.current = k; this.r.setRecord(recs[k].rec, recs[k].vis); }
    const rec = recs[k].rec, local = Math.max(0, t - recs[k].start), theta = Math.min(local * W33, rec.thetaEnd);
    this.r.draw({ thp: local * W33, al: alphaForRadius(grooveRadius(rec.rTab, theta)), zt: 0, motor: true, rpm: 100 / 3, ...cam });
  }
}
function hex(c) { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function luminance(c) { const [r, g, b] = hex(c); return (0.299 * r + 0.587 * g + 0.114 * b) / 255; }
function shade(c, k) { return '#' + hex(c).map((v) => Math.round(Math.max(0, Math.min(255, v * (1 + k)))).toString(16).padStart(2, '0')).join(''); }
