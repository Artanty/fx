// READ-ONLY one-off: dump the C4's 128 preset names to disk in the same
// format the norns bridge produces ("<idx>\t<name>", NULs/trailing whitespace
// trimmed). Reference ground-truth for the M1 on-device acceptance check.
// Run with node from back/c4.
const { findC4 } = require('../../src/c4Hid');
const { C4Protocol } = require('../../src/c4Protocol');
const { C4_PRESET_COUNT } = require('../../src/c4Model');
const fs = require('fs');

const dev = findC4();
if (!dev) { console.error('NO C4 FOUND'); process.exit(1); }
const p = new C4Protocol(dev);
p.open();
const out = [];
for (let i = 0; i < C4_PRESET_COUNT; i++) {
  const raw = p.getPresetName(i).toString('ascii');
  out.push(Math.min(0x7f, i) + '\t' + raw.replace(/\0/g, '').trim());
}
p.close();
fs.writeFileSync(__dirname + '/names.txt', out.join('\n') + '\n', 'ascii');
console.log('wrote ' + out.length + ' rows to names.txt');