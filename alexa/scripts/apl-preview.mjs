// Draws the skill's Echo screen (HIFI TV) the way each Echo device would and saves a PNG per
// device in .scratch/apl/. It asks the skill itself for the screen (a request with that device's
// viewport), then draws the RenderDocument with Amazon's APL renderer (the WebAssembly build the
// Alexa Skills Toolkit's APL preview loads) in headless Google Chrome, and taps the right arrow
// to check it sends "next". Heavy: run it on the MacBook Pro or Air, never on the mini.
//
// playwright-core lives in the git-ignored .scratch/pw (npm i --prefix .scratch/pw playwright-core):
//   node ~/Projects/assistant/scripts/heavy.mjs -- node alexa/scripts/apl-preview.mjs [station-id] [device-id …]
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../', import.meta.url));
const out = root + '.scratch/apl/';
mkdirSync(out, { recursive: true });
const { chromium } = await import(process.env.PW || root + '.scratch/pw/node_modules/playwright-core/index.mjs');
const { skill } = require('../lambda/index.js');
const RENDERER = `https://d2o906d8ln7ui1.cloudfront.net/apl-wasm-${process.env.APL_WASM || '2024.2'}.js`;

// The Echo screens, in dp, with the dpi each reports (the Alexa Skills Toolkit's device list).
const DEVICES = [
  { id: 'echo-show-5', name: 'Echo Show 5', width: 960, height: 480, dpi: 160, shape: 'rectangle', mode: 'hub' },
  { id: 'echo-show-8', name: 'Echo Show 8', width: 960, height: 600, dpi: 213, shape: 'rectangle', mode: 'hub' },
  { id: 'echo-show-10', name: 'Echo Show 10 / Echo Hub', width: 1280, height: 800, dpi: 160, shape: 'rectangle', mode: 'hub' },
  { id: 'echo-show-15', name: 'Echo Show 15 / 21', width: 1920, height: 1080, dpi: 160, shape: 'rectangle', mode: 'hub' },
  { id: 'echo-show-15-portrait', name: 'Echo Show 15 portrait', width: 1080, height: 1920, dpi: 160, shape: 'rectangle', mode: 'hub' },
  { id: 'echo-spot-round', name: 'Echo Spot (round)', width: 480, height: 480, dpi: 160, shape: 'round', mode: 'hub' },
  { id: 'fire-tv', name: 'Fire TV', width: 960, height: 540, dpi: 320, shape: 'rectangle', mode: 'tv' },
];
const only = process.argv.slice(2).filter(a => !a.startsWith('-'));
const stationId = only.find(a => !DEVICES.some(d => d.id === a)) || 'jazz24';
const devices = DEVICES.filter(d => !only.some(a => DEVICES.some(x => x.id === a)) || only.includes(d.id));

let n = 0;
async function ask(device, request, screenToken) {
  const user = `amzn1.ask.account.preview-${device.id}-${process.pid}`;
  const px = v => Math.round(v * device.dpi / 160);
  const envelope = {
    version: '1.0',
    session: { new: !screenToken, sessionId: `s-${device.id}`, application: { applicationId: 'a' }, user: { userId: user } },
    context: {
      System: {
        application: { applicationId: 'a' }, user: { userId: user },
        device: { deviceId: `d-${device.id}`, supportedInterfaces: { AudioPlayer: {}, 'Alexa.Presentation.APL': { runtime: { maxVersion: '2024.2' } } } },
      },
      AudioPlayer: { playerActivity: 'IDLE' },
      ...(screenToken ? { 'Alexa.Presentation.APL': { token: screenToken, componentsVisibleOnScreen: [] } } : {}),
      Viewport: {
        experiences: [{ canRotate: false, canResize: false }], mode: device.mode.toUpperCase(), shape: device.shape.toUpperCase(),
        pixelWidth: px(device.width), pixelHeight: px(device.height), dpi: device.dpi,
        currentPixelWidth: px(device.width), currentPixelHeight: px(device.height),
        touch: device.mode === 'tv' ? [] : ['SINGLE'], keyboard: device.mode === 'tv' ? ['DIRECTION'] : [],
        video: { codecs: ['H_264_42', 'H_264_41'] },
      },
    },
    request: { requestId: `r${n++}`, timestamp: new Date().toISOString(), locale: 'en-US', ...request },
  };
  const { response } = await skill.invoke(envelope);
  return response;
}

