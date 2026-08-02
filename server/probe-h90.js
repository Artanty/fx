const midi = require('midi');

const out = new midi.Output();
const inp = new midi.Input();

const outs = [];
for (let i = 0; i < out.getPortCount(); i++) outs.push(out.getPortName(i));
const ins = [];
for (let i = 0; i < inp.getPortCount(); i++) ins.push(inp.getPortName(i));

console.log('OUTPUTS:');
outs.forEach((n, i) => console.log(' ', i, JSON.stringify(n)));
console.log('INPUTS:');
ins.forEach((n, i) => console.log(' ', i, JSON.stringify(n)));

const H90_RE = /XC-05987|H90|Eventide/;
const outIdx = outs.findIndex((n) => H90_RE.test(n));
const inIdx = ins.findIndex((n) => H90_RE.test(n));
if (outIdx < 0 || inIdx < 0) {
  console.log('H90 not found (out=%d in=%d)', outIdx, inIdx);
  process.exit(1);
}

out.openPort(outIdx);
inp.openPort(inIdx);
console.log('Opened OUT', JSON.stringify(outs[outIdx]), 'and IN', JSON.stringify(ins[inIdx]));

inp.on('message', (deltaTime, message) => {
  const hex = message.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  console.log(`RX [+${deltaTime}]`, hex);
});

const cmd = process.argv[2] || '4E';
const payloadHex = process.argv[3] || '';

const sysex =
  cmd === 'RAW'
    ? payloadHex.split(/[\s,]+/).filter(Boolean).map((h) => parseInt(h, 16))
    : (() => {
        const bytes = payloadHex
          ? payloadHex.split(/[\s,]+/).map((h) => parseInt(h, 16))
          : [];
        return [0xf0, 0x1c, 0x70, 0x00, parseInt(cmd, 16), ...bytes, 0xf7];
      })();
console.log('TX', sysex.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '));
out.sendMessage(sysex);

const waitMs = parseInt(process.argv[4] || '3500', 10);
setTimeout(() => process.exit(0), waitMs);
