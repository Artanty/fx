const midi = require('midi');
const fs = require('fs');

const PORT_NAME = 'XC-05987 Bluetooth';
const LOG = process.argv[2] || '/tmp/h90_inbound.txt';

const input = new midi.Input();
input.ignoreTypes(false, false, false);

let found = -1;
for (let i = 0; i < input.getPortCount(); i++) {
  if (input.getPortName(i).includes('XC-05987')) { found = i; break; }
}
if (found < 0) { console.error('H90 BLE input not found'); process.exit(1); }

const out = fs.createWriteStream(LOG, { flags: 'a' });
const ts = () => new Date().toISOString();
out.write(`--- listener started ${ts()} on input ${found} ---\n`);
console.log(`Listening on input ${found}: ${input.getPortName(found)}`);

input.on('message', (delta, bytes) => {
  const hex = Buffer.from(bytes).toString('hex');
  out.write(`RX ${ts()} ${hex}\n`);
  console.log(`RX ${hex}`);
});

input.openPort(found);
process.on('SIGINT', () => { out.write(`--- listener ended ${ts()} ---\n`); out.end(); process.exit(0); });
