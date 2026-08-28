#!/usr/bin/env node
/**
 * Replay a captured H90 import frame via MIDI SysEx.
 * Reads the raw TRPC frame and sends it to the H90.
 *
 * Usage: node h90_replay.js [--file path] [--dry-run]
 */
const midi = require("midi");
const fs = require("fs");
const path = require("path");

const H90_NAME = "XC-05987 Bluetooth";
const DEFAULT_FILE = path.join(__dirname, "h90-captures", "h90_import_req.bin");

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
  return {
    file: get("--file") || DEFAULT_FILE,
    dryRun: args.includes("--dry-run"),
    list: args.includes("--list"),
    channel: parseInt(get("--channel") || "11", 10),
  };
}

function main() {
  const opts = parseArgs();

  if (opts.list) {
    console.log("MIDI outputs:");
    const probe = new midi.Output();
    for (let i = 0; i < probe.getPortCount(); i++) {
      const name = probe.getPortName(i);
      console.log("  [" + i + "] " + name + (name.includes(H90_NAME) ? "   <-- H90" : ""));
    }
    return;
  }

  // Read the capture file
  let frame = fs.readFileSync(opts.file);
  console.log("File: " + opts.file);
  console.log("Size: " + frame.length + " bytes");

  // Validate
  if (frame[0] !== 0xf0) {
    console.error("ERROR: File does not start with 0xF0 (SysEx start)");
    process.exit(1);
  }

  // Ensure it ends with F7 (SysEx end)
  if (frame[frame.length - 1] !== 0xf7) {
    console.log("Appending missing 0xF7 (SysEx end) trailer");
    frame = Buffer.concat([frame, Buffer.from([0xf7])]);
  }

  // Parse header
  const header = frame.slice(0, 8);
  const msgid = (header[4] << 7) | header[5];
  const mtype = (header[6] << 7) | header[7];
  console.log("SysEx header: " + header.toString("hex"));
  console.log("  msgid: 0x" + msgid.toString(16));
  console.log("  type:  0x" + mtype.toString(16) + " (0x004f = import/export)");

  // Show payload info
  const payload = frame.slice(8, -1); // strip header and F7
  console.log("Payload: " + payload.length + " bytes");
  console.log("  First 8: " + payload.slice(0, 8).toString("hex"));
  console.log("  Last 8:  " + payload.slice(-8).toString("hex"));

  // Check for zlib header
  if (payload[0] === 0x78 && payload[1] === 0x9c) {
    console.log("  Zlib header detected (78 9c)");
  } else {
    console.log("  WARNING: No zlib header at payload start (got " +
      payload[0].toString(16) + " " + payload[1].toString(16) + ")");
  }

  if (opts.dryRun) {
    console.log("\nDRY RUN - not sending");
    return;
  }

  // Find H90
  const target = findH90Output();
  if (!target) {
    console.error("\nABORT: no Eventide H90 output found. Connected?");
    const probe = new midi.Output();
    for (let i = 0; i < probe.getPortCount(); i++) {
      console.error("  port[" + i + "] " + probe.getPortName(i));
    }
    process.exit(1);
  }

  console.log("\nH90 output: " + target.name + " (port " + target.index + ")");
  console.log("Sending " + frame.length + " bytes...");

  const { out } = target;
  out.openPort(target.index);

  // Send the full SysEx frame
  // Node.js midi package expects the full message including F0 and F7
  out.sendMessage(Array.from(frame));

  console.log("Sent! Waiting 2s for response...");

  setTimeout(() => {
    out.closePort();
    console.log("Port closed.");
  }, 2000);
}

main();
