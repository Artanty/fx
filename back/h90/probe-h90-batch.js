const midi = require('midi');

const out = new midi.Output();
const inp = new midi.Input();

const outs = [];
for (let i = 0; i < out.getPortCount(); i++) outs.push(out.getPortName(i));
const ins = [];
for (let i = 0; i < inp.getPortCount(); i++) ins.push(inp.getPortName(i));

const H90_RE = /XC-05987|H90|Eventide/;
const outIdx = outs.findIndex((n) => H90_RE.test(n));
const inIdx = ins.findIndex((n) => H90_RE.test(n));
if (outIdx < 0 || inIdx < 0) {
  console.log('H90 not found');
  process.exit(1);
}

out.openPort(outIdx);
inp.openPort(inIdx);
console.log('Opened', JSON.stringify(outs[outIdx]));

inp.on('message', (deltaTime, message) => {
  const hex = message.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  console.log(`RX [+${deltaTime}]`, hex);
});

const messages = [
  ['ID req (ch7F)', [0xf0, 0x7e, 0x7f, 0x06, 0x01, 0xf7]],
  ['0x4E dev1', [0xf0, 0x1c, 0x70, 0x01, 0x4e, 0xf7]],
  ['0x4E dev0', [0xf0, 0x1c, 0x70, 0x00, 0x4e, 0xf7]],
  ['0x48 presets want dev1', [0xf0, 0x1c, 0x70, 0x01, 0x48, 0xf7]],
  ['0x4C sysvars want dev1', [0xf0, 0x1c, 0x70, 0x01, 0x4c, 0xf7]],
  ['0x50 all want dev1', [0xf0, 0x1c, 0x70, 0x01, 0x50, 0xf7]],
  ['0x3B value want key 302 (tempo) dev1', [0xf0, 0x1c, 0x70, 0x01, 0x3b, 0x33, 0x30, 0x32, 0xf7]],
];

let i = 0;
function next() {
  if (i >= messages.length) {
    setTimeout(() => process.exit(0), 3000);
    return;
  }
  const [label, msg] = messages[i++];
  const hex = msg.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  console.log('TX', label, '|', hex);
  out.sendMessage(msg);
  setTimeout(next, 1800);
}
next();
