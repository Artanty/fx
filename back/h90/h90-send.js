#!/usr/bin/env node
const midi = require("midi");

const H90_NAME = "XC-05987 Bluetooth";

function findH90Output() {
  const out = new midi.Output();
  const n = out.getPortCount();
  for (let i = 0; i < n; i++) {
    if (out.getPortName(i).includes(H90_NAME)) return { out, index: i, name: out.getPortName(i) };
  }
  return null;
}

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (k) => {
    const i = args.indexOf(k);
    return i >= 0 && i + 1 < args.length ? args[i + 1] : undefined;
  };
  const program = parseInt(get("--program"), 10);
  const channel = parseInt(get("--channel") || "11", 10);
  const pcOffset = args.includes("--pc-offset");
  if (args.includes("--list")) return { list: true };
  if (!Number.isInteger(program) || program < 1 || program > 100) {
    console.error("Usage: node h90-send.js --program N [--channel C] [--pc-offset]");
    console.error("       node h90-send.js --list   # list outputs, send nothing");
    console.error("  N = H90 program slot 1-100. Default MIDI channel 11.");
    console.error("  --pc-offset  sends raw PC byte N (H90 'PC Offset' ON) instead of N-1.");
    process.exit(1);
  }
  return { program, channel, pcOffset };
}

function main() {
  const parsed = parseArgs();
  if (parsed.list) {
    console.log("MIDI outputs:");
    const probe = new midi.Output();
    for (let i = 0; i < probe.getPortCount(); i++) {
      const name = probe.getPortName(i);
      console.log("  [" + i + "] " + name + (name.includes(H90_NAME) ? "   <-- H90" : ""));
    }
    return;
  }
  const { program, channel, pcOffset } = parsed;
  const target = findH90Output();
  if (!target) {
    console.error("ABORT: no Eventide H90 output found. Connected?");
    const probe = new midi.Output();
    for (let i = 0; i < probe.getPortCount(); i++) console.error("  port[" + i + "] " + probe.getPortName(i));
    process.exit(1);
  }

  const pcByte = pcOffset ? program : program - 1;
  const status = 0xC0 + (channel - 1);
  const msg = [status, pcByte];

  console.log("H90 output  : " + target.name + "  (port " + target.index + ")");
  console.log("MIDI channel: " + channel);
  console.log("Program slot: " + program + (pcOffset ? "  (PC Offset ON)" : "  (PC Offset OFF)"));
  console.log("Sending bytes: " + msg.map((b) => "0x" + b.toString(16).padStart(2, "0")).join(" ") +
              "  [" + msg.join(", ") + "]");

  const { out } = target;
  out.openPort(target.index);
  out.sendMessage(msg);
  setTimeout(() => {
    out.closePort();
    console.log("Sent. Closed port.");
  }, 200);
}

main();
