// Heal the corrupted slot 0x3c000 by erasing it and re-writing the original
// body+name captured in the first full backup (lalady-backup-1787936146287.json,
// name "goodtone fixed mids").
//
// Exercises BOTH new paths: erasePreset(0) (ACTIVE_SET + PRESET_ERASE 0x38) and
// writePreset (ACTIVE_STORE + ACTIVE_WRITE). Verifies read-back matches exactly
// and that the other 5 slots are untouched.
//
// Run: node scripts/healSlot3c000.js

const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');
const { decodeBinary53 } = require('../src/neuroMap');

const PAGE = 0x03c000;
const IDX = 0;
const BACKUP = 'runtime-actions/lalady-backup-1787936146287.json';

function nameOf(buf) {
  const n = buf.indexOf(0);
  const slice = buf.slice(0, n < 0 ? buf.length : n);
  return slice.toString('ascii');
}

function readFullSlot(p, pg) {
  return p.readRegion(pg, 0, LALADY_DATA_OFF + LALADY_DATA_SIZE + LALADY_NAME_SIZE);
}

function snapshotAll(p) {
  const out = {};
  for (const pg of SLOT_PAGES) out[pg.toString(16)] = readFullSlot(p, pg).toString('hex');
  return out;
}

function wipeAll(p) {
}

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const backup = JSON.parse(require('fs').readFileSync(BACKUP, 'utf8'));
  const slot = backup.slots.find(s => s.page === PAGE);
  if (!slot) throw new Error('page 0x3c000 not in backup');
  const orig = Buffer.from(slot.hex, 'hex');
  const data = orig.slice(LALADY_DATA_OFF, LALADY_DATA_OFF + LALADY_DATA_SIZE);
  const name = orig.slice(LALADY_DATA_OFF + LALADY_DATA_SIZE, LALADY_DATA_OFF + LALADY_DATA_SIZE + LALADY_NAME_SIZE);
  console.log('target ' + PAGE.toString(16) + ' backup name="' + nameOf(name) + '"');

  const before = snapshotAll(p);
  const pre = before[PAGE.toString(16)];
  console.log('  before: data=' + Buffer.from(pre, 'hex').slice(0, LALADY_DATA_SIZE).toString('hex').slice(0, 40) + ' name="' + nameOf(Buffer.from(pre, 'hex').slice(LALADY_DATA_SIZE)) + '"');

  // 1. Erase the corrupt slot (proves the 0x38|0x80 + ACTIVE_SET path).
  const ack = p.erasePreset(IDX);
  console.log('  erasePreset(0) ack:', ack ? ack.join(',') : '(none)');
  const erased = p.readSlotRaw(PAGE);
  console.log('  post-erase all bytes 0xff:', erased.every(b => b === 0xff));

  // 2. Write the original body+name back (proves the ACTIVE_STORE/WRITE path).
  p.writePreset(PAGE, { name: nameOf(name) || undefined, params: decodeBinary53(data), idx: IDX });

  // 3. Verify read-back matches the backup body+name exactly.
  const back = p.readSlotRaw(PAGE);
  const want = Buffer.concat([data, name]);
  const ok = back.equals(want);
  console.log('  read-back matches backup:', ok);
  if (!ok) {
    const diff = [];
    for (let i = 0; i < want.length; i++) if (back[i] !== want[i]) diff.push(i);
    console.log('  diff bytes:', diff.join(','));
  }

  // 4. Collateral check on the other 5 slots (full region incl. header).
  const after = snapshotAll(p);
  let collateral = false;
  for (const pg of SLOT_PAGES) {
    const k = pg.toString(16);
    if (pg === PAGE) continue;
    if (after[k] !== before[k]) {
      collateral = true;
      console.log('  COLLATERAL on 0x' + k + ': ' + before[k].slice(0, 32) + ' -> ' + after[k].slice(0, 32));
    }
  }
  console.log('  collateral on other slots:', collateral);

  const b4 = Buffer.from(before[PAGE.toString(16)], 'hex').slice(0, LALADY_DATA_OFF);
  const af = readFullSlot(p, PAGE).slice(0, LALADY_DATA_OFF);
  console.log('  header before heal: ' + (b4.every(x => x === 0xff) ? '(erased)' : b4.toString('hex').slice(0, 32)));
  console.log('  header after heal:  ' + (af.every(x => x === 0xff) ? '(all 0xff!)' : af.toString('hex').slice(0, 32)));

  console.log(ok && !collateral && erased.every(b => b === 0xff) ? '\nRESULT: PASS — slot 0x3c000 erased and healed' : '\nRESULT: FAIL');
} finally {
  p.close();
}