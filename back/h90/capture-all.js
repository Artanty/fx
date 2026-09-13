#!/usr/bin/env node
// Capture MIDI from ALL available input ports simultaneously, correlating with
// knob turns (user runs uia_driver --set meanwhile). Logs lines like:
//   RX [1:H90 Pedal] 2026-09-13T18:00:00.000Z F0 7E 00 ...
const midi = require('midi');
const fs = require('fs');
const path = require('path');

const LOG = process.argv[2] || path.join(__dirname, 'midi-all.log');
const out = fs.createWriteStream(LOG, { flags: 'a' });
const ts = () => new Date().toISOString();
out.write(`--- capture-all started ${ts()} ---\n`);
console.log(`Logging to ${LOG}`);

const ports = [];
for (let i = 0; i < new midi.Input().getPortCount(); i++) ports.push(i);

for (const idx of ports) {
  const inp = new midi.Input();
  inp.ignoreTypes(false, false, false);
  const name = inp.getPortName(idx);
  inp.on('message', (delta, bytes) => {
    const hex = Buffer.from(bytes).toString('hex');
    const line = `RX [${idx}:${name}] ${ts()} ${hex}`;
    console.log(line);
    out.write(line + '\n');
  });
  try {
    inp.openPort(idx);
    out.write(`open ${idx}:${name}\n`);
    console.log(`open ${idx}:${name}`);
  } catch (e) {
    out.write(`ERR open ${idx}:${name}: ${e.message}\n`);
  }
}

const dur = parseInt(process.argv[3] || '90', 10);
setTimeout(() => {
  out.write(`--- capture-all ended ${ts()} ---\n`);
  out.end();
  process.exit(0);
}, dur * 1000);
process.on('SIGINT', () => {
  out.write(`--- capture-all ended ${ts()} (SIGINT) ---\n`);
  out.end();
  process.exit(0);
});