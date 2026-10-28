/** Public HIFI site. Asset allowlisting is enforced by the build output. */
// Radio Paradise publishes its current song at a public, keyless endpoint that
// browsers cannot read cross-origin, so the Worker relays it with a short cache.
const RP_NOW_PLAYING = 'https://api.radioparadise.com/api/now_playing?chan=0';
let rpCache = null;
const clean = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
async function radioParadiseNowPlaying() {
  if (rpCache && Date.now() - rpCache.at < 8000) return rpCache;
  const response = await fetch(RP_NOW_PLAYING, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error(`Radio Paradise metadata: ${response.status}`);
  const data = await response.json();
  const artist = clean(data?.artist), title = clean(data?.title);
  if (!title) throw Error('Radio Paradise metadata had no title');
  const time = Number(data?.time);
  rpCache = { at: Date.now(), artist, title, remaining: Number.isFinite(time) && time >= 0 ? Math.min(time, 3600) : null };
  return rpCache;
}
// SomaFM publishes each channel's recent songs (newest first) at a public,
// keyless endpoint. It gives no time remaining, so the relay caches briefly.
const SOMAFM = { 'boot-liquor': 'bootliquor', 'sonic-universe': 'sonicuniverse', 'indie-pop-rocks': 'indiepop' };
const somaCache = new Map();
async function somaFmNowPlaying(channel) {
  const cached = somaCache.get(channel);
  if (cached && Date.now() - cached.at < 20000) return cached;
  const response = await fetch(`https://somafm.com/songs/${channel}.json`, { headers: { Accept: 'application/json', 'User-Agent': 'NatesSoftware-HIFI/1.0 (+https://hifi.nates-software.com)' }, signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw Error(`SomaFM metadata: ${response.status}`);
  const first = (await response.json())?.songs?.[0];
  const artist = clean(first?.artist), title = clean(first?.title);
  if (!title) throw Error('SomaFM metadata had no title');
  const now = { at: Date.now(), artist, title, remaining: null };
  somaCache.set(channel, now);
  return now;
}
// "Listen on Spotify": a search link always works without keys. When the
// Worker has SPOTIFY_CLIENT_ID/SPOTIFY_CLIENT_SECRET it resolves the exact
// track with an app-only token, falling back to the search link on any failure.
const spotifySearch = (artist, title) => `https://open.spotify.com/search/${encodeURIComponent(`${artist} ${title}`.trim()).replace(/'/g, '%27')}`;
const baseName = value => String(value || '').toLowerCase()
  .replace(/\s+[-–]\s+.*(remaster|version|mix|edit|live|mono|stereo|single|radio).*$/, '')
  .replace(/\s*[([][^)\]]*[)\]]/g, '').replace(/&/g, 'and').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const sameName = (a, b) => Boolean(baseName(a)) && baseName(a) === baseName(b);
let spotifyToken = null;
const spotifyTracks = new Map();
async function spotifyAccessToken(env) {
  if (spotifyToken && Date.now() < spotifyToken.expires) return spotifyToken.value;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST', signal: AbortSignal.timeout(5000),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${btoa(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`)}` },
    body: 'grant_type=client_credentials',
  });
  if (!response.ok) throw Error(`Spotify token: ${response.status}`);
  const data = await response.json();
  if (typeof data?.access_token !== 'string') throw Error('Spotify token missing');
  spotifyToken = { value: data.access_token, expires: Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000 - 60000 };
  return spotifyToken.value;
}
async function spotifyLink(env, artist, title) {
  const fallback = { url: spotifySearch(artist, title), id: null };
  if (!env?.SPOTIFY_CLIENT_ID || !env?.SPOTIFY_CLIENT_SECRET) return fallback;
  const key = `${artist}\n${title}`.toLowerCase();
  const cached = spotifyTracks.get(key);
  if (cached && Date.now() < cached.expires) return cached.link;
  let link = fallback;
  try {
    const token = await spotifyAccessToken(env);
    const quote = value => value.replace(/"/g, '');
    const query = artist ? `track:"${quote(title)}" artist:"${quote(artist)}"` : title;
    const response = await fetch(`https://api.spotify.com/v1/search?type=track&limit=5&q=${encodeURIComponent(query)}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) spotifyToken = null;
    if (!response.ok) throw Error(`Spotify search: ${response.status}`);
    // Only an exact title and artist match earns a direct track link; a
    // near miss (another song with a similar name) keeps the search link.
    const items = (await response.json())?.tracks?.items;
    const match = Array.isArray(items) ? items.find(item => sameName(item?.name, title)
      && (!artist || (Array.isArray(item?.artists) && item.artists.some(a => sameName(a?.name, artist))))) : null;
    const id = match?.id;
    if (typeof id === 'string' && TRACK_ID.test(id)) link = { url: `https://open.spotify.com/track/${id}`, id };
  } catch { return fallback; }
  if (spotifyTracks.size > 500) spotifyTracks.delete(spotifyTracks.keys().next().value);
  spotifyTracks.set(key, { link, expires: Date.now() + 6 * 3600 * 1000 });
  return link;
}
const TRACK_ID = /^[A-Za-z0-9]{22}$/;
// Real Spotify metadata for a track, for the nates-software.com share page.
const trackInfo = new Map();
async function track(env, id) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*' };
  if (!TRACK_ID.test(id)) return new Response(JSON.stringify({ error: 'Invalid track id' }), { status: 400, headers });
  if (!env?.SPOTIFY_CLIENT_ID || !env?.SPOTIFY_CLIENT_SECRET) return new Response(JSON.stringify({ error: 'Spotify lookup not configured' }), { status: 503, headers: { ...headers, 'Cache-Control': 'no-store' } });
  const cached = trackInfo.get(id);
  if (cached && Date.now() < cached.expires) return new Response(cached.body, { status: cached.status, headers });
  try {
    const token = await spotifyAccessToken(env);
    const response = await fetch(`https://api.spotify.com/v1/tracks/${id}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    if (response.status === 401) spotifyToken = null;
    if (response.status === 404 || response.status === 400) {
      const body = JSON.stringify({ error: 'Unknown track' });
      trackInfo.set(id, { body, status: 404, expires: Date.now() + 600000 });
      return new Response(body, { status: 404, headers });
    }
    if (!response.ok) throw Error(`Spotify track: ${response.status}`);
    const data = await response.json();
    const images = Array.isArray(data?.album?.images) ? data.album.images : [];
    const image = images.find(i => i?.width >= 300 && i?.width <= 700) || images[0];
    const body = JSON.stringify({
      id, title: clean(data?.name), artists: (Array.isArray(data?.artists) ? data.artists : []).map(a => clean(a?.name)).filter(Boolean).slice(0, 8),
      album: clean(data?.album?.name), image: typeof image?.url === 'string' && image.url.startsWith('https://') ? image.url : null,
      url: `https://open.spotify.com/track/${id}`,
    });
    if (trackInfo.size > 500) trackInfo.delete(trackInfo.keys().next().value);
    trackInfo.set(id, { body, status: 200, expires: Date.now() + 24 * 3600 * 1000 });
    return new Response(body, { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Spotify lookup unavailable' }), { status: 502, headers: { ...headers, 'Cache-Control': 'no-store' } });
  }
}
// Nate's curated "Nate's Software" playlist and the shared Spotify Client ID
// (public; listeners sign in with PKCE), published by nates-software.com.
let configCache = null;
async function spotifyConfig() {
  if (configCache && Date.now() - configCache.at < 300000) return configCache;
  let { playlist = null, clientId = null } = configCache ?? {};
  try {
    const response = await fetch('https://nates-software.com/api/hifi-spotify', { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(4000) });
    if (response.ok) {
      const data = await response.json();
      playlist = typeof data?.playlist === 'string' && data.playlist.startsWith('https://open.spotify.com/playlist/') ? data.playlist : null;
      clientId = typeof data?.clientId === 'string' && /^[0-9a-f]{32}$/i.test(data.clientId) ? data.clientId : null;
    }
  } catch { /* keep the last known values */ }
  configCache = { at: Date.now(), playlist, clientId };
  return configCache;
}
const natePlaylist = async () => (await spotifyConfig()).playlist;
async function nowPlaying(url, env) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
  const station = url.searchParams.get('station');
  const soma = Object.hasOwn(SOMAFM, station) ? SOMAFM[station] : null;
  if (station !== 'radio-paradise' && !soma) return new Response(JSON.stringify({ error: 'Unknown station' }), { status: 404, headers });
  try {
    const now = soma ? await somaFmNowPlaying(soma) : await radioParadiseNowPlaying();
    const elapsed = (Date.now() - now.at) / 1000;
    const remaining = now.remaining === null ? null : Math.max(0, Math.round(now.remaining - elapsed));
    const [spotify, playlist] = await Promise.all([spotifyLink(env, now.artist, now.title), natePlaylist()]);
    return new Response(JSON.stringify({ station, source: soma ? 'somafm.com' : 'radioparadise.com', artist: now.artist, title: now.title, remaining, poll: soma ? 20 : undefined,
      spotify: spotify.url, trackId: spotify.id, share: spotify.id ? `https://nates-software.com/hifi/song/${spotify.id}` : null, playlist }), { headers });
  } catch {
    return new Response(JSON.stringify({ error: 'Now-playing metadata unavailable' }), { status: 502, headers });
  }
}
// Self-contained Windows 95 dialog (inline CSS, no script) shared with Nate's Software error pages.
const notFoundPage = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found — HIFI</title><style>*{box-sizing:border-box}html{background:#008080}body{margin:0;min-height:100vh;min-height:100dvh;display:flex;align-items:center;justify-content:center;padding:16px;background:#008080;color:#000;font:14px/1.5 "MS Sans Serif","Microsoft Sans Serif",Tahoma,Geneva,Verdana,sans-serif}.window{width:100%;max-width:460px;background:#c0c0c0;border:2px solid;border-color:#dfdfdf #000 #000 #dfdfdf;box-shadow:inset 1px 1px #fff,inset -1px -1px #808080,4px 4px 0 rgba(0,0,0,.35);padding:3px}.titlebar{display:flex;align-items:center;justify-content:space-between;background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font-weight:bold;font-size:13px;padding:3px 3px 3px 6px;min-height:22px}.titlebar i{width:16px;height:14px;background:#c0c0c0;border:1px solid;border-color:#fff #000 #000 #fff;color:#000;font:bold 11px/12px Tahoma,sans-serif;font-style:normal;text-align:center}.content{display:flex;gap:14px;padding:18px 16px 14px}.icon{flex:none;width:34px;height:34px;border-radius:50%;background:#000080;color:#fff;font:bold 22px/34px Georgia,serif;text-align:center;box-shadow:1px 1px 0 #808080}h1{margin:0 0 8px;font-size:17px;line-height:1.3}p{margin:0 0 8px}.actions{display:flex;justify-content:flex-end;padding:4px 16px 16px}.button{display:inline-block;min-width:96px;padding:5px 16px;background:#c0c0c0;color:#000;text-align:center;text-decoration:none;font-weight:bold;border:2px solid;border-color:#fff #000 #000 #fff;box-shadow:inset -1px -1px #808080,inset 1px 1px #dfdfdf,0 0 0 1px #000}.button:focus-visible{outline:1px dotted #000;outline-offset:-5px}.status{margin:0 3px;padding:2px 6px;font-size:12px;border:1px solid;border-color:#808080 #fff #fff #808080}@media(max-width:420px){.actions .button{flex:1}}</style></head><body><main class="window" aria-labelledby="heading"><div class="titlebar"><span>HIFI</span><i aria-hidden="true">×</i></div><div class="content"><div class="icon" aria-hidden="true">i</div><div><h1 id="heading">This page isn’t on the air</h1><p>There’s nothing at this address on HIFI. The link may be old or mistyped.</p><p>The radio itself is one click away.</p></div></div><div class="actions"><a class="button" href="/">Open HIFI</a></div><div class="status">HIFI · a little radio from Nate’s Software</div></main></body></html>`;
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', {status:405,headers:{Allow:'GET, HEAD'}});
    if (url.pathname === '/api/now-playing') return nowPlaying(url, env);
    if (url.pathname === '/api/spotify-config') {
      const { playlist, clientId } = await spotifyConfig();
      return new Response(JSON.stringify({ playlist, clientId }), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=60', 'X-Content-Type-Options': 'nosniff' } });
    }
    if (url.pathname.startsWith('/api/track/')) return track(env, url.pathname.slice('/api/track/'.length));
    if (url.pathname === '/player/') return Response.redirect(url.origin + '/player' + url.search, 308);
    if (url.pathname === '/') url.pathname = '/landing.html';
    else if (url.pathname === '/player') url.pathname = '/index.html';
    else if (url.pathname === '/privacy') url.pathname = '/privacy.html';
    else if (url.pathname === '/spotify') url.pathname = '/spotify.html';
    else if (url.pathname === '/download') url.pathname = '/download/HIFI.dmg';
    let response = await env.ASSETS.fetch(new Request(url, request));
    // Browsers asking for a missing page get a readable Win95 dialog, not an empty 404.
    if (response.status === 404 && (request.headers.get('Accept') || '').includes('text/html')) response = new Response(request.method === 'HEAD' ? null : notFoundPage, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    const headers = new Headers(response.headers);
    headers.set('X-Content-Type-Options','nosniff');
    headers.set('Referrer-Policy','strict-origin-when-cross-origin');
    headers.set('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' https://*.radioparadise.com https://*.somafm.com https://streaming.exclusive.radio; connect-src 'self' https://accounts.spotify.com https://api.spotify.com; frame-src 'self'; frame-ancestors 'self' https://nates-software.com https://www.nates-software.com https://*.nates-software.pages.dev; object-src 'none'; base-uri 'self'");
    if (headers.get('Content-Type')?.includes('text/html')) headers.set('Cache-Control','no-cache');
    if (url.pathname.endsWith('.dmg') && response.ok) headers.set('Content-Disposition', 'attachment; filename="HIFI.dmg"');
    // Safari and iMessage only play video and audio that answer byte ranges, and
    // static assets ignore Range, so slice those here.
    if (response.status === 200 && /^(video|audio)\//.test(headers.get('Content-Type') || '')) {
      headers.set('Accept-Ranges', 'bytes');
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
      if (range && request.method === 'GET') {
        const body = await response.arrayBuffer(), size = body.byteLength;
        const start = range[1] === '' ? Math.max(0, size - Number(range[2] || size + 1)) : Number(range[1]);
        const end = range[1] === '' || range[2] === '' ? size - 1 : Math.min(Number(range[2]), size - 1);
        if (!(start <= end && start < size)) { headers.set('Content-Range', `bytes */${size}`); headers.delete('Content-Length'); return new Response(null, { status: 416, headers }); }
        headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
        headers.set('Content-Length', String(end - start + 1));
        return new Response(body.slice(start, end + 1), { status: 206, headers });
      }
    }
    return new Response(response.body,{status:response.status,headers});
  }
};
