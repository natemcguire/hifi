'use strict';
// The endpoint's log is the evidence a crash leaves: JSON lines Railway can filter by level,
// each request's lines tagged with its id, and an uncaught exception or unhandled rejection
// logged with its stack before the process exits.
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const path = require('node:path');
const { log, withRequest, setWriter } = require('./log');

const lines = (text) => String(text).split('\n').filter((l) => l.startsWith('{')).map((l) => JSON.parse(l));

function run(args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: __dirname, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  const exited = new Promise((resolve) => child.on('exit', (code, signal) => resolve({ code, signal, out: () => out })));
  return { child, exited, out: () => out };
}

test('a line is one JSON object with level and message, and carries the request id across awaits', async () => {
  const written = [];
  setWriter((l) => written.push(JSON.parse(l)));
  try {
    log('info', 'outside');
    await withRequest('req-12345678', async () => {
      await new Promise((r) => setTimeout(r, 5));
      log('error', 'inside', { event: 'x' });
    });
  } finally { setWriter((l) => process.stdout.write(l + '\n')); }
  assert.deepStrictEqual(written[0], { level: 'info', message: 'outside' });
  assert.deepStrictEqual(written[1], { level: 'error', message: 'inside', requestId: 'req-12345678', event: 'x' });
});

for (const [kind, code] of [['uncaught_exception', "setTimeout(() => { throw new Error('boom in a timer'); }, 10);"],
  ['unhandled_rejection', "Promise.reject(new Error('boom in a promise'));"]]) {
  test(`${kind.replace('_', ' ')} is logged with its stack, then the process exits 1`, async () => {
    const script = `require(${JSON.stringify(path.join(__dirname, 'log.js'))}).installCrashHandlers(); ${code}`;
    const { exited } = run(['-e', script]);
    const { code: exit, out } = await exited;
    assert.strictEqual(exit, 1);
    const [line] = lines(out());
    assert.strictEqual(line.level, 'error');
    assert.strictEqual(line.event, kind);
    assert.match(line.message, /boom in a/);
    assert.match(line.stack, /Error: boom in a/);
  });
}

test('the endpoint answers /health and logs each request with the id it returns', async (t) => {
  const server = run(['server.js'], { PORT: '0', RAILWAY_DEPLOYMENT_ID: 'dep-test' });
  t.after(() => server.child.kill('SIGKILL'));
  const port = await new Promise((resolve, reject) => {
    const timer = setInterval(() => {
      const start = lines(server.out()).find((l) => l.event === 'start');
      if (start) { clearInterval(timer); resolve(start.port); }
    }, 50);
    setTimeout(() => { clearInterval(timer); reject(new Error('server did not start')); }, 30000);
  });
  const health = await (await fetch(`http://127.0.0.1:${port}/health`)).json();
  assert.strictEqual(health.ok, true);
  assert.strictEqual(health.deployment, 'dep-test');
  assert.ok(Date.parse(health.startedAt));
  // Not signed by Alexa: the adapter refuses it, and the refusal is a logged request.
  const res = await fetch(`http://127.0.0.1:${port}/alexa`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  assert.ok(res.status >= 400);
  const id = res.headers.get('x-request-id');
  assert.match(id, /^[0-9a-f-]{36}$/);
  await new Promise((r) => setTimeout(r, 100));
  const line = lines(server.out()).find((l) => l.event === 'http' && l.path === '/alexa');
  assert.strictEqual(line.requestId, id);
  assert.strictEqual(line.status, res.status);
  assert.ok(!lines(server.out()).some((l) => l.path === '/health'), 'health checks are not logged');
  server.child.kill('SIGTERM');
  assert.strictEqual((await server.exited).code, 0);
});
