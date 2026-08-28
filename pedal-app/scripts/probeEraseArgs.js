// Safe, decisive probe of the PRESET_ERASE (0x38) ARGUMENT space only.
// Rationale: FLASH_WRITE can only clear bits, so we have no working erase yet.
// But if 0x38 with the right args DOES erase a slot, that very fact gives us
// the erase command -- and an erased cell (0xFF) can be reprogrammed by
// FLASH_WRITE, so we can restore the slot afterward. Wrong args are no-ops.
//
// We snapshot all 6 slot regions up front (for change detection); after each
// arg variant we check all 6; the FIRST variant that erases anything is
// reported. The restore source is the FULL-BACKUP original (so if a slot was
// already corrupted, this also heals it), written after the erase.
//
// Usage: node scripts/probeEraseArgs.js

const fs = require('fs');
const { requireLalady, buildReport, CMD } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const REGION_LEN = LALADY_DATA_SIZE + LALADY_NAME_SIZE;
const REGION_FULL = LALADY_DATA_OFF + REGION_LEN; // header + data + name
const wait = ms => { const e = Date.now() + ms; while (Date.now() < e) {} };

// Most recent full backup = the authoritative original to restore into.
const backupPath = require('child_process').execSync('ls -t runtime-actions/lalady-backup-*.json | head -1').toString().trim();
const bak = JSON.parse(fs.readFileSync(backupPath, 'latin1'));
const backupRegion = {};
for (const s of bak.slots) backupRegion[s.page] = Buffer.from(s.hex, 'hex').slice(0, REGION_FULL);

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const pages = SLOT_PAGES;
  const snap = {};
  for (const pg of pages) snap[pg] = p.readRegion(pg, LALADY_DATA_OFF, REGION_LEN);
  console.log('snapshotted ' + pages.length + ' slot pages; restore source: ' + backupPath);

  const erasedSet = () => {
    const s = new Set();
    for (const pg of pages) {
      const b = p.readRegion(pg, LALADY_DATA_OFF, REGION_LEN);
      if (b.every(x => x === 0xff) || b.every(x => x === 0x00)) s.add(pg);
    }
    return s;
  };

  const restore = (pgs) => {
    for (const pg of pgs) {
      p.writeRegion(pg, 0, backupRegion[pg]);
      const back = p.readRegion(pg, 0, REGION_FULL);
      if (!back.equals(backupRegion[pg])) console.log('  !! restore mismatch at 0x' + pg.toString(16));
      else console.log('  restored 0x' + pg.toString(16) + ' from backup');
    }
  };

  const variants = [];
  for (let i = 0; i < 8; i++) {
    variants.push(['idx ' + i, [i & 0xff]]);
    variants.push(['idx+1 ' + i, [(i + 1) & 0xff]]);
    variants.push(['0,idx ' + i, [0x00, i & 0xff]]);
    variants.push(['idx,0 ' + i, [i & 0xff, 0x00]]);
    variants.push(['AA,idx ' + i, [0xaa, i & 0xff]]);
    variants.push(['idx,AA ' + i, [i & 0xff, 0xaa]]);
    variants.push(['01,idx ' + i, [0x01, i & 0xff]]);
  }
  for (const pg of SLOT_PAGES) {
    const hi = (pg >> 16) & 0xff, mid = (pg >> 8) & 0xff, lo = pg & 0xff;
    variants.push(['addr ' + pg.toString(16), [hi, mid, lo]]);
    variants.push(['0,addr ' + pg.toString(16), [0x00, hi, mid, lo]]);
    variants.push(['addr,AA ' + pg.toString(16), [hi, mid, lo, 0xaa]]);
    variants.push(['sect ' + pg.toString(16), [hi, mid]]);
  }
  variants.push(['no-arg', []]);
  variants.push(['0xff', [0xff]]);
  variants.push(['0x00', [0x00]]);

  let found = false;
  let n = 0;
  for (const [label, args] of variants) {
    n++;
    const before = erasedSet();
    p.dev.send(buildReport(CMD.PRESET_ERASE, ...args));
    const dl = Date.now() + 300;
    while (Date.now() < dl) { try { p.dev.receive(120); } catch (e) { break; } }
    wait(500);
    const after = erasedSet();
    const newly = [...after].filter(pg => !before.has(pg));
    if (newly.length) {
      console.log(label.padEnd(28) + '-> ERASED: ' + newly.map(pg => '0x' + pg.toString(16)).join(', '));
      restore(newly);
      console.log('  restored; stopping (found working erase arg form)');
      found = true;
      break;
    }
    if (n % 10 === 0) console.log('  ...tried ' + n + '/' + variants.length);
  }
  if (!found) console.log('--- no 0x38 arg form erased any slot ---');
} finally {
  p.close();
}
