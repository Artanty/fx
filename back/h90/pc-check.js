const midi = require('midi');
const ch = parseInt(process.argv[2] || '1', 10);
const prog = parseInt(process.argv[3] || '0', 10);
const out = new midi.Output();
let ok = false;
try {
  ok = out.openPort(1);
} catch (e) {
  console.log(JSON.stringify({ opened: false, err: String(e) }));
  process.exit(1);
}
try {
  out.sendMessage([0xc0 + (ch - 1), prog & 0x7f]);
} catch (e) {
  console.log(JSON.stringify({ opened: ok, err: String(e) }));
  process.exit(1);
}
out.closePort();
console.log(JSON.stringify({ opened: ok, err: null }));