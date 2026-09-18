const midi = require("midi");
const fs = require("fs");
const OUT = __dirname + "\\pc.out.json";
const results = [];
for (let ch = 1; ch <= 16; ch++) {
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
      out.sendMessage([0xc0 + (ch - 1), 0]);
    } catch (e) {
      err = (err ? err + "; " : "") + "send: " + e.message;
    }
  }
  results.push({ channel: ch, opened, err });
  setTimeout(() => {
    try { out.closePort(); } catch (e) {}
  }, 100);
  // small gap between channel sends so the pedal processes each in order
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0);
  const t0 = Date.now();
  while (Date.now() - t0 < 180) {}
}
fs.writeFileSync(OUT, JSON.stringify(results, null, 1));