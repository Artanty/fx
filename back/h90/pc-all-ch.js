const midi = require('midi');
const out = new midi.Output();
let ok = false;
try {
  ok = out.openPort(1);
} catch (e) {
  console.log(JSON.stringify({ opened: false, err: String(e) }));
  process.exit(1);
}
const st = Date.now();
try {
  for (let ch = 1; ch <= 16; ch++) {
    out.sendMessage([0xc0 + (ch - 1), 0]);
  }
} catch (e) {
  console.log(JSON.stringify({ opened: ok, err: String(e) }));
  process.exit(1);
}
out.closePort();
console.log(JSON.stringify({ opened: ok, err: null, ms: Date.now() - st }));