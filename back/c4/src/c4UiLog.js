// Persistent UI/operation log for the C4 Synth workbench.
//
// Every user/protocol action is appended to a single file so that "when the
// controls misbehave" we can inspect exactly what the UI and the pedal talked
// about. The file is truncated when the backend boots and again when a fresh
// web session starts (the SPA calls POST /api/log/reset on load), so the file
// always reflects the most recent session.
//
// Log file: <c4>/runtime-actions/c4-ui.log

const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', 'runtime-actions');
const logFile = path.join(logDir, 'c4-ui.log');

function ensureDir() {
  if (!fs.existsSync(logDir)) fs.mkdirSync(logDir, { recursive: true });
}

function reset() {
  ensureDir();
  fs.writeFileSync(logFile, '', 'utf8');
  append('=== log reset (session start) ===');
}

function append(line) {
  ensureDir();
  const ts = new Date().toISOString().slice(0, 23);
  try {
    fs.appendFileSync(logFile, `${ts} ${line}\n`, 'utf8');
  } catch (e) {
    // Never let logging take down the server.
    // eslint-disable-next-line no-console
    console.error('c4UiLog append failed:', e.message);
  }
}

function stamp(kind, msg) {
  append(`[${kind}] ${msg}`);
}

module.exports = { reset, append, stamp, logFile };
