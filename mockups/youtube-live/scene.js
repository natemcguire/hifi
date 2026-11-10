// The HIFI Live room: a mid-90s den drawn in HTML/CSS. One function draws it at any size
// (a lineup thumbnail or the full stream frame); everything inside scales with the box.
const h=(tag,cls,html='')=>{const el=document.createElement(tag);if(cls)el.className=cls;if(html)el.innerHTML=html;return el;};
const rand=(seed=>()=>((seed=(seed*16807)%2147483647)-1)/2147483646)(7);
const esc=s=>String(s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Fake broadcast clock, like the app's synth stations: everyone sees the same track.
const TRACK_SECONDS=150;
export function onAir(stream,now=Date.now()){
  const t=now/1000+stream.frequency*37;
  const index=Math.floor(t/TRACK_SECONDS)%stream.tracks.length;
  const elapsed=t%TRACK_SECONDS;
  return {index,track:stream.tracks[index],elapsed,remaining:TRACK_SECONDS-elapsed,clip:stream.tv[index%stream.tv.length]};
}
const clock=s=>`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;

function weather(win,sky){
  const fx=h('div','fx');
  if(sky==='rain'||sky==='snow'){
    const n=sky==='rain'?28:40;
    for(let i=0;i<n;i++){
      const p=h('i');
      p.style.left=`${rand()*104-2}%`;
      p.style.animationDelay=`${-rand()*(sky==='rain'?1.2:9)}s`;
      p.style.animationDuration=`${sky==='rain'?.55+rand()*.5:5+rand()*6}s`;
      if(sky==='snow'){const s=.22+rand()*.38;p.style.width=p.style.height=`${s}cqw`;p.style.opacity=.5+rand()*.5;}
      fx.append(p);
    }
  }
  if(sky==='night'||sky==='snow'||sky==='dusk') for(let i=0;i<14;i++){const star=h('b');star.style.left=`${rand()*100}%`;star.style.top=`${rand()*45}%`;star.style.animationDelay=`${-rand()*4}s`;fx.append(star);}
  win.append(fx);
}

// Christmas lights: a sagging wire across the top of the paneling, bulbs that twinkle.
function lights(){
  const wrap=h('div','xmas-lights');
  const pts=[];const bulbs=[];
  for(let x=0;x<=100;x+=.5){const u=(x%20)/10-1;pts.push(`${x},${2+5*(1-u*u)}`);}
  wrap.innerHTML=`<svg viewBox="0 0 100 10" preserveAspectRatio="none"><polyline points="${pts.join(' ')}"/></svg>`;
  const colors=['#ff5a4f','#ffd25e','#5fd47a','#5aa8ff','#ff8ad8'];
  for(let i=0,x=1.5;x<100;i++,x+=3.2){
    const u=(x%20)/10-1;const b=h('i');
    b.style.left=`${x}%`;b.style.top=`${(2+5*(1-u*u))*10}%`;
    b.style.setProperty('--b',colors[i%colors.length]);b.style.animationDelay=`${-rand()*3}s`;
    bulbs.push(b);
  }
  wrap.append(...bulbs);
  return wrap;
}

function tree(){
  const t=h('div','tree','<span class="star"></span><span class="tier t1"></span><span class="tier t2"></span><span class="tier t3"></span><span class="trunk"></span>');
  const colors=['#ff5a4f','#ffd25e','#5fd47a','#5aa8ff'];
  for(let i=0;i<22;i++){
    const y=14+rand()*72, spread=(y/100)*42;const d=h('i');
    d.style.top=`${y}%`;d.style.left=`${50+(rand()*2-1)*spread}%`;
    d.style.setProperty('--b',colors[i%4]);d.style.animationDelay=`${-rand()*2.4}s`;t.append(d);
  }
  return t;
}

/**
 * Draw the room for a stream into el.
 * mode 'thumb': lineup card (big station name, no lower third, plays the card's clip).
 * mode 'hero': the stream frame (logo, LIVE, lower third that follows the broadcast clock).
 */
export function renderRoom(el,stream,{mode='hero'}={}){
  el.innerHTML='';
  el.className=`room ${mode} sky-${stream.sky}${stream.christmas?' christmas':''}`;
  el.style.setProperty('--c',stream.color);
  el.setAttribute('role','img');
  el.setAttribute('aria-label',`${stream.name}: a mid-90s wood-paneled room with a lava lamp, a CRT TV playing the station's HIFI TV clip and a record spinning on a turntable${stream.christmas?', with Christmas lights, a small tree and snow outside':''}.`);

  const wall=h('div','wall');
  const win=h('div','window','<div class="sky"></div><div class="skyline"></div>');
  weather(win,stream.sky);
  win.append(h('div','mullions'),h('div','sill'));
  const curtains=h('div','curtains','<span></span><span></span>');
  const print=h('div','print','<div class="mat"><span class="art"><i></i><i></i><i></i></span><small>HIFI</small></div>');
  const lamp=h('div','lava','<span class="cap"></span><span class="glass"><b></b><b></b><b></b><b></b></span><span class="base"></span>');
  const stand=h('div','stand','<span class="drawer"></span><span class="drawer"></span><span class="vcr"><em>12:00</em></span>');

  const clip=mode==='thumb'?stream.thumb:onAir(stream).clip;
  const tv=h('div','tv');
  tv.innerHTML=`<div class="bezel"><div class="screen">
      <video muted loop playsinline autoplay preload="metadata" poster="${mode==='thumb'?esc(stream.poster):''}" src="${esc(clip)}"></video>
      <span class="scan"></span><span class="noise"></span><span class="band"></span><span class="glare"></span>
      <span class="osd"><span>PLAY ▶</span><span>CH ${esc(stream.frequency)}</span></span>
    </div></div>
    <div class="controls"><i></i><i></i><span class="grille"></span><b></b></div>`;

  const deck=h('div','deck');
  deck.innerHTML=`<div class="plinth">
      <div class="platter"><div class="strobe"></div>
        <div class="record"><div class="label"><span>HIFI</span><small>${esc(stream.name)}</small></div></div>
        <div class="sheen"></div>
      </div>
      <div class="arm"><span class="pivot"></span><span class="tube"></span><span class="head"></span></div>
      <span class="knob k1"></span><span class="knob k2"></span><span class="led"></span>
    </div>`;

  const glow=h('div','glow');
  el.append(wall,glow,win,curtains,print);
  if(stream.christmas) el.append(lights(),tree());
  el.append(lamp,stand,tv,deck,h('div','vignette'));

  if(mode==='thumb'){
    el.append(h('div','thumb-title',`<b>${esc(stream.name)}</b><span>${esc(stream.mood)}</span>`));
  }else{
    const bug=h('div','bug',`<span class="mark" aria-hidden="true"></span><b>HIFI</b><em>LIVE</em>`);
    const lower=h('div','lower');
    el.append(bug,lower);
    let shown=-1;
    const video=tv.querySelector('video');
    const tick=()=>{
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
    tick();
    el._timer&&clearInterval(el._timer);
    el._timer=setInterval(tick,1000);
  }
  const video=tv.querySelector('video');
  video.play().catch(()=>{});
  return el;
}

// Play only the rooms on screen, so a phone isn't decoding six clips at once.
export function playWhenVisible(rooms){
  if(!('IntersectionObserver' in window)) return;
  const io=new IntersectionObserver(entries=>{
    for(const e of entries){const v=e.target.querySelector('video');if(!v)continue;e.isIntersecting?v.play().catch(()=>{}):v.pause();}
  },{threshold:.2});
  rooms.forEach(r=>io.observe(r));
}
