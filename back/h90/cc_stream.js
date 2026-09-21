// Stream-driver for MIDI CC sends over the node `midi` package.
// Reads lines "cc value" (0..127) from stdin, sends CC on default ch 11
// to the H90 output port, acknowledges each with "ok".
const midi = require("midi");
const readline = require("readline");

const CHANNEL = 11;
const H90_NAME_RE = /\bH90\b|\bEventide\b/i;

const outputs = new midi.Output();
let index = -1;
for (let i = 0; i < outputs.getPortCount(); i++) {
  const name = outputs.getPortName(i) || "";
  if (H90_NAME_RE.test(name)) { index = i; break; }
}
if (index < 0) {
  console.error("no H90 MIDI output found");
  process.exit(1);
}
outputs.openPort(index);
const status = 0xb0 + (CHANNEL - 1);

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) { console.log("ok"); return; }
  const m = /^(\d+)\s+(\d+)$/.exec(t);
  if (!m) { console.log("err:badline"); return; }
  const cc = parseInt(m[1], 10) & 0x7f;
  const value = parseInt(m[2], 10) & 0x7f;
  outputs.sendMessage([status, cc, value]);
  console.log("ok");
});