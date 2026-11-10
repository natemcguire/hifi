// The HIFI Live room: a photoreal mid-90s den, played back as if shot on a 90s VHS camcorder.
// Each room is a generated photo (rooms/<id>.jpg) whose CRT screen was rendered chroma green.
// One WebGL pass composites the room — the station's HIFI TV clip keyed into the screen with a
// homography, the record label turning at 33⅓, the camcorder date stamp — and then plays it back
// off tape: handheld drift, tracking wobble, head-switching noise, chroma bleed, soft luma with
// edge-enhancement ringing, tape grain and dropouts. The picture is 4:3, pillarboxed in a 16:9 frame.
const h=(tag,cls,html='')=>{const el=document.createElement(tag);if(cls)el.className=cls;if(html)el.innerHTML=html;return el;};
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;

// Fake broadcast clock, like the app's synth stations: everyone sees the same track.
const TRACK_SECONDS=150;
export function onAir(stream,now=Date.now()){
  const t=now/1000+stream.frequency*37;
  const index=Math.floor(t/TRACK_SECONDS)%stream.tracks.length;
  const elapsed=t%TRACK_SECONDS;
  return {index,track:stream.tracks[index],elapsed,remaining:TRACK_SECONDS-elapsed,clip:stream.tv[index%stream.tv.length]};
}
const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

