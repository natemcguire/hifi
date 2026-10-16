const player = document.querySelector('.hero-player iframe');
const origin = location.origin;
const connect = () => player.contentWindow?.postMessage({type:'hifi:connect',version:1},origin);
player.addEventListener('load',connect);
window.addEventListener('message',event=>{
  if(event.origin!==origin || event.source!==player.contentWindow) return;
  const data=event.data;
  if(data?.type==='hifi:height' && Number.isFinite(data.height) && data.height>0) player.style.height=Math.max(120,Math.min(1400,data.height))+'px';
});
connect();
