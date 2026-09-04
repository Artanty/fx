const fs = require('fs');
const midi = require('midi');

const outLog = '/tmp/h90_capture.txt';
const inp = new midi.Input();
const out = new midi.Output();

const ins = [];
for (let i = 0; i < inp.getPortCount(); i++) ins.push(inp.getPortName(i));
const outs = [];
for (let i = 0; i < out.getPortCount(); i++) outs.push(out.getPortName(i));

const H90_RE = /XC-05987|H90|Eventide/;
const inIdx = ins.findIndex((n) => H90_RE.test(n));
const outIdx = outs.findIndex((n) => H90_RE.test(n));
if (inIdx < 0) {
  console.log('H90 input not found:', ins);
  process.exit(1);
}

inp.openPort(inIdx);
console.log('Listening on', JSON.stringify(ins[inIdx]));

let start = Date.now();
fs.appendFileSync(outLog, `--- listener started ${new Date().toISOString()} ---\n`);

inp.on('message', (deltaTime, message) => {
  const hex = message.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
  const line = `${(Date.now() - start)}ms RX ${hex}`;
  console.log(line);
  fs.appendFileSync(outLog, line + '\n');
});

const dur = parseInt(process.argv[2] || '180000', 10);
console.log(`Capturing for ${dur / 1000}s... Ctrl-C to stop early`);
setTimeout(() => {
  fs.appendFileSync(outLog, `--- listener ended ---\n`);
  process.exit(0);
}, dur);