const VERT=`attribute vec2 p;varying vec2 v;void main(){v=p*.5+.5;gl_Position=vec4(p,0.,1.);}`;
const FRAG=`precision highp float;
varying vec2 v;
uniform sampler2D photo,clip,label,osd;
uniform vec2 res;          // canvas size in px
uniform vec2 img;          // photo size in px
uniform float t;           // seconds
uniform float frame;       // 29.97 fps frame counter, for tape noise
uniform float spin;        // record angle, radians
uniform float motion;      // 0 when the reader prefers reduced motion
uniform mat3 toScreen;     // photo px -> clip uv (inverse homography of the CRT glass)
uniform vec4 box;          // keyed area in photo px (x0,y0,x1,y1), with a margin
uniform vec2 lc;           // label centre, photo px
uniform vec3 lax;          // label semi-axes a,b and tilt
uniform vec3 ink;          // label print colour
uniform vec3 spill;        // average colour of the clip, lights the room
uniform vec2 screenC;      // screen centre, photo px

float hash(vec2 p){p=fract(p*vec2(443.897,441.423));p+=dot(p,p.yx+19.19);return fract((p.x+p.y)*p.x);}
float vnoise(float x){float i=floor(x),f=fract(x);f=f*f*(3.-2.*f);return mix(hash(vec2(i,7.1)),hash(vec2(i+1.,7.1)),f);}

vec3 room(vec2 cam){
  vec2 px=vec2(cam.x,1.-cam.y)*img;                       // photo px, y down
  vec3 c=texture2D(photo,cam).rgb;
  // The CRT: key the green glass, put the clip there through the homography.
  if(px.x>box.x&&px.x<box.z&&px.y>box.y&&px.y<box.w){
    float g=c.g-max(c.r,c.b);
    float k=smoothstep(.06,.24,g);
    vec3 q=toScreen*vec3(px,1.);vec2 st=q.xy/q.z;
    vec2 d=st-.5;st=.5+d*(1.+.07*dot(d,d));                  // a little tube curvature
    vec3 tv=texture2D(clip,vec2(st.x,1.-(.125+st.y*.75))).rgb; // the square clip, cropped to 4:3
    tv=pow(tv,vec3(.9))*1.18+.025;                            // phosphor glow, raised black of a lit tube
    tv*=.82+.18*sin(st.y*3.14159*2.*150.);                    // scanlines
    tv*=1.-.55*pow(max(abs(d.x),abs(d.y))*2.,6.);             // darker toward the bezel
    tv+=.10*smoothstep(.5,.0,length(d-vec2(-.18,-.22)));      // glass sheen
    c.g=min(c.g,max(c.r,c.b)*1.05+.02);                       // despill the bezel
    c=mix(c,tv,k);
  }else{
    // The green glass lit the bezel green in the photo: take that out near the screen (only a
    // little below it, where the Christmas garland is) and light it with the picture instead.
    vec2 o=max(vec2(box.x-px.x,box.y-px.y),px-box.zw);
    float ring=(1.-smoothstep(0.,30.,max(o.x,o.y)))*step(px.y,box.w+10.);
    float ex=max(c.g-max(c.r,c.b),0.);
    c.g-=ex*ring;c+=spill*.10*ring;
    // The glow of the picture on the room.
    float r=length((px-screenC)/img.y);
    c+=c*spill*1.1*exp(-r*3.2)+spill*.025*exp(-r*5.);
  }
  // The record label turns; its print rotates in the plane of the platter.
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

vec3 tape(vec2 uv){
  // The camcorder: a hand-held frame that drifts and breathes a little.
  vec2 dr=motion*vec2(vnoise(t*.31)-.5+.4*(vnoise(t*1.7+3.)-.5),vnoise(t*.27+11.)-.5+.4*(vnoise(t*1.9+5.)-.5))*.012;
  vec2 cam=(uv-.5)/(1.045+.006*sin(t*.11))+.5+dr;
  vec3 c=room(cam);
  vec4 o=texture2D(osd,uv);                  // the date stamp is recorded with the picture
  return mix(c,o.rgb,o.a);
}

const mat3 RGB2YIQ=mat3(.299,.596,.211,.587,-.274,-.523,.114,-.322,.312);
const mat3 YIQ2RGB=mat3(1.,1.,1.,.956,-.272,-1.106,.621,-.647,1.703);

void main(){
  vec2 uv=v;
  float line=floor((1.-uv.y)*240.);
  float fr=floor(frame);
  // Playback: tracking wobble, flagging at the top, head switching at the bottom, now and then a
  // tracking band rolling up the frame.
  float off=motion*(.0011*sin(uv.y*13.+t*1.7)+.0007*sin(uv.y*47.-t*3.3)+.0004*(hash(vec2(line,fr))-.5));
  off+=motion*.010*pow(max(0.,uv.y-.965)/.035,2.)*(vnoise(t*4.)-.3);
  float hs=step(uv.y,.022);
  off+=hs*(.035*(1.-uv.y/.022)+.02*(hash(vec2(line,fr*.37))-.5));
  float bp=fract(t/17.)*1.5-.25,band=motion*smoothstep(.045,0.,abs(uv.y-bp))*step(.55,vnoise(floor(t/17.)*3.1));
  off+=band*.012*(hash(vec2(line,fr))-.5);
  vec2 tx=vec2(1./res.x,0.);
  // Luma is soft but edge-enhanced; chroma is smeared wide and lags to the right.
  vec3 s[7];
  for(int i=0;i<7;i++){s[i]=RGB2YIQ*tape(vec2(uv.x+off+(float(i)-3.)*1.6*tx.x,uv.y));}
  float yN=s[2].x*.25+s[3].x*.5+s[4].x*.25;
  float yW=(s[0].x+s[1].x+s[2].x+s[3].x+s[4].x+s[5].x+s[6].x)/7.;
  float Y=yN+.55*(yN-yW);
  vec2 C=(s[0].yz*.10+s[1].yz*.18+s[2].yz*.24+s[3].yz*.22+s[4].yz*.14+s[5].yz*.08+s[6].yz*.04);
  C*=.86;                                                     // tape colour is a little washed out
  C+=(vec2(hash(vec2(floor(line/3.),fr)),hash(vec2(fr,floor(line/3.))))-.5)*.035; // chroma noise
  // Tape grain, dropouts, the noisy band.
  float gr=hash(gl_FragCoord.xy+fr*17.13)-.5;
  Y+=gr*.07;
  float dl=hash(vec2(line*1.7,fr));
  if(dl<.0025){float x0=hash(vec2(fr,line)),len=.03+.12*hash(vec2(line,fr*2.));Y+=.7*smoothstep(len,0.,abs(uv.x-x0-len*.5)*2.);}
  Y+=band*(hash(gl_FragCoord.xy*.7+fr)-.4)*.45;
  Y+=hs*(hash(vec2(gl_FragCoord.x*.3,fr))-.5)*.35;
  Y=Y*.9+.045;                                                // lifted blacks, soft whites
  vec3 c=YIQ2RGB*vec3(Y,C);
  c*=vec3(1.03,.99,.95);                                      // camcorder white balance runs warm
  c*=.96+.04*sin(gl_FragCoord.y*3.14159);                     // interlace
  vec2 q=uv-.5;c*=1.-.35*dot(q,q)*1.6;                        // lens vignette
  c*=smoothstep(.0,.012,uv.x)*smoothstep(1.,.993,uv.x);       // ragged picture edges
  gl_FragColor=vec4(clamp(c,0.,1.),1.);
}`;

