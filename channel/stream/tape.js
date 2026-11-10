// The HIFI Live picture: a photoreal mid-90s den played back off a VHS camcorder tape.
// Adapted from mockups/youtube-live/scene.js for the broadcast: everything is a function of side time t
// (seconds into the stream's side), so tools/render.mjs can render frame by frame and the picture
// always matches the music (the clip on the TV, the record, the needle, the lower third).
//
// Two camera shots, cut together like home video:
//   wide: the room photo (rooms/<id>.jpg), the station's HIFI TV clip keyed into the CRT glass through
//         a homography, the record label on the photo's turntable turning at 33⅓, the date stamp;
//   deck: a close-up of the record player, drawn by stream/deck.js (rauchg/vinyl), the needle in the groove.
// Both go through the same tape pass: hand-held drift, tracking wobble, head switching, chroma bleed,
// soft luma with edge ringing, grain and dropouts, and a burst of noise at each cut.
// The lava lamps and the rain or snow at the window come from the mockup's scene.js (rooms.json data).
import { W33 } from '../vendor/vinyl/geometry.js';

const VERT = `attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D photo,clip,label,osd,deck;
uniform vec2 res;          // canvas size in px
uniform vec2 img;          // photo size in px
uniform float t;           // seconds into the side
uniform float frame;       // 29.97 fps frame counter, for tape noise
uniform float spin;        // record angle, radians
uniform float shot;        // 0 wide (the room), 1 the deck close-up
uniform float cut;         // 1 right after a cut, fading to 0
uniform mat3 toScreen;     // photo px -> clip uv (inverse homography of the CRT glass)
uniform vec4 box;          // keyed area in photo px (x0,y0,x1,y1), with a margin
uniform vec2 lc;           // label centre, photo px
uniform vec3 lax;          // label semi-axes a,b and tilt
uniform vec3 ink;          // label print colour
uniform vec3 spill;        // average colour of the clip, lights the room
uniform vec3 warm;         // the room's light, for grading the deck shot
uniform vec2 screenC;      // screen centre, photo px
uniform float ta;          // t mod 600: the lava lamps and the weather, whose periods divide 600 s
uniform vec3 lavaA,lavaB;  // the lava lamp's glass, top and bottom edge: y, x0, x1 (photo px)
uniform vec3 lavaLiquid,lavaWax;
uniform float weather;     // 0 none, 1 rain, 2 snow
uniform vec4 pane0,pane1,pane2; // window glass, photo px (x0,y0,x1,y1)

float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
// value noise, periodic every 289 units so a long side keeps float precision
float vnoise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);float a=mod(i,289.),b=mod(i+1.,289.);return mix(hash(vec2(a,7.1)),hash(vec2(b,7.1)),f);}

// From mockups/youtube-live/scene.js (the lava lamps and the weather at the window).
// The lava lamp. Wax blobs rise off the coil, drift, stretch and sink, merging as metaballs, in the
// lamp's own coordinates (units of glass height). Every period divides 600 s, the length of ta.
vec3 lava(vec2 px,vec3 c){
  float H=lavaB.x-lavaA.x;
  float s=(px.y-lavaA.x)/H;
  if(H<=0.||s<0.||s>1.) return c;
  float x0=mix(lavaA.y,lavaB.y,s),x1=mix(lavaA.z,lavaB.z,s),hw=(x1-x0)*.5,xc=(x0+x1)*.5;
  float u=(px.x-xc)/hw;
  if(abs(u)>1.) return c;
  float m=(1.-smoothstep(1.-2.5/hw,1.,abs(u)))*smoothstep(0.,.03,s)*(1.-smoothstep(.97,1.,s));
  float cu=max(abs(u)-.68,0.)/.32,cs=max(s-.86,0.)/.14;
  m*=1.-smoothstep(.8,1.,length(vec2(cu,cs)));             // the rounded bottom of the glass
  vec2 q=vec2((px.x-xc)/H,s);
  float f=1.1*exp((s-1.)*16.)+.35*exp(-s*30.);             // the pool on the coil, a little at the cap
  for(int i=0;i<4;i++){
    float fi=float(i);
    float ph=fract(ta*(5.+2.*fi)/600.+fi*.31);
    float y=.92-.84*smoothstep(0.,1.,ph<.55?ph/.55:(1.-ph)/.45); // rise slowly, sink a little faster
    float hwy=mix(lavaA.z-lavaA.y,lavaB.z-lavaB.y,y)*.5/H;
    float x=hwy*.3*sin(6.2832*(ta*(2.+fi)/600.+fi*1.7));
    float r=(.12+.03*sin(fi*2.3))*(1.-.35*abs(y-.5))*(hwy/.28);
    vec2 d=q-vec2(x,y);
    float st=sin(6.2832*(ta*(9.+2.*fi)/600.+fi));
    d*=vec2(1.-.18*st,1.+.35*st);                             // they stretch as they go
    d.x+=.25*d.y*sin(6.2832*(ta*(7.+fi)/600.)+fi);             // and lean
    f+=r*r/max(dot(d,d),1e-4);
  }
  float wax=smoothstep(.9,1.25,f);
  float core=smoothstep(1.,4.,f);                             // blobs are lit through, darker at the rim
  float shade=(.68+.72*s*s)*(1.-.38*u*u);
  vec3 col=mix(lavaLiquid*shade,lavaWax*(shade*(.78+.35*core)+.08),wax);
  col+=lavaWax*.5*exp(-u*u*2.5-pow((1.-s)*7.,2.));         // the bulb under the glass
  col+=vec3(.14)*smoothstep(.5,.75,u)*(1.-smoothstep(.75,.95,u))*(1.-s*.6); // a highlight down one side
  return mix(c,col,m);
}

float inRect(vec2 px,vec4 r){vec2 a=smoothstep(r.xy,r.xy+1.5,px)*(1.-smoothstep(r.zw-1.5,r.zw,px));return a.x*a.y;}
float paneMask(vec2 px){
  float m=max(inRect(px,pane0),max(inRect(px,pane1),inRect(px,pane2)));
  vec4 lb=vec4(min(lavaA.y,lavaB.y)-4.,lavaA.x-34.,max(lavaA.z,lavaB.z)+4.,lavaB.x+40.); // not over the lamp
  if(px.x>lb.x&&px.x<lb.z&&px.y>lb.y&&px.y<lb.w) m=0.;
  return m;
}
// One layer of snow: a flake per cell (most cells), falling and swaying. Speeds are whole cells per 600 s.
float flakes(vec2 px,float cell,float cellsPer10min,float size,float seed){
  vec2 p=px-vec2(0.,ta*cell*cellsPer10min/600.);
  vec2 id=floor(p/cell),f=fract(p/cell)-.5;
  float h=hash(id+seed);
  vec2 o=(vec2(hash(id*1.7+seed+3.),hash(id*2.3+seed+7.))-.5)*.6;
  o.x+=.2*sin(6.2832*ta*(2.+floor(h*4.))/60.+h*6.28);
  float d=length((f-o)*cell);
  return step(.5,h)*(1.-smoothstep(size*.35,size,d))*(.55+.45*h);
}
// Rain: streaks falling past outside, and drops running down the glass.
float rain(vec2 px){
  vec2 p=px+vec2(px.y*.06,-ta*900.);
  vec2 cell=vec2(7.,80.),id=floor(p/cell),f=fract(p/cell);
  float h=hash(id+3.1);
  float streak=step(.4,h)*(1.-smoothstep(.0,.9,abs(f.x-hash(id+9.)*.8-.1)*cell.x))*smoothstep(0.,.1,f.y)*(1.-smoothstep(.35,.5,f.y));
  float col=floor(px.x/16.),hc=hash(vec2(col,4.2));
  float per=600./(8.+floor(hc*8.));
  float k=floor(ta/per+hc),ph=fract(ta/per+hc);
  float run=step(.55,hash(vec2(col,k)));
  float y=ph*560.-40.,x=(col+.25+.5*hash(vec2(col,k+.5)))*16.;
  vec2 d=px-vec2(x+1.2*sin(px.y*.05+k),y);
  float bead=1.-smoothstep(1.,2.6,length(d*vec2(1.,.75)));
  float trail=(1.-smoothstep(.3,1.1,abs(d.x)))*step(d.y,0.)*exp(d.y/45.)*.35;
  return streak*.22+run*(bead*.55+trail);
}
vec3 weatherFx(vec2 px,vec3 c){
  float m=paneMask(px);
  if(m<=0.) return c;
  vec2 o=1./img;vec2 uv=vec2(px.x,img.y-px.y)*o;
  vec3 b=(texture2D(photo,uv+vec2(3.,0.)*o).rgb+texture2D(photo,uv-vec2(3.,0.)*o).rgb+texture2D(photo,uv+vec2(0.,3.)*o).rgb+texture2D(photo,uv-vec2(0.,3.)*o).rgb
    +texture2D(photo,uv+vec2(2.,2.)*o).rgb+texture2D(photo,uv-vec2(2.,2.)*o).rgb)/6.;
  if(weather>1.5){
    c=mix(c,b,.6*m);                                          // soften the snow frozen in the still
    float sn=flakes(px,9.,700.,.9,1.)*.55+flakes(px,15.,640.,1.4,2.)*.8+flakes(px,26.,560.,2.2,3.);
    c+=vec3(.86,.89,.96)*min(sn,1.)*.85*m;
  }else{
    c=mix(c,b,.3*m);
    c+=vec3(.75,.8,.88)*rain(px)*m*(.35+.65*dot(b,vec3(.33)));
  }
  return c;
}

vec3 room(vec2 cam){
  vec2 px=vec2(cam.x,1.-cam.y)*img;                       // photo px, y down
  vec3 c=texture2D(photo,cam).rgb;
  if(px.x>box.x&&px.x<box.z&&px.y>box.y&&px.y<box.w){
    float g=c.g-max(c.r,c.b);
    float k=smoothstep(.06,.24,g);
    vec3 q=toScreen*vec3(px,1.);vec2 st=q.xy/q.z;
    vec2 d=st-.5;st=.5+d*(1.+.07*dot(d,d));
    vec3 tv=texture2D(clip,vec2(st.x,1.-(.125+st.y*.75))).rgb;
    tv=pow(tv,vec3(.9))*1.18+.025;
    tv*=.82+.18*sin(st.y*3.14159*2.*150.);
    tv*=1.-.55*pow(max(abs(d.x),abs(d.y))*2.,6.);
    tv+=.10*smoothstep(.5,.0,length(d-vec2(-.18,-.22)));
    c.g=min(c.g,max(c.r,c.b)*1.05+.02);
    c=mix(c,tv,k);
  }else{
    vec2 o=max(vec2(box.x-px.x,box.y-px.y),px-box.zw);
    float ring=(1.-smoothstep(0.,30.,max(o.x,o.y)))*step(px.y,box.w+10.);
    float ex=max(c.g-max(c.r,c.b),0.);
    c.g-=ex*ring;c+=spill*.10*ring;
    float r=length((px-screenC)/img.y);
    c+=c*spill*1.1*exp(-r*3.2)+spill*.025*exp(-r*5.);
  }
  c=lava(px,c);
  if(weather>.5) c=weatherFx(px,c);
  vec2 d=px-lc;float ca=cos(lax.z),sa=sin(lax.z);
  vec2 e=vec2(ca*d.x+sa*d.y,-sa*d.x+ca*d.y)/lax.xy;
  float r=length(e);
  if(r<1.){
    float cs=cos(-spin),sn=sin(-spin);
    vec2 u=vec2(cs*e.x-sn*e.y,sn*e.x+cs*e.y);
    float a=texture2D(label,vec2(u.x*.5+.5,.5-u.y*.5)).a*smoothstep(1.,.92,r)*smoothstep(.07,.12,r);
    float shade=dot(c,vec3(.3,.59,.11))/max(dot(texture2D(photo,vec2(lc.x,img.y-lc.y)/img).rgb,vec3(.3,.59,.11)),.02);
    c=mix(c,ink*clamp(shade,.2,1.6),a*.85);
  }
  return c;
}

// The close-up: the deck render, lit like the room (lamp colour, the TV's glow), a camcorder's auto-gain.
vec3 closeup(vec2 cam){
  vec3 c=texture2D(deck,cam).rgb;
  c=pow(c,vec3(1.08))*.9*mix(vec3(1.),warm*1.5,.6);           // the lamp's colour, a little underexposed
  c*=mix(.35,1.,smoothstep(.85,.2,length((cam-vec2(.48,.5))*vec2(1.,.9))));  // falloff past the lamp's pool
  return c+spill*.04*(1.-cam.y)+.01;
}

vec3 tape(vec2 uv){
  vec2 dr=vec2(vnoise(t*.31)-.5+.4*(vnoise(t*1.7+3.)-.5),vnoise(t*.27+11.)-.5+.4*(vnoise(t*1.9+5.)-.5))*(.012+.008*shot);
  vec2 cam=(uv-.5)/(1.045+.006*sin(t*.11))+.5+dr;
  vec3 c=shot>.5?closeup(cam):room(cam);
  vec4 o=texture2D(osd,uv);
  return mix(c,o.rgb,o.a);
}

const mat3 RGB2YIQ=mat3(.299,.596,.211,.587,-.274,-.523,.114,-.322,.312);
const mat3 YIQ2RGB=mat3(1.,1.,1.,.956,-.272,-1.106,.621,-.647,1.703);

void main(){
  vec2 uv=v;
  uv.y=fract(uv.y+cut*cut*.18*hash(vec2(frame,3.)));        // the frame rolls for a moment after a cut
  float line=floor((1.-uv.y)*240.);
  float fr=floor(frame);
  float off=.0011*sin(uv.y*13.+t*1.7)+.0007*sin(uv.y*47.-t*3.3)+.0004*(hash(vec2(line,fr))-.5);
  off+=.010*pow(max(0.,uv.y-.965)/.035,2.)*(vnoise(t*4.)-.3);
  float hs=step(uv.y,.022);
  off+=hs*(.035*(1.-uv.y/.022)+.02*(hash(vec2(line,fr*.37))-.5));
  float bp=fract(t/17.)*1.5-.25,band=smoothstep(.045,0.,abs(uv.y-bp))*step(.55,vnoise(floor(t/17.)*3.1));
  band=max(band,cut*smoothstep(.25,0.,abs(uv.y-fract(.7-cut*.9))));
  off+=band*.012*(hash(vec2(line,fr))-.5)+cut*.02*(hash(vec2(line,fr))-.5);
  vec2 tx=vec2(1./res.x,0.);
  vec3 s[7];
  for(int i=0;i<7;i++){s[i]=RGB2YIQ*tape(vec2(uv.x+off+(float(i)-3.)*1.6*tx.x,uv.y));}
  float yN=s[2].x*.25+s[3].x*.5+s[4].x*.25;
  float yW=(s[0].x+s[1].x+s[2].x+s[3].x+s[4].x+s[5].x+s[6].x)/7.;
  float Y=yN+.55*(yN-yW);
  vec2 C=(s[0].yz*.10+s[1].yz*.18+s[2].yz*.24+s[3].yz*.22+s[4].yz*.14+s[5].yz*.08+s[6].yz*.04);
  C*=.86*(1.-.6*cut);
  C+=(vec2(hash(vec2(floor(line/3.),fr)),hash(vec2(fr,floor(line/3.))))-.5)*.035;
  float gr=hash(gl_FragCoord.xy+fr*17.13)-.5;
  Y+=gr*(.07+.25*cut);
  float dl=hash(vec2(line*1.7,fr));
  if(dl<.0025){float x0=hash(vec2(fr,line)),len=.03+.12*hash(vec2(line,fr*2.));Y+=.7*smoothstep(len,0.,abs(uv.x-x0-len*.5)*2.);}
  Y+=band*(hash(gl_FragCoord.xy*.7+fr)-.4)*.45;
  Y+=hs*(hash(vec2(gl_FragCoord.x*.3,fr))-.5)*.35;
  Y=Y*.9+.045;
  vec3 c=YIQ2RGB*vec3(Y,C);
  c*=vec3(1.03,.99,.95);
  c*=.96+.04*sin(gl_FragCoord.y*3.14159);
  vec2 q=uv-.5;c*=1.-.35*dot(q,q)*1.6;
  c*=smoothstep(.0,.012,uv.x)*smoothstep(1.,.993,uv.x);
  gl_FragColor=vec4(clamp(c,0.,1.),1.);
}`;