const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
const problems = [];
for (const device of devices) {
  const stations = await require('../lambda/catalog.js').stations();
  const station = stations.find(s => s.id === stationId);
  if (!station) throw Error(`no station ${stationId}`);
  const response = await ask(device, {
    type: 'IntentRequest', dialogState: 'COMPLETED',
    intent: { name: 'PlayStationIntent', confirmationStatus: 'NONE', slots: { station: { name: 'station', value: station.name, confirmationStatus: 'NONE' } } },
  });
  const render = (response.directives || []).find(d => d.type === 'Alexa.Presentation.APL.RenderDocument');
  if (!render) { problems.push(`${device.name}: no screen in the response`); continue; }
  // The renderer takes the screen in pixels and works out dp from the dpi, as a device does.
  const W = Math.round(device.width * device.dpi / 160), H = Math.round(device.height * device.dpi / 160);
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const events = [], errors = [];
  page.on('console', m => { const t = m.text(); if (t.startsWith('SendEvent ')) events.push(JSON.parse(t.slice(10))); else if (m.type() === 'error') errors.push(t); });
  page.on('pageerror', e => errors.push(String(e)));
  await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;background:#000;overflow:hidden}</style>
    <script src="${RENDERER}"></script></head><body><div id="apl" style="position:relative;width:${W}px;height:${H}px;${device.shape === 'round' ? 'border-radius:50%;overflow:hidden;' : ''}"></div></body></html>`);
  await page.evaluate(async ({ document, datasources, device, W, H }) => {
    const step = async (name, f) => { try { return await f(); } catch (e) { throw new Error(name + ': ' + (e?.message || e) + ' ' + (typeof e === 'number' && window.Module?.getExceptionMessage ? window.Module.getExceptionMessage(e) : '')); } };
    await step('initEngine', () => window.AplRenderer.initEngine());
    const content = await step('Content.create', () => window.AplRenderer.Content.create(JSON.stringify(document)));
    for (const name of document.mainTemplate.parameters || []) await step('addData ' + name, () => content.addData(name, JSON.stringify(datasources[name] || {})));
    const renderer = await step('create', () => window.AplRenderer.default.create({
      content, view: window.document.getElementById('apl'), theme: 'dark', mode: device.mode.toUpperCase(),
      environment: { agentName: 'HIFI preview', agentVersion: '1.0', allowOpenUrl: false, disallowVideo: false },
      viewport: { width: W, height: H, dpi: device.dpi, shape: device.shape.toUpperCase() },
      utcTime: Date.now(), localTimeAdjustment: 0,
      onSendEvent: e => console.log('SendEvent ' + JSON.stringify(e.arguments || e)),
    }));
    window.renderer = renderer;
    await step('init', () => renderer.init());
  }, { document: render.document, datasources: render.datasources, device, W, H });
  await page.waitForTimeout(7000);
  await page.screenshot({ path: `${out}${device.id}.png` });
  // Tap the right arrow (bottom right); the screen should send ["hifi-dial", "next"].
  if (device.mode !== 'tv') {
    const strip = await page.evaluate(() => {
      const el = [...document.querySelectorAll('#apl *')].find(e => e.id === 'hifi-next' || e.getAttribute?.('data-id') === 'hifi-next');
      if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height };
    });
    // Otherwise the middle of the right arrow, from the strip's size (dial-hint.js).
    const u = Math.min(device.height, device.width * 0.625), round = device.shape === 'round';
    const tall = Math.max(u * 0.21, 96), bottom = round ? device.height * 0.1 : 0;
    const right = (round ? device.width * 0.12 : device.width * 0.02) + Math.max(u * 0.03, 12) + Math.max(u * 0.11, 44) / 2;
    const scale = device.dpi / 160;
    const at = strip || { x: (device.width - right) * scale, y: (device.height - bottom - tall / 2) * scale };
    await page.mouse.click(at.x, at.y);
    await page.waitForTimeout(500);
    const next = events.some(e => Array.isArray(e) && e[0] === 'hifi-dial' && e[1] === 'next');
    if (!next) problems.push(`${device.name}: tapping the right arrow at ${Math.round(at.x)},${Math.round(at.y)} sent ${JSON.stringify(events)}`);
    // Tap the picture: both videos pause and the pause line shows.
    await page.mouse.click(W / 2, H * 0.35);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}${device.id}-paused.png` });
    console.log(`${device.name}: right arrow ${strip ? `${Math.round(strip.w)}x${Math.round(strip.h)} dp` : '(position guessed)'}, tap → ${next ? 'next' : 'nothing'}`);
  }
  if (errors.length) problems.push(`${device.name}: ${errors.slice(0, 3).join(' | ')}`);
  console.log(`${device.name}: ${out}${device.id}.png`);
  await page.close();
}
await browser.close();
if (problems.length) { console.log('PROBLEMS\n' + problems.join('\n')); process.exitCode = 1; }
