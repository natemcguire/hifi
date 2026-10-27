const player = document.querySelector('.hero-device iframe');
const origin = location.origin;
const connect = () => player.contentWindow?.postMessage({type:'hifi:connect',version:1},origin);
player.addEventListener('load',connect);
window.addEventListener('message',event=>{
  if(event.origin!==origin || event.source!==player.contentWindow) return;
  const data=event.data;
  if(data?.type==='hifi:height' && Number.isFinite(data.height) && data.height>0) player.style.height=Math.max(400,Math.min(760,data.height))+'px';
});
connect();
// The Mac button appears once a notarized DMG is published (ios/scripts/build-dmg.sh).
fetch('/download/HIFI.dmg',{method:'HEAD',cache:'no-store'}).then(response=>{if(response.ok)document.getElementById('mac').hidden=false;}).catch(()=>{});
