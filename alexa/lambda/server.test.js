'use strict';
// A deploy stops the old container with SIGTERM; the endpoint must exit 0 so Railway does not
// report every deploy as "Deployment crashed". The child is a bare http server with the same
// shutdown hook as server.js, so the test does not wait on loading the skill.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

test('server.js exits 0 on SIGTERM', () => {
  assert.match(fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8'), /exitOnSignal\(server/);
});

test('SIGTERM closes the server and exits with code 0', async (t) => {
  const script = `
    const server = require('node:http').createServer((q, r) => r.end('ok'));
    require(${JSON.stringify(path.join(__dirname, 'shutdown.js'))}).exitOnSignal(server, { log() {} });
    server.listen(0, () => console.log('port ' + server.address().port));`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
  t.after(() => child.kill('SIGKILL'));
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal })));
  const port = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('server did not start')), 30000);
    child.stdout.on('data', (d) => {
      const m = /port (\d+)/.exec(String(d));
      if (m) { clearTimeout(timer); resolve(m[1]); }
    });
  });
  assert.strictEqual(await (await fetch(`http://127.0.0.1:${port}/`)).text(), 'ok');
  child.kill('SIGTERM');
  assert.deepStrictEqual(await exited, { code: 0, signal: null });
});
