const midi = require('midi');

const inputs = new midi.Input();
const outputs = new midi.Output();
console.log('=== INPUTS (sources) ===');
for (let i = 0; i < inputs.getPortCount(); i++) {
  console.log(`${i}: ${inputs.getPortName(i)}`);
}
console.log('=== OUTPUTS (destinations) ===');
for (let i = 0; i < outputs.getPortCount(); i++) {
  console.log(`${i}: ${outputs.getPortName(i)}`);
}
