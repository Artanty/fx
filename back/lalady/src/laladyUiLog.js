// Persistent UI/operation log for the L.A. Lady workbench.
//
// Every user/protocol action is appended to a single file so that "when the
// controls misbehave" we can inspect exactly what the UI and the pedal talked
// about. The file is truncated when the backend boots and again when a fresh
// web session starts (the SPA calls POST /api/log/reset on load), so the file
// always reflects the most recent session. SAVE stamps include the slot body
// and live control block BEFORE the write and the readback AFTER, so a save
// that changes the sound can be diffed byte-by-byte.
//
// Log file: <lalady>/runtime-actions/lalady-ui.log

const path = require('path');
const fs = require('fs');

const logDir = path.join(__dirname, '..', 'runtime-actions');
const logFile = path.join(logDir, 'lalady-ui.log');

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
    console.error('laladyUiLog append failed:', e.message);
  }
}

function stamp(kind, msg) {
  append(`[${kind}] ${msg}`);
}

module.exports = { reset, append, stamp, logFile };