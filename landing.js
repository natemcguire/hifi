const player = document.querySelector('.hero-device iframe');
const frame = player.parentElement;
const origin = location.origin;
const connect = () => player.contentWindow?.postMessage({type:'hifi:connect',version:1},origin);
player.addEventListener('load',()=>{ if(!player.src) return; frame.classList.add('live'); connect(); });
window.addEventListener('message',event=>{
  if(event.origin!==origin || event.source!==player.contentWindow) return;
  const data=event.data;
  if(data?.type==='hifi:height' && Number.isFinite(data.height) && data.height>0) frame.style.height=Math.max(400,Math.min(760,data.height))+'px';
});
// The live player starts loading straight away; until it's ready the hero shows a still of it.
player.src = player.dataset.src;

// About Nate's Software; #about opens it directly.
const about = document.getElementById('about');
for (const button of document.querySelectorAll('.about-open')) button.addEventListener('click', () => { about.showModal(); history.replaceState(null, '', '#about'); });
about.addEventListener('close', () => { if (location.hash === '#about') history.replaceState(null, '', location.pathname); });
about.addEventListener('click', event => { if (event.target === about) about.close(); });
if (location.hash === '#about') about.showModal();

// Mac downloads on an odometer: at least six reels, each rolling up to its digit.
fetch('/api/downloads').then(response => response.ok ? response.json() : null).then(data => {
  if (!Number.isFinite(data?.count)) return;
  const box = document.getElementById('downloads'), meter = box.querySelector('.odometer');
  const digits = String(data.count).padStart(6, '0').split('');
  meter.innerHTML = digits.map((digit, index) => {
    const comma = (digits.length - index) % 3 === 0 && index > 0 ? '<span class="comma">,</span>' : '';
    return `${comma}<span class="digit"><span class="reel">${'0123456789'.split('').map(n => `<b>${n}</b>`).join('')}</span></span>`;
  }).join('');
  box.setAttribute('aria-label', `${data.count.toLocaleString()} Mac downloads`);
  box.hidden = false;
  requestAnimationFrame(() => requestAnimationFrame(() => meter.querySelectorAll('.reel').forEach((reel, index) => {
    reel.style.transitionDelay = `${index * 90}ms`;
    reel.style.transform = `translateY(${-36 * Number(digits[index])}px)`;
  })));
}).catch(() => {});
