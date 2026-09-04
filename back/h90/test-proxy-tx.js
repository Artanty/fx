const midi = require('midi');
const out = new midi.Output();
let idx = -1;
for (let i = 0; i < out.getPortCount(); i++) {
  if (out.getPortName(i).includes('Proxy')) idx = i;
}
console.log('output port:', idx, out.getPortName(idx));
out.openPort(idx);
const msg = [0xF0, 0x1C, 0x70, 0x00, 0x01, 0xF7];
out.sendMessage(msg);
console.log('sent test sysex', Buffer.from(msg).toString('hex'));
setTimeout(() => process.exit(0), 500);
