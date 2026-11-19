'use strict';
// HIFI radio for Alexa as an HTTPS endpoint (Railway). The adapter checks every request's
// Alexa signature and timestamp before the skill sees it. Logs are JSON lines (log.js): each
// request gets an id that every line it causes carries, a request that fails is logged with
// its stack, and an uncaught exception or unhandled rejection is logged before the exit.

const crypto = require('node:crypto');
const { log, withRequest, errorFields, installCrashHandlers } = require('./log');

installCrashHandlers();

const express = require('express');
const { ExpressAdapter } = require('ask-sdk-express-adapter');
const { skill } = require('./index');
const { exitOnSignal } = require('./shutdown');

const startedAt = new Date().toISOString();
const app = express();
app.disable('x-powered-by');

// Railway's edge sends X-Railway-Request-Id; anything else gets a fresh id.
const ID = /^[A-Za-z0-9._:-]{8,100}$/;
app.use((req, res, next) => {
  const given = req.get('x-railway-request-id') || req.get('x-request-id');
  const id = ID.test(given || '') ? given : crypto.randomUUID();
  res.set('X-Request-Id', id);
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    if (req.path === '/health') return;
    const ms = Number((process.hrtime.bigint() - started) / 1000000n);
    withRequest(id, () => log(res.statusCode >= 500 ? 'error' : 'info', `${req.method} ${req.path} ${res.statusCode} ${ms}ms`,
      { event: 'http', method: req.method, path: req.path, status: res.statusCode, ms }));
  });
  withRequest(id, next);
});

app.get('/', (req, res) => res.type('text').send('HIFI radio for Alexa'));
// For Railway's deploy check and the Assistant's monitor: up, since when, which build.
app.get('/health', (req, res) => res.json({
  ok: true, startedAt, uptimeS: Math.round(process.uptime()),
  commit: process.env.RAILWAY_GIT_COMMIT_SHA || null, deployment: process.env.RAILWAY_DEPLOYMENT_ID || null,
}));
app.post('/alexa', new ExpressAdapter(skill, true, true).getRequestHandlers());

// A request that throws past the adapter: logged with its stack, answered 500.
app.use((err, req, res, next) => {
  log('error', `request failed: ${err?.message ?? err}`, { event: 'request_error', method: req.method, path: req.path, ...errorFields(err) });
  if (res.headersSent) return next(err);
  res.status(500).json({ error: 'internal error' });
});

const port = process.env.PORT ? Number(process.env.PORT) : 3000;
const server = app.listen(port, () => {
  const { port: bound } = server.address();
  log('info', `HIFI radio for Alexa listening on ${bound}`, { event: 'start', port: bound, startedAt });
});

exitOnSignal(server, { name: 'HIFI radio for Alexa', log: (message) => log('info', message, { event: 'stop' }) });
