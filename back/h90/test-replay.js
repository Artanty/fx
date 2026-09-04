const midi = require("midi");
const fs = require("fs");

const H90_NAME = "XC-05987";
const REQ_FILE = process.argv[2] || "h90-captures/h90_import_req.bin";
const LISTEN_MS = parseInt(process.argv[3] || "15000", 10);

function findH90() {
  const names = [];
  const input = new midi.Input();
  const output = new midi.Output();
  let src = -1;
  let dst = -1;
  for (let i = 0; i < input.getPortCount(); i++) {
    const n = input.getPortName(i);
    names.push(`in[${i}]=${n}`);
    if (n.includes(H90_NAME) && src < 0) src = i;
  }
  for (let i = 0; i < output.getPortCount(); i++) {
    const n = output.getPortName(i);
    names.push(`out[${i}]=${n}`);
    if (n.includes(H90_NAME) && dst < 0) dst = i;
  }
  return { src, dst, names };
}

const req = fs.readFileSync(REQ_FILE);
if (req[0] !== 0xf0) {
  console.error("ABORT: file does not look like a SysEx message (no leading F0)");
  process.exit(1);
}

const { src, dst, names } = findH90();
console.log("ports:", names.join("  "));
if (src < 0 || dst < 0) {
  console.error("ABORT: H90 not found as both source and destination");
  process.exit(1);
}

const inPorts = [];
const srcIdx = [];
for (let i = 0; i < new midi.Input().getPortCount(); i++) {
  const n = new midi.Input().getPortName(i);
  if (n.includes(H90_NAME) || /WIDI|Eventide/i.test(n)) srcIdx.push(i);
}
if (!srcIdx.length) srcIdx.push(0);
let sawResponse = false;
srcIdx.forEach((i) => {
  const p = new midi.Input();
  p.ignoreTypes(false, false, false);
  p.on("message", (_delta, msg) => {
    sawResponse = true;
    const hex = Buffer.from(msg).toString("hex").toUpperCase();
    console.log(`RX[${i}] (${msg.length} bytes): ${hex}`);
  });
  p.openPort(i);
  inPorts.push(p);
});
console.log(`listening on inputs ${srcIdx.join(",")}`);

const out = new midi.Output();
out.openPort(dst);
const bytes = Array.from(req);
out.sendMessage(bytes);
console.log(`sent ${req.length} bytes (${req.slice(0, 16).toString("hex")}…) to output ${dst}`);

setTimeout(() => {
  out.closePort();
  inPorts.forEach((p) => p.closePort());
  if (!sawResponse) console.log("NO RESPONSE in " + LISTEN_MS + "ms");
  else console.log("done");
  process.exit(0);
}, LISTEN_MS);
