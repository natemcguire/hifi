import { chromium } from 'playwright-core';
const out = process.argv[2];
const browser = await chromium.connectOverCDP('http://127.0.0.1:9333');
const ctx = await browser.newContext({ viewport: { width: 340, height: 544 }, deviceScaleFactor: 3,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/156.0.0.0 Safari/537.36' });
const page = await ctx.newPage();
const srcs = [];
page.on('request', r => { if (/\.mp3/.test(r.url())) srcs.push(r.url()); });
await page.goto('https://hifi.nates-software.com/player', { waitUntil: 'load' });
await page.waitForTimeout(3500);
const shot = async (name, wait = 500) => { await page.waitForTimeout(wait); await page.screenshot({ path: `${out}/${name}.png` }); };
await shot('main-0');
await page.keyboard.press('ArrowDown'); await shot('main-1');
await page.keyboard.press('ArrowDown'); await shot('main-2');
await page.keyboard.press('Enter'); await shot('synth-0', 900);
await page.keyboard.press('ArrowDown'); await shot('synth-1');
const elapsed = () => page.evaluate(() => { const m = document.body.innerText.match(/\n(\d+):(\d\d)\n-(\d+):(\d\d)/); return m ? { e: +m[1] * 60 + +m[2], left: +m[3] * 60 + +m[4] } : null; });
await page.keyboard.press('Enter');
await page.waitForTimeout(2500);
const info = { track: null, frames: [] };
for (let i = 0; i < 9; i++) {
  const before = (await elapsed())?.e;
  for (let t = 0; t < 25; t++) { const now = (await elapsed())?.e; if (now !== before) break; await page.waitForTimeout(40); }
  await page.waitForTimeout(150);
  const e = await elapsed();
  await page.screenshot({ path: `${out}/np-${i}.png` });
  info.frames.push(e);
}
info.track = srcs.at(-1);
info.text = await page.evaluate(() => document.querySelector('.screen, #screen')?.innerText);
console.log(JSON.stringify(info, null, 1));
await page.close(); await browser.close();
