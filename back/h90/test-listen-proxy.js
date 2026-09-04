const midi = require('midi');
const input = new midi.Input();
input.ignoreTypes(false, false, false);
let idx = -1;
for (let i = 0; i < input.getPortCount(); i++) {
  if (input.getPortName(i).includes('Proxy')) idx = i;
}
console.log('listening on input', idx, input.getPortName(idx));
input.on('message', (delta, bytes) => console.log('GOT', Buffer.from(bytes).toString('hex')));
input.openPort(idx);
setTimeout(() => { console.log('done'); process.exit(0); }, 6000);