// Homography that maps the unit square to the quad p0..p3 (clockwise from top left).
function squareToQuad([[x0,y0],[x1,y1],[x2,y2],[x3,y3]]){
  const dx1=x1-x2,dx2=x3-x2,dy1=y1-y2,dy2=y3-y2,sx=x0-x1+x2-x3,sy=y0-y1+y2-y3;
  const den=dx1*dy2-dx2*dy1,g=(sx*dy2-dx2*sy)/den,hh=(dx1*sy-sx*dy1)/den;
  return [x1-x0+g*x1,x3-x0+hh*x3,x0, y1-y0+g*y1,y3-y0+hh*y3,y0, g,hh,1];
}
function invert3([a,b,c,d,e,f,g,hh,i]){
  const A=e*i-f*hh,B=-(d*i-f*g),C=d*hh-e*g,det=a*A+b*B+c*C;
  return [A,-(b*i-c*hh),b*f-c*e, B,a*i-c*g,-(a*f-c*d), C,-(a*hh-b*g),a*e-b*d].map(x=>x/det);
}

function labelCanvas(stream){
  const c=document.createElement('canvas');c.width=c.height=256;
  const x=c.getContext('2d');x.fillStyle='#fff';x.strokeStyle='#fff';x.textAlign='center';x.textBaseline='middle';
  x.lineWidth=3;x.beginPath();x.arc(128,128,112,0,Math.PI*2);x.stroke();
  x.font='800 50px -apple-system,Helvetica,Arial,sans-serif';x.fillText('HIFI',128,64);
  x.font='700 21px -apple-system,Helvetica,Arial,sans-serif';
  const name=stream.name.length>16?stream.name.replace(/ TO WORK TO$/,''):stream.name;
  x.fillText(name,128,186);
  x.font='600 17px -apple-system,Helvetica,Arial,sans-serif';x.fillText('33⅓',72,128);x.fillText(`SIDE A`,184,128);
  x.fillRect(122,96,12,4);
  return c;
}

// The camcorder's date stamp: blocky white letters with a black edge, bottom right.
function drawStamp(x,stamp,now){
  x.clearRect(0,0,320,240);
  const secs=Math.floor(now/1000)%3600;
  const m=stamp.minute+Math.floor(secs/60),hour=(stamp.hour+Math.floor(m/60))%24,min=m%60,sec=secs%60;
  const ampm=hour<12?'AM':'PM',h12=hour%12||12;
  const lines=[`${ampm} ${String(h12).padStart(2,' ')}:${String(min).padStart(2,'0')}:${String(sec).padStart(2,'0')}`,stamp.date];
  x.font='bold 12px "Courier New",Courier,monospace';x.textAlign='right';x.textBaseline='alphabetic';
  lines.forEach((s,i)=>{const y=211+i*14;x.fillStyle='#000';for(const [dx,dy] of [[1,1],[2,2],[1,0],[0,1]])x.fillText(s,298+dx,y+dy);x.fillStyle='#f4f1e6';x.fillText(s,298,y);});
}

const rooms=new Set();
let loop=0;
function tick(now){
  loop=requestAnimationFrame(tick);
  for(const r of rooms) if(r.visible) r.draw(now);
}

