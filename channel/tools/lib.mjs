// Shared by the channel tools: a static file server for the bundle, headless Chrome over the DevTools
// protocol (no dependencies: Node's own WebSocket), and paths.
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createReadStream, existsSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const outDir = () => process.env.HIFI_CHANNEL_OUT || join(root, 'out');
export const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
export const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

// argv helper: flags(['--from', '10', 'x']) -> { from: '10', _: ['x'] }
export function flags(argv) {
  const o = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) { const k = a.slice(2); o[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; } else o._.push(a);
  }
  return o;
}

const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.m4a': 'audio/mp4', '.vis': 'application/octet-stream' };
// mounts: [['/sides/', dir], ['/', dir]], first prefix that matches wins. Loopback only.
export function serve(mounts) {
  const server = createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    for (const [prefix, dir] of mounts) {
      if (!path.startsWith(prefix)) continue;
      const file = normalize(join(dir, path.slice(prefix.length)));
      if (!file.startsWith(normalize(dir)) || !existsSync(file) || !statSync(file).isFile()) break;
      const size = statSync(file).size, range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
      const head = { 'content-type': TYPES[extname(file)] || 'application/octet-stream', 'accept-ranges': 'bytes', 'cache-control': 'no-store' };
      if (range) {
        const a = range[1] ? +range[1] : 0, b = range[2] ? +range[2] : size - 1;
        res.writeHead(206, { ...head, 'content-range': `bytes ${a}-${b}/${size}`, 'content-length': b - a + 1 });
        return createReadStream(file, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { ...head, 'content-length': size });
      return createReadStream(file).pipe(res);
    }
    res.writeHead(404).end('not found');
  });
  return new Promise((res) => server.listen(0, '127.0.0.1', () => res({ server, url: `http://127.0.0.1:${server.address().port}` })));
}

// Headless Chrome with GPU WebGL, one page, driven over CDP.
export async function chrome({ width = 1920, height = 1080 } = {}) {
  const profile = mkdtempSync(join(tmpdir(), 'hifi-chrome-'));
  const proc = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, `--window-size=${width},${height}`,
    '--hide-scrollbars', '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1', '--no-first-run',
    '--no-default-browser-check', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--enable-unsafe-swiftshader', 'about:blank'],
  { stdio: ['ignore', 'ignore', 'pipe'] });
  const port = await new Promise((res, rej) => {
    let buf = '';
    const t = setTimeout(() => rej(Error('Chrome did not start')), 20000);
    proc.stderr.on('data', (d) => { buf += d; const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(buf); if (m) { clearTimeout(t); res(+m[1]); } });
    proc.on('exit', (c) => rej(Error(`Chrome exited (${c})`)));
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const ws = new WebSocket(pages.find((p) => p.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const waiting = new Map(), listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) { const { res, rej } = waiting.get(m.id); waiting.delete(m.id); m.error ? rej(Error(m.error.message)) : res(m.result); }
    else if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}) => new Promise((res, rej) => { const id = ++seq; waiting.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); });
  const page = {
    send,
    on: (fn) => listeners.push(fn),
    async eval(expr) {
      const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    },
    async goto(url) {
      const loaded = new Promise((res) => listeners.push((m) => m.method === 'Page.loadEventFired' && res()));
      await send('Page.navigate', { url }); await loaded;
    },
    async shot({ format = 'jpeg', quality = 92, clip } = {}) {
      const r = await send('Page.captureScreenshot', { format, ...(format === 'jpeg' ? { quality } : {}), optimizeForSpeed: true, ...(clip ? { clip: { ...clip, scale: 1 } } : {}) });
      return Buffer.from(r.data, 'base64');
    },
    async size(w, h) { await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false }); },
    async close() { try { ws.close(); } catch {} proc.kill(); await new Promise((r) => setTimeout(r, 300)); rmSync(profile, { recursive: true, force: true }); },
  };
  await send('Page.enable'); await send('Runtime.enable');
  page.on((m) => { if (m.method === 'Runtime.exceptionThrown') console.error('page error:', m.params.exceptionDetails.exception?.description); });
  page.on((m) => { if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) console.error('page:', m.params.args.map((a) => a.value ?? a.description).join(' ')); });
  await page.size(width, height);
  return page;
}

// Is today inside a season {from: 'MM-DD', to: 'MM-DD'} (which may wrap past New Year)? No season: always.
export function inSeason(season, now = new Date()) {
  if (!season) return true;
  const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  return season.from <= season.to ? md >= season.from && md <= season.to : md >= season.from || md <= season.to;
}

// Takes a stream key (and any RTMP URL) out of ffmpeg's output before it is logged.
export const redactor = (key) => (s) => (key ? s.split(key).join('<key>') : s).replace(/rtmps?:\/\/\S+/g, 'rtmps://<ingest>');
