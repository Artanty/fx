#!/usr/bin/env node
// Recall an H90 program slot via MIDI Program Change.
// Requires the Eventide Control app to be CLOSED (it holds the 'H90 Pedal' port).
//
// Usage:
//   node recall.js --program N [--channel C] [--brute] [--offset]
//     --program  N  H90 program slot 1-100 (PC byte = N with PC Offset=0)
//     --channel  C  MIDI channel to try (default 11)
//     --brute       send PC on all 16 channels (pedal channel unknown)
//     --offset      subtract 1 (PC byte = N-1) for devices using that convention
//   node recall.js --list
const midi = require('midi');
const fs = require('fs');

function listPorts() {
  const out = new midi.Output();
  const names = [];
  for (let i = 0; i < out.getPortCount(); i++) names.push(out.getPortName(i));
  return names;
}

function findH90Index() {
  const names = listPorts();
  for (let i = 0; i < names.length; i++) {
    const n = names[i].toLowerCase();
    if (n.includes('h90 pedal')) return i;
  }
  for (let i = 0; i < names.length; i++) {
    const n = names[i].toLowerCase();
    if (n.includes('h90') || n.includes('xc-05987') || n.includes('eventide')) return i;
  }
  return -1;
}

function send(out, channel, pcin, offset) {
  out.sendMessage([0xc0 + (channel - 1), offset ? pcin - 1 : pcin]);
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    listPorts().forEach((n, i) => console.log(`[${i}] ${n}`));
    return;
  }
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const program = parseInt(get('--program'), 10);
  const channel = parseInt(get('--channel') || '11', 10);
  const brute = args.includes('--brute');
  const offset = args.includes('--offset');
  if (!Number.isInteger(program) || program < 1 || program > 100) {
    console.error('usage: node recall.js --program N [--channel C] [--brute]');
    process.exit(1);
  }

  const idx = findH90Index();
  if (idx < 0) {
    console.error(`RECALL FAIL: no H90 MIDI output found (ports: ${JSON.stringify(listPorts())})`);
    process.exit(1);
  }

  const out = new midi.Output();
  let opened = false;
  try {
    out.openPort(idx);
    opened = true;
  } catch (e) {
    console.error('openPort failed:', e.message);
  }
  if (!opened) {
    console.error('RECALL FAIL: cannot open port (app still running?)');
    process.exit(1);
  }

  let sent = 0;
  if (brute) {
    for (let c = 1; c <= 16; c++) {
      try {
        send(out, c, program, offset);
        sent++;
      } catch (e) { /* skip */ }
    }
    console.log(`pc all channels -> program ${program} (${sent} sends)`);
  } else {
    try {
      send(out, channel, program, offset);
      sent++;
    } catch (e) {
      console.error('sendMessage failed:', e.message);
      out.closePort();
      process.exit(1);
    }
    console.log(`pc ch${channel} -> program ${program}`);
  }

  fs.writeFileSync(
    __dirname + '\\recall.out.json',
    JSON.stringify({ program, channel: brute ? null : channel, offset, port: idx, ok: sent > 0 })
  );
  setTimeout(() => {
    try { out.closePort(); } catch (e) {}
  }, 250);
}

main();