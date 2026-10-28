// A video station for the native apps: the same rotation as the web player,
// played with YouTube's privacy-enhanced player. The app shows this page on its
// screen and hears what's playing through the `hifi` message handler.
import { rotationAt } from './engine/scheduler.js';

const post = message => window.webkit?.messageHandlers?.hifi?.postMessage(message);
const id = new URLSearchParams(location.search).get('station');
const catalog = await (await fetch('stations.json', { cache: 'no-cache' })).json();
const station = (catalog.videoStations || []).find(s => s.id === id);
const tracks = station ? (await (await fetch(station.playlist)).json()).filter(t => t.youtube && t.duration > 0) : [];
if (!tracks.length) post({ problem: 'This station is off the air.' });
else {
  let track = null, player = null, timer = 0;
  const announce = () => post({ title: track.title, artist: track.artist });
  const next = () => { track = tracks[(tracks.indexOf(track) + 1) % tracks.length]; player.loadVideoById(track.youtube); announce(); };
  const now = rotationAt(tracks, catalog.epoch);
  track = now.track;
  window.onYouTubeIframeAPIReady = () => {
    player = new YT.Player('v', {
      host: 'https://www.youtube-nocookie.com', width: '100%', height: '100%', videoId: track.youtube,
      playerVars: { autoplay: 1, start: Math.floor(now.offset), playsinline: 1, rel: 0, iv_load_policy: 3 },
      events: {
        onReady: event => { event.target.playVideo(); announce(); },
        onStateChange: event => {
          if (event.data === YT.PlayerState.PLAYING) post({ playing: true });
          if (event.data === YT.PlayerState.ENDED) next();
        },
        // A video that won't play here is skipped.
        onError: () => { clearTimeout(timer); timer = setTimeout(next, 1200); },
      },
    });
  };
  const script = document.createElement('script');
  script.src = 'https://www.youtube.com/iframe_api';
  document.head.append(script);
}
