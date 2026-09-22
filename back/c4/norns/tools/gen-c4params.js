// Generate back/c4/docs/c4-params.txt (human-readable reference sheet) from
// c4Model.js WORKBENCH_CONTROL_SPECS - same source as lib/c4model.lua, so the
// labels, order and row numbers match the norns settings page exactly.
const fs = require('fs');
const path = require('path');
const m = require('../../src/c4Model.js');
const { optsFor, labelFor } = require('./c4-overlay.js');

const specs = m.WORKBENCH_CONTROL_SPECS;

const HEAD = `# C4 Synth - preset parameter controls (norns settings page order)
# Generated from back/c4/src/c4Model.js WORKBENCH_CONTROL_SPECS; do not edit by hand.
# Row numbers 1-173 match the scroll position on the norns settings page.
#   knob   -> [0-255] integer
#   toggle -> off/on
#   select -> [0-max]  option list (wrapped below)`;

const lines = [HEAD, ''];
specs.forEach((s, i) => {
  const num = String(i + 1).padStart(3, ' ');
  const label = labelFor(s.name).replace(/_/g, ' ');
  let col = [num.padEnd(4), label.padEnd(20), s.type.padEnd(7)];
  if (s.type === 'toggle') {
    lines.push(col.join(' ') + ' off/on');
  } else if (s.type === 'select') {
    const opts = optsFor(s.name, (s.options || []).map((o) => o.text));
    const range = `[0-${s.max}]`;
    const optLine = opts.join(' | ');
    lines.push(col.join(' ') + range + '  ' + (opts.length <= 12 ? optLine : ''));
    if (opts.length > 12) {
      lines.push(' '.repeat(4 + 20 + 7) + optLine);
    }
  } else {
    lines.push(col.join(' ') + '[0-255]');
  }
});
lines.push('');

fs.writeFileSync(path.join(__dirname, '../../docs/c4-params.txt'), lines.join('\n'));
console.log('wrote', specs.length, 'rows -> back/c4/docs/c4-params.txt');