function squareToQuad([[x0, y0], [x1, y1], [x2, y2], [x3, y3]]) {
  const dx1 = x1 - x2, dx2 = x3 - x2, dy1 = y1 - y2, dy2 = y3 - y2, sx = x0 - x1 + x2 - x3, sy = y0 - y1 + y2 - y3;
  const den = dx1 * dy2 - dx2 * dy1, g = (sx * dy2 - dx2 * sy) / den, hh = (dx1 * sy - sx * dy1) / den;
  return [x1 - x0 + g * x1, x3 - x0 + hh * x3, x0, y1 - y0 + g * y1, y3 - y0 + hh * y3, y0, g, hh, 1];
}
function invert3([a, b, c, d, e, f, g, hh, i]) {
  const A = e * i - f * hh, B = -(d * i - f * g), C = d * hh - e * g, det = a * A + b * B + c * C;
  return [A, -(b * i - c * hh), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * hh - b * g), a * e - b * d].map((x) => x / det);
}

// The print on the photo's record label (the far shot): small, so just the wordmark.
function labelCanvas(stream) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const x = c.getContext('2d'); x.fillStyle = '#fff'; x.strokeStyle = '#fff'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 3; x.beginPath(); x.arc(128, 128, 112, 0, Math.PI * 2); x.stroke();
  x.font = '800 50px -apple-system,Helvetica,Arial,sans-serif'; x.fillText('HIFI', 128, 64);
  x.font = '700 21px -apple-system,Helvetica,Arial,sans-serif';
  x.fillText(stream.name.length > 16 ? stream.name.replace(/ TO WORK TO$/, '') : stream.name, 128, 186);
  x.font = '600 17px -apple-system,Helvetica,Arial,sans-serif'; x.fillText('33⅓', 72, 128); x.fillText('SIDE A', 184, 128);
  x.fillRect(122, 96, 12, 4);
  return c;
}