class Tape{
  constructor(el,stream,video,{width}){
    const cal=stream.room;
    this.stream=stream;this.video=video;this.visible=true;
    const canvas=this.canvas=h('canvas');canvas.width=width;canvas.height=width*3/4;
    const gl=this.gl=canvas.getContext('webgl',{antialias:false,premultipliedAlpha:false,preserveDrawingBuffer:false});
    if(!gl) throw Error('no WebGL');
    const sh=(type,src)=>{const s=gl.createShader(type);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const pr=this.pr=gl.createProgram();gl.attachShader(pr,sh(gl.VERTEX_SHADER,VERT));gl.attachShader(pr,sh(gl.FRAGMENT_SHADER,FRAG));gl.linkProgram(pr);
    if(!gl.getProgramParameter(pr,gl.LINK_STATUS)) throw Error(gl.getProgramInfoLog(pr));
    gl.useProgram(pr);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true);           // every texture: row 0 at the bottom, like uv
    gl.bindBuffer(gl.ARRAY_BUFFER,gl.createBuffer());gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,1,1]),gl.STATIC_DRAW);
    const loc=gl.getAttribLocation(pr,'p');gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,2,gl.FLOAT,false,0,0);
    const u=this.u={};for(const n of ['photo','clip','label','osd','res','img','t','frame','spin','motion','toScreen','box','lc','lax','ink','spill','screenC'])u[n]=gl.getUniformLocation(pr,n);
    const tex=(unit,filter)=>{const t=gl.createTexture();gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);
      for(const [k,v] of [[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE],[gl.TEXTURE_MIN_FILTER,filter],[gl.TEXTURE_MAG_FILTER,filter]])gl.texParameteri(gl.TEXTURE_2D,k,v);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,1,1,0,gl.RGBA,gl.UNSIGNED_BYTE,new Uint8Array([0,0,0,0]));return t;};
    this.tex={photo:tex(0,gl.LINEAR),clip:tex(1,gl.LINEAR),label:tex(2,gl.LINEAR),osd:tex(3,gl.NEAREST)};
    ['photo','clip','label','osd'].forEach((n,i)=>gl.uniform1i(u[n],i));
    const upload=(unit,t,src)=>{gl.activeTexture(gl.TEXTURE0+unit);gl.bindTexture(gl.TEXTURE_2D,t);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,src);};
    this.upload=upload;
    this.ready=false;
    const photo=new Image();photo.onload=()=>{upload(0,this.tex.photo,photo);this.ready=true;this.draw(performance.now(),true);};photo.src=cal.photo;
    upload(2,this.tex.label,labelCanvas(stream));
    this.osd=document.createElement('canvas');this.osd.width=320;this.osd.height=240;this.osdx=this.osd.getContext('2d');this.osdSec=-1;
    // The clip, mapped slightly past the corners of the keyed glass so the rounded edges are covered.
    const q=cal.screen.corners,cx=q.reduce((s,p)=>s+p[0],0)/4,cy=q.reduce((s,p)=>s+p[1],0)/4;
    const grown=q.map(([x,y])=>[cx+(x-cx)*1.025,cy+(y-cy)*1.03]);
    const H=invert3(squareToQuad(grown));
    gl.uniformMatrix3fv(u.toScreen,false,[H[0],H[3],H[6],H[1],H[4],H[7],H[2],H[5],H[8]]);
    const [x0,y0,x1,y1]=cal.screen.box,m=6;
    gl.uniform4f(u.box,x0-m,y0-m,x1+m,y1+m);gl.uniform2f(u.screenC,cx,cy);
    gl.uniform2f(u.img,cal.width,cal.height);gl.uniform2f(u.res,canvas.width,canvas.height);
    const L=cal.label;gl.uniform2f(u.lc,L.cx,L.cy);gl.uniform3f(u.lax,L.a,L.b,L.angle);
    const lum=(L.color[0]*.3+L.color[1]*.59+L.color[2]*.11)/255;
    gl.uniform3fv(u.ink,lum<.25?[.93,.9,.82]:[.07,.06,.06]);
    gl.uniform1f(u.motion,reduced?0:1);
    gl.viewport(0,0,canvas.width,canvas.height);
    this.spill=[0,0,0];this.spillAt=0;
    this.probe=document.createElement('canvas');this.probe.width=this.probe.height=4;this.probex=this.probe.getContext('2d',{willReadFrequently:true});
    this.last=0;
  }
  draw(now,force=false){
    if(!this.ready) return;
    if(!force&&now-this.last<(reduced?1000:33)) return;     // 30 fps is plenty for tape
    this.last=now;
    const {gl,u,video}=this;
    if(video.readyState>=2){
      this.upload(1,this.tex.clip,video);
      if(now-this.spillAt>250){
        this.spillAt=now;this.probex.drawImage(video,0,0,4,4);
        const d=this.probex.getImageData(0,0,4,4).data;const s=[0,0,0];
        for(let i=0;i<d.length;i+=4){s[0]+=d[i];s[1]+=d[i+1];s[2]+=d[i+2];}
        const k=.35;this.spill=this.spill.map((v,i)=>v*(1-k)+s[i]/16/255*k);
      }
    }
    const wall=Date.now(),sec=Math.floor(wall/1000);
    if(sec!==this.osdSec){this.osdSec=sec;drawStamp(this.osdx,this.stream.room.stamp,wall);this.upload(3,this.tex.osd,this.osd);}
    gl.useProgram(this.pr);
    const t=(now/1000)%600;
    gl.uniform1f(u.t,t);gl.uniform1f(u.frame,Math.floor(now/1000*29.97)%1024);
    gl.uniform1f(u.spin,reduced?0:(wall/1000*(100/3)/60*2*Math.PI)%(2*Math.PI));
    gl.uniform3fv(u.spill,this.spill);
    gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
  }
}

