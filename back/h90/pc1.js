const midi = require("midi");
const fs = require("fs");
const OUT = __dirname + "\\pc.out.json";
const channel = parseInt(process.argv[2] || "11", 10);
const program = parseInt(process.argv[3] || "1", 10);
const out = new midi.Output();
let opened = false, err = null;
try {
  out.openPort(1);
  opened = true;
} catch (e) {
  err = "open: " + e.message;
}
if (opened) {
  try {
    out.sendMessage([0xc0 + (channel - 1), program - 1]);
  } catch (e) {
    err = (err ? err + "; " : "") + "send: " + e.message;
  }
}
fs.writeFileSync(OUT, JSON.stringify({ channel, program, opened, err }));
setTimeout(() => {
  try { out.closePort(); } catch (e) {}
}, 200);