// The camcorder's date stamp, recorded with the picture. Its clock starts at the tape's time and runs with the side.
function drawStamp(x, stamp, t) {
  x.clearRect(0, 0, 320, 240);
  const secs = Math.floor(t), m = stamp.minute + Math.floor(secs / 60), hour = (stamp.hour + Math.floor(m / 60)) % 24, min = m % 60, sec = secs % 60;
  const lines = [`${hour < 12 ? 'AM' : 'PM'} ${String(hour % 12 || 12).padStart(2, ' ')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`, stamp.date];
  x.font = 'bold 12px "Courier New",Courier,monospace'; x.textAlign = 'right'; x.textBaseline = 'alphabetic';
  lines.forEach((s, i) => { const y = 211 + i * 14; x.fillStyle = '#000'; for (const [dx, dy] of [[1, 1], [2, 2], [1, 0], [0, 1]]) x.fillText(s, 298 + dx, y + dy); x.fillStyle = '#f4f1e6'; x.fillText(s, 298, y); });
}

// Where the camera is at side time t. Mostly the room; the deck close-up a little after each track
// starts and once more in the middle of a long one. Never near the loop point, where the needle goes
// back to the lead-in, so the seam is a cut in the wide shot.
export function shotList(program) {
  const shots = [], edges = program.records.flatMap((r) => [r.start, r.end]);
  program.tracks.forEach((tr, i) => {
    const len = tr.end - tr.start;
    shots.push({ from: tr.start + 9, to: tr.start + 23, preset: i % 3 });
    if (len > 100) shots.push({ from: tr.start + len * 0.58, to: tr.start + len * 0.58 + 12, preset: (i + 1) % 3 });
  });
  return shots.filter((s) => edges.every((e) => s.to < e - 6 || s.from > e + 6));
}
// Deck camera presets (rauchg/vinyl orbit camera): over the platter; low across the label; the stylus.
const PRESETS = [
  { az: -0.35, el: 0.95, zoom: 0.05, daz: 0.10, dzoom: 0.10 },
  { az: 0.55, el: 0.42, zoom: 0.22, daz: -0.12, dzoom: 0.12 },
  { az: -0.9, el: 0.5, zoom: 0.62, daz: 0.08, dzoom: 0.14 },
];
export function shotAt(shots, t) {
  for (const s of shots) if (t >= s.from && t < s.to) return { kind: 'deck', since: t - s.from, s };
  let last = 0;
  for (const s of shots) if (s.to <= t) last = Math.max(last, s.to);
  return { kind: 'wide', since: t - last };
}

