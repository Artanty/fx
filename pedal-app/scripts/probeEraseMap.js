// Diagnostic: determine how PRESET_ERASE (0x38) actually clears a slot.
// Tests three hypotheses in one run:
//   - erase by index (0..5)
//   - erase by 3-byte address at each slot page
//   - ACTIVE_SET(idx) then erase (no arg)  -> "erase the active preset"
// Each variant uses a short settle and treats 0xFF or 0x00 as erased.
// The 6 known slot pages are snapshotted up front and restored ONCE at the end,
// so a run that erases something is reverted (re-upload from .osbf afterward anyway).
//
// Usage: node scripts/probeEraseMap.js

const { findLalady, buildReport, CMD } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const REGION_LEN = LALADY_DATA_SIZE + LALADY_NAME_SIZE;
const wait = ms => { const e = Date.now() + ms; while (Date.now() < e) {} };

const p = new SourceAudioProtocol(findLalady());
p.open();
const pages = SLOT_PAGES;
const snap = {};
for (const pg of pages) {
  snap[pg] = { hdr: p.readRegion(pg, 0, LALADY_DATA_OFF), body: p.readRegion(pg, LALADY_DATA_OFF, REGION_LEN) };
}
console.log('snapshotted ' + pages.length + ' slot pages');

const clearedSet = () => {
  const s = new Set();
  for (const pg of pages) {
    const b = p.readRegion(pg, LALADY_DATA_OFF, REGION_LEN);
    if (b.every(x => x === 0xff) || b.every(x => x === 0x00)) s.add(pg);
  }
  return s;
};

const tryErase = (label, sends) => {
  const before = clearedSet();
  for (const s of sends) {
    p.dev.send(buildReport(s[0], ...s.slice(1)));
    const dl = Date.now() + 400;
    while (Date.now() < dl) { try { p.dev.receive(120); } catch (e) { break; } }
  }
  wait(700);
  const after = clearedSet();
  const newly = [...after].filter(pg => !before.has(pg)).map(pg => '0x' + pg.toString(16));
  console.log(label.padEnd(22) + '-> cleared: ' + (newly.join(', ') || '(none)'));
};

try {
  for (let idx = 0; idx < 6; idx++) tryErase('idx ' + idx, [[CMD.PRESET_ERASE, idx & 0xff]]);
  for (const pg of SLOT_PAGES) tryErase('addr 0x' + pg.toString(16), [[CMD.PRESET_ERASE, (pg >> 16) & 0xff, (pg >> 8) & 0xff, pg & 0xff]]);
  for (let idx = 0; idx < 6; idx++) tryErase('sel' + idx + '+erase', [[CMD.ACTIVE_SET, idx & 0xff], [CMD.PRESET_ERASE]]);
} finally {
  console.log('--- restoring snapshot (single pass) ---');
  for (const pg of pages) {
    p.writeRegion(pg, 0, snap[pg].hdr);
    p.writeRegion(pg, LALADY_DATA_OFF, snap[pg].body);
  }
  p.close();
  console.log('--- done; re-upload from .osbf if you want a clean slate ---');
}
