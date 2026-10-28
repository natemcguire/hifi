// Reads every track of a public playlist with the owner's Spotify connection.
// The token is never printed; the rotated refresh token is saved straight back.
import { execFileSync } from 'node:child_process';
import { writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const [playlist, out] = process.argv.slice(2);
const CLIENT = '7a09f5c334e4432980a0c07b2aaac215', DB = 'nates-software-prod-v2';
const d1 = args => execFileSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', DB, '--remote', '--json', ...args], { cwd: '/Volumes/MacMiniExtra/Projects/nates_software', encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
const row = JSON.parse(d1(['--command', "SELECT value FROM site_state WHERE key = 'spotify_owner_auth'"]))[0].results[0];
const auth = JSON.parse(row.value);
const res = await fetch('https://accounts.spotify.com/api/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: CLIENT, grant_type: 'refresh_token', refresh_token: auth.refresh }) });
const data = await res.json();
if (!res.ok || !data.access_token) throw new Error('refresh failed ' + res.status);
const next = { ...auth, access: data.access_token, refresh: data.refresh_token || auth.refresh, expires: Date.now() + (data.expires_in || 3600) * 1000 - 60000 };
const dir = mkdtempSync(join(tmpdir(), 'sp-')), sql = join(dir, 'w.sql');
const q = s => "'" + s.replaceAll("'", "''") + "'";
writeFileSync(sql, `UPDATE site_state SET value = ${q(JSON.stringify(next))}, updated_at = ${Date.now()} WHERE key = 'spotify_owner_auth';`, { mode: 0o600 });
try { d1(['--file', sql, '--yes']); } finally { rmSync(dir, { recursive: true, force: true }); }
const check = JSON.parse(JSON.parse(d1(['--command', "SELECT value FROM site_state WHERE key = 'spotify_owner_auth'"]))[0].results[0].value);
console.log('owner token saved back:', check.refresh === next.refresh);
const tracks = []; let url = `https://api.spotify.com/v1/playlists/${playlist}/tracks?limit=100&fields=next,total,items(track(name,uri,duration_ms,artists(name),album(name)))`;
while (url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + next.access } });
  const page = await r.json();
  if (!r.ok) throw new Error('playlist read failed ' + r.status + ' ' + JSON.stringify(page).slice(0, 200));
  for (const { track } of page.items) if (track?.uri?.startsWith('spotify:track:')) tracks.push({ title: track.name, artist: track.artists.map(a => a.name).join(', '), album: track.album?.name, duration: track.duration_ms / 1000, spotify: track.uri });
  console.log('read', tracks.length, 'of', page.total); url = page.next;
}
writeFileSync(out, JSON.stringify(tracks, null, 1));
