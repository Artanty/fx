const fs = require('fs');
const path = require('path');
const { parsePre, buildPre, FIELD_ORDER } = require('../src/prePreset');
const { loadOsbf } = require('../src/osbf');
const { decodeBinary53, encodeBinary53, UNMAPPED } = require('../src/neuroMap');

const INPUT = 'C:/server/fx/input';
const osbf = loadOsbf(path.join(INPUT, '2026-07-31_labackup.osbf'));

const bins = [];
for (const p of osbf.presets) bins.push({ id: 'UP' + p.location, name: p.name.trim(), raw: p.raw.subarray(0, 53) });
for (const s of osbf.selectors) bins.push({ id: 'US' + s.location, name: s.name.trim(), raw: s.raw.subarray(0, 53) });

const pres = fs.readdirSync(INPUT)
  .filter(f => f.endsWith('.pre'))
  .map(f => {
    const pre = parsePre(fs.readFileSync(path.join(INPUT, f), 'utf8'));
    return { file: f, presetName: pre.info.preset_name, params: pre.params };
  });

const MAPPED = FIELD_ORDER.filter(f => !UNMAPPED.includes(f));

let fail = 0;
for (const p of pres) {
  // find best-matching binary by counting matching mapped params
  let best = null, bestScore = -1;
  for (const b of bins) {
    const dec = decodeBinary53(b.raw);
    let score = 0;
    for (const f of MAPPED) if (dec[f] === p.params[f]) score++;
    if (score > bestScore) { bestScore = score; best = b; }
  }
  const dec = decodeBinary53(best.raw);
  const diff = [];
  for (const f of MAPPED) if (dec[f] !== p.params[f]) diff.push(f + ' bin=' + dec[f] + ' pre=' + p.params[f]);
  const status = diff.length === 0 ? 'MATCH' : 'DIFF';
  if (diff.length) fail++;
  console.log(status.padEnd(5), p.file.padEnd(34), '->', best.id, best.name, bestScore + '/' + MAPPED.length);
  for (const d of diff) console.log('        ' + d);
}

console.log('\n=== round-trip encode(decode(binary)) vs binary ===');
const passThrough = [6, 19];
const extra = [26, 39];
for (const b of bins) {
  const dec = decodeBinary53(b.raw);
  const enc = encodeBinary53(dec);
  const bad = [];
  for (let i = 0; i < 53; i++) {
    if (enc[i] !== b.raw[i]) bad.push(i);
  }
  const ignore = [...passThrough, ...extra];
  const real = bad.filter(i => !ignore.includes(i));
  console.log(
    b.id.padEnd(4), b.name.padEnd(32),
    'mismatches:', bad.length ? bad.map(i => i + '(' + b.raw[i].toString(16) + '->' + enc[i].toString(16) + ')').join(' ') : 'none'
  );
  if (real.length) { fail++; console.log('   ^ UNEXPECTED on bytes:', real.join(',')); }
}

// verify our generated .pre re-parses to identical params as official export
console.log('\n=== buildPre re-parse check ===');
for (const p of pres) {
  const xml = buildPre({
    presetName: p.presetName,
    presetOwner: 'hHBrrj1TWS',
    originalCreatorId: 'hHBrrj1TWS',
    productId: '244',
    name: 'L.A. Lady',
    subname: 'Overdrive',
    params: p.params
  });
  const re = parsePre(xml);
  const diff = FIELD_ORDER.filter(f => re.params[f] !== p.params[f]);
  console.log((diff.length ? 'DIFF' : 'OK').padEnd(5), p.file.padEnd(34), diff.length ? diff.join(',') : '');
  if (diff.length) fail++;
}

console.log('\n' + (fail ? fail + ' failures' : 'ALL PASS'));
process.exit(fail ? 1 : 0);
