const fs = require('fs');
const path = require('path');
const { parsePre, FIELD_ORDER } = require('./prePreset');
const { loadOsbf } = require('./osbf');

const INPUT = 'C:/server/fx/input';
const PRE_FILES = fs.readdirSync(INPUT).filter(f => f.endsWith('.pre'));
const osbf = loadOsbf(path.join(INPUT, '2026-07-31_labackup.osbf'));

const bins = {};
for (const p of osbf.presets) bins['UP' + p.location] = { name: p.name.trim(), raw: p.raw.subarray(0, 53) };
for (const s of osbf.selectors) bins['US' + s.location] = { name: s.name.trim(), raw: s.raw.subarray(0, 53) };

const pres = PRE_FILES.map(f => {
  const pre = parsePre(fs.readFileSync(path.join(INPUT, f), 'utf8'));
  return { file: f, presetName: pre.info.preset_name, params: pre.params };
});

console.log('=== .pre files ===');
for (const p of pres) {
  const vals = Object.entries(p.params).filter(([k, v]) => v !== 0 && k !== 'control_range' && k !== 'control_min');
  console.log(p.file, '|', p.presetName, '| non-zero:', vals.map(([k, v]) => k + '=' + v).join(', '));
}

console.log('\n=== binary blobs (osbf) ===');
for (const [k, b] of Object.entries(bins)) {
  console.log(k, JSON.stringify(b.name), b.raw.toString('hex'));
}

console.log('\n=== byte-position table (cols = presets in FIELD_ORDER of .pre) ===');
const all = pres.map(p => p.params);
for (let i = 0; i < 53; i++) {
  const row = Object.entries(bins).map(([k, b]) => b.raw[i].toString(16).padStart(2, '0'));
  console.log('byte ' + String(i).padStart(2), '[' + row.join('  ') + ']');
}

console.log('\n=== field table ===');
for (const f of FIELD_ORDER) {
  const row = all.map(p => String(p[f]).padStart(4));
  console.log(f.padEnd(28), row.join(' | '));
}
