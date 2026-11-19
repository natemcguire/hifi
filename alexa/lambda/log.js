'use strict';
// Structured log lines for the Railway endpoint: one JSON object per line on stdout. Railway
// reads `level` and `message` (so `@level:error` finds them) and keeps the other fields as
// attributes. Every line written while a request is handled carries its `requestId`, and a
// crash leaves its stack trace before the process exits, so a crash can be debugged from the
// log alone. The Assistant's Railway monitor reads the error lines.
const { AsyncLocalStorage } = require('node:async_hooks');

const context = new AsyncLocalStorage();
let write = (line) => process.stdout.write(line + '\n');

function errorFields(err) {
  if (err instanceof Error) return { error: err.message, errorName: err.name, stack: err.stack };
  return { error: typeof err === 'string' ? err : JSON.stringify(err) ?? String(err) };
}

function log(level, message, fields = {}) {
  const requestId = context.getStore()?.requestId;
  const entry = { level, message: String(message), ...(requestId ? { requestId } : {}), ...fields };
  let line;
  try { line = JSON.stringify(entry); } catch { line = JSON.stringify({ level, message: String(message), requestId }); }
  write(line);
}

// Runs `fn` with `id` as the request id of every line logged inside it, sync or async.
const withRequest = (id, fn) => context.run({ requestId: id }, fn);
const requestId = () => context.getStore()?.requestId || null;

// An uncaught exception or an unhandled rejection is logged with its stack, then the process
// exits 1 as node would (Railway restarts it under restartPolicy ON_FAILURE).
function installCrashHandlers({ exit = (code) => process.exit(code) } = {}) {
  process.on('uncaughtException', (err, origin) => {
    log('error', `uncaught exception: ${err?.message ?? err}`, { event: 'uncaught_exception', origin, ...errorFields(err) });
    exit(1);
  });
  process.on('unhandledRejection', (reason) => {
    log('error', `unhandled rejection: ${reason?.message ?? reason}`, { event: 'unhandled_rejection', ...errorFields(reason) });
    exit(1);
  });
}

// Tests swap the writer.
const setWriter = (fn) => { write = fn; };

module.exports = { log, withRequest, requestId, errorFields, installCrashHandlers, setWriter };
