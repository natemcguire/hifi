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
// The live player comes in after the page has loaded; until then the hero shows a still of it.
const start = () => { player.src = player.dataset.src; };
const idle = () => (window.requestIdleCallback || setTimeout)(start, {timeout: 1500});
if (document.readyState === 'complete') idle(); else addEventListener('load', idle, {once: true});

// About Nate's Software; #about opens it directly.
const about = document.getElementById('about');
for (const button of document.querySelectorAll('.about-open')) button.addEventListener('click', () => { about.showModal(); history.replaceState(null, '', '#about'); });
about.addEventListener('close', () => { if (location.hash === '#about') history.replaceState(null, '', location.pathname); });
about.addEventListener('click', event => { if (event.target === about) about.close(); });
if (location.hash === '#about') about.showModal();