/**
 * Draw the room for a stream into el.
 * mode 'thumb': lineup card (big station name, no lower third, plays the card's clip).
 * mode 'hero': the stream frame (logo, LIVE, lower third that follows the broadcast clock).
 */
export function renderRoom(el,stream,{mode='hero'}={}){
  if(el._tape){rooms.delete(el._tape);el._tape=null;}
  el.innerHTML='';
  el.className=`room ${mode}${stream.christmas?' christmas':''}`;
  el.style.setProperty('--c',stream.color);
  el.setAttribute('role','img');
  el.setAttribute('aria-label',`${stream.name}: home-video footage of a mid-90s wood-paneled den, a CRT TV playing the station's HIFI TV clip and a record turning on a turntable${stream.christmas?', with Christmas lights, a decorated tree and snow at the window':''}.`);

  const pic=h('div','tape');
  const video=h('video');
  Object.assign(video,{muted:true,loop:true,playsInline:true,autoplay:true,preload:'auto'});
  video.setAttribute('muted','');video.setAttribute('playsinline','');
  video.src=mode==='thumb'?stream.thumb:onAir(stream).clip;
  el.append(pic);
  try{
    const tape=new Tape(el,stream,video,{width:mode==='hero'?768:448});
    pic.append(tape.canvas);
    el._tape=tape;rooms.add(tape);
    if(!loop) loop=requestAnimationFrame(tick);
  }catch(err){
    // No WebGL: the still, softened.
    console.warn('HIFI Live: no WebGL, showing the still.',err);
    pic.append(Object.assign(h('img','still'),{src:stream.room.photo,alt:''}));
  }

  if(mode==='thumb'){
    el.append(h('div','thumb-title',`<b>${esc(stream.name)}</b><span>${esc(stream.mood)}</span>`));
  }else{
    const bug=h('div','bug',`<span class="mark" aria-hidden="true"></span><b>HIFI</b><em>LIVE</em>`);
    const lower=h('div','lower');
    el.append(bug,lower);
    let shown=-1;
    const tickInfo=()=>{
      const air=onAir(stream);
      if(air.index!==shown){
        shown=air.index;
        if(!video.src.endsWith(air.clip)){video.src=air.clip;video.play().catch(()=>{});}
        lower.innerHTML=`<div class="np"><b class="t"></b><span class="a"></span>
          <span class="s">${esc(stream.name)} · ${esc(stream.genre.replace(' / ',' · ').toUpperCase())}</span>
          <span class="bar"><i></i></span><span class="times"><span class="e"></span><span class="r"></span></span></div>`;
        lower.querySelector('.t').textContent=air.track.title;
        lower.querySelector('.a').textContent=air.track.artist+(air.track.year?` · ${air.track.year}`:'');
      }
      lower.querySelector('.bar i').style.width=`${air.elapsed/TRACK_SECONDS*100}%`;
      lower.querySelector('.e').textContent=clock(air.elapsed);
      lower.querySelector('.r').textContent=`-${clock(air.remaining)}`;
    };
    tickInfo();
    el._timer&&clearInterval(el._timer);
    el._timer=setInterval(tickInfo,1000);
  }
  el._video=video;
  if(reduced) video.addEventListener('loadeddata',()=>video.pause(),{once:true});
  else video.play().catch(()=>{});
  return el;
}

// Play and draw only the rooms on screen, so a phone isn't decoding six clips at once.
export function playWhenVisible(els){
  if(!('IntersectionObserver' in window)) return;
  const io=new IntersectionObserver(entries=>{
    for(const e of entries){
      const tape=e.target._tape,v=e.target._video;
      if(tape) tape.visible=e.isIntersecting;
      if(v&&!reduced) e.isIntersecting?v.play().catch(()=>{}):v.pause();
    }
  },{threshold:.05});
  els.forEach(r=>io.observe(r));
}
