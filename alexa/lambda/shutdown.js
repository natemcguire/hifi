'use strict';
// Railway stops the old container with SIGTERM on every deploy. A process that dies of the
// signal or exits non-zero is reported as "Deployment crashed" (and emailed), so finish the
// requests in flight and exit 0. As PID 1 (railway.json starts node directly, not through
// npm) node would ignore SIGTERM without a handler.

function exitOnSignal(server, { name = 'server', graceMs = 5000, log = console.log } = {}) {
  const stop = (signal) => {
    log(`${name} stopping (${signal})`);
    server.close(() => process.exit(0));
    server.closeIdleConnections?.();
    setTimeout(() => process.exit(0), graceMs).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
}

module.exports = { exitOnSignal };