export class Tape {
  constructor(canvas, stream, program, { deck, deckCanvas, clips }) {
    const cal = stream.room;
    Object.assign(this, { canvas, stream, program, deck, deckCanvas, clips });
    this.shots = shotList(program);
    const gl = this.gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: true });
    if (!gl) throw Error('no WebGL');
    const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw Error(gl.getShaderInfoLog(s)); return s; };
    const pr = this.pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(pr, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const u = this.u = {};
    for (const n of ['photo', 'clip', 'label', 'osd', 'deck', 'res', 'img', 't', 'frame', 'spin', 'shot', 'cut', 'toScreen', 'box', 'lc', 'lax', 'ink', 'spill', 'warm', 'screenC', 'ta', 'lavaA', 'lavaB', 'lavaLiquid', 'lavaWax', 'weather', 'pane0', 'pane1', 'pane2']) u[n] = gl.getUniformLocation(pr, n);
    const tex = (unit, filter) => {
      const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
      for (const [k, v] of [[gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE], [gl.TEXTURE_MIN_FILTER, filter], [gl.TEXTURE_MAG_FILTER, filter]]) gl.texParameteri(gl.TEXTURE_2D, k, v);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0])); return t;
    };
    this.tex = { photo: tex(0, gl.LINEAR), clip: tex(1, gl.LINEAR), label: tex(2, gl.LINEAR), osd: tex(3, gl.NEAREST), deck: tex(4, gl.LINEAR) };
    ['photo', 'clip', 'label', 'osd', 'deck'].forEach((n, i) => gl.uniform1i(u[n], i));
    this.upload = (unit, t, src) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); };
    this.upload(2, this.tex.label, labelCanvas(stream));
    this.osd = document.createElement('canvas'); this.osd.width = 320; this.osd.height = 240; this.osdx = this.osd.getContext('2d'); this.osdSec = -1;
    const q = cal.screen.corners, cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
    const H = invert3(squareToQuad(q.map(([x, y]) => [cx + (x - cx) * 1.025, cy + (y - cy) * 1.03])));
    gl.uniformMatrix3fv(u.toScreen, false, [H[0], H[3], H[6], H[1], H[4], H[7], H[2], H[5], H[8]]);
    const [x0, y0, x1, y1] = cal.screen.box, m = 6;
    gl.uniform4f(u.box, x0 - m, y0 - m, x1 + m, y1 + m); gl.uniform2f(u.screenC, cx, cy);
    gl.uniform2f(u.img, cal.width, cal.height); gl.uniform2f(u.res, canvas.width, canvas.height);
    const L = cal.label; gl.uniform2f(u.lc, L.cx, L.cy); gl.uniform3f(u.lax, L.a, L.b, L.angle);
    const lum = (L.color[0] * 0.3 + L.color[1] * 0.59 + L.color[2] * 0.11) / 255;
    gl.uniform3fv(u.ink, lum < 0.25 ? [0.93, 0.9, 0.82] : [0.07, 0.06, 0.06]);
    const lava = cal.lava || { top: [0, 0, 0], bottom: [0, 0, 0] };
    gl.uniform3fv(u.lavaA, lava.top); gl.uniform3fv(u.lavaB, lava.bottom);
    gl.uniform1f(u.weather, { rain: 1, snow: 2 }[cal.weather] || 0);
    for (let i = 0; i < 3; i++) gl.uniform4fv(u['pane' + i], (cal.panes || [])[i] || [-9, -9, -9, -9]);
    gl.viewport(0, 0, canvas.width, canvas.height);
    this.spill = [0, 0, 0]; this.warm = [0.5, 0.45, 0.4];
    this.probe = document.createElement('canvas'); this.probe.width = this.probe.height = 4; this.probex = this.probe.getContext('2d', { willReadFrequently: true });
  }
  async load() {
    const photo = new Image(); photo.src = this.stream.room.photo; await photo.decode();
    this.upload(0, this.tex.photo, photo);
    this.lavaColors(photo);
    // The room's light: the photo's average colour, normalised, grades the deck close-up.
    const p = document.createElement('canvas'); p.width = p.height = 8; const px = p.getContext('2d'); px.drawImage(photo, 0, 0, 8, 8);
    const d = px.getImageData(0, 0, 8, 8).data, s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    const mx = Math.max(...s); this.warm = s.map((v) => v / mx * 0.6);
    this.gl.useProgram(this.pr); this.gl.uniform3fv(this.u.warm, this.warm);
  }
  // The lamp's colours, from the photo: the liquid is the middle of the glass's brightness, the wax the top.
  lavaColors(photo){
    const {gl,u}=this,L=this.stream.room.lava;
    if(!L){gl.uniform3f(u.lavaA,0,0,0);return;}
    const c=document.createElement('canvas');c.width=photo.naturalWidth;c.height=photo.naturalHeight;
    const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(photo,0,0);
    const px=[];
    for(let y=Math.round(L.top[0]+4);y<L.bottom[0]-6;y+=2){
      const s=(y-L.top[0])/(L.bottom[0]-L.top[0]),x0=L.top[1]+(L.bottom[1]-L.top[1])*s,x1=L.top[2]+(L.bottom[2]-L.top[2])*s,cx=(x0+x1)/2,hw=(x1-x0)/2*.7;
      const d=x.getImageData(Math.round(cx-hw),y,Math.max(1,Math.round(hw*2)),1).data;
      for(let i=0;i<d.length;i+=4) px.push([d[i],d[i+1],d[i+2],d[i]*.3+d[i+1]*.59+d[i+2]*.11]);
    }
    px.sort((a,b)=>a[3]-b[3]);
    const avg=(a,b)=>{const p=px.slice(Math.floor(px.length*a),Math.floor(px.length*b));return [0,1,2].map(k=>p.reduce((s,v)=>s+v[k],0)/p.length/255);};
    gl.useProgram(this.pr);gl.uniform3fv(u.lavaLiquid,avg(.15,.5));gl.uniform3fv(u.lavaWax,avg(.8,.95));
  }
  trackAt(t) {
    const tr = this.program.tracks; let i = 0;
    while (i + 1 < tr.length && tr[i + 1].start <= t) i++;
    return { index: i, track: tr[i], elapsed: Math.max(0, Math.min(t - tr[i].start, tr[i].end - tr[i].start)) };
  }
  // Seek the track's clip to where it is at t: the clips loop, a new one with every song.
  async clipAt(t) {
    const { index, track } = this.trackAt(t), v = this.clips[index % this.clips.length];
    const want = Math.max(0, t - track.start) % Math.max(0.1, v.duration - 0.05);
    if (Math.abs(v.currentTime - want) > 0.004) {
      await new Promise((res) => { v.addEventListener('seeked', res, { once: true }); v.currentTime = want; });
    }
    return v;
  }
  async frame(t) {
    const { gl, u } = this;
    const video = await this.clipAt(t);
    this.upload(1, this.tex.clip, video);
    this.probex.drawImage(video, 0, 0, 4, 4);
    const d = this.probex.getImageData(0, 0, 4, 4).data, s = [0, 0, 0];
    for (let i = 0; i < d.length; i += 4) { s[0] += d[i]; s[1] += d[i + 1]; s[2] += d[i + 2]; }
    const k = 0.12; this.spill = this.spill.map((v, i) => v * (1 - k) + s[i] / 16 / 255 * k);
    const shot = shotAt(this.shots, t);
    if (shot.kind === 'deck') {
      const P = PRESETS[shot.s.preset], f = shot.since / (shot.s.to - shot.s.from);
      this.deck.draw(t, { az: P.az + P.daz * f, el: P.el, zoom: P.zoom + P.dzoom * f });
      this.upload(4, this.tex.deck, this.deckCanvas);
    }
    const sec = Math.floor(t);
    if (sec !== this.osdSec) { this.osdSec = sec; drawStamp(this.osdx, this.stream.room.stamp, t); this.upload(3, this.tex.osd, this.osd); }
    gl.useProgram(this.pr);
    gl.uniform1f(u.t, t); gl.uniform1f(u.ta, t % 600); gl.uniform1f(u.frame, Math.floor(t * 29.97) % 1024);
    gl.uniform1f(u.spin, (t * W33) % (2 * Math.PI));
    gl.uniform1f(u.shot, shot.kind === 'deck' ? 1 : 0);
    gl.uniform1f(u.cut, Math.max(0, 1 - shot.since / 0.3));   // at t = 0 too: the loop seam is an edit
    gl.uniform3fv(u.spill, this.spill);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { shot: shot.kind, ...this.trackAt(t) };
  }
}
