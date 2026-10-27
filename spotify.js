import { createStorage } from './engine/storage.js';

// Spotify sends listeners back here (through nates-software.com's registered
// redirect) after they sign in from the player. This page finishes the PKCE
// exchange in the browser and leaves the tokens where the player reads them.
const REDIRECT = 'https://nates-software.com/hifi/spotify/callback';
const isClientId = text => /^[0-9a-f]{32}$/i.test(String(text));
const tokens = createStorage('hifi.spotify', { defaults: () => null, validate: v => v && typeof v.refresh === 'string' && isClientId(v.clientId) });
const pending = createStorage('hifi.spotify.pending', { defaults: () => null, validate: v => v && typeof v.state === 'string' && typeof v.verifier === 'string' });
const result = createStorage('hifi.spotify.result', { defaults: () => null, validate: v => v && typeof v.error === 'string' });
const params = new URLSearchParams(location.search);
history.replaceState(null, '', location.pathname);  // the code is single-use; keep it out of history

function finish(heading, note, ok) {
  document.getElementById('heading').textContent = heading;
  document.getElementById('note').textContent = note;
  document.body.classList.toggle('done', ok);
  // A pop-up from the player closes itself; a full-page sign-in goes back.
  if (window.opener) setTimeout(() => window.close(), ok ? 900 : 2500);
  else if (ok) setTimeout(() => location.replace('/player'), 900);
}
function failed(message) {
  result.set({ error: message });
  finish("Spotify wasn't connected", message, false);
}

const started = pending.get();
pending.remove();
if (params.get('error')) failed(params.get('error') === 'access_denied' ? "Spotify wasn't connected." : "Spotify sign-in didn't finish. Try again.");
else if (!started || started.state !== params.get('state') || !params.get('code') || Date.now() - started.at > 15 * 60_000 || !isClientId(started.clientId)) failed("Spotify sign-in didn't finish. Try again.");
else {
  try {
    const response = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code: params.get('code'), redirect_uri: REDIRECT, code_verifier: started.verifier, client_id: started.clientId }) });
    const data = await response.json();
    if (!response.ok || typeof data?.access_token !== 'string' || typeof data?.refresh_token !== 'string') throw Error('Spotify token exchange failed');
    tokens.set({ clientId: started.clientId, refresh: data.refresh_token, access: data.access_token, expires: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60000 });
    result.remove();
    finish('Spotify is connected', 'Every ♥ in HIFI now lands in your Liked Songs.', true);
  } catch { failed("Spotify sign-in didn't finish. Try again."); }
}
