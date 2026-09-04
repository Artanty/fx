// Safe validation of the ACTIVE_STORE + ACTIVE_WRITE preset write path.
// Targets the disposable test slot 0x3f000 (previously "effect1"/"esfsef").
//
// Strategy: snapshot the slot's current 53-byte body + name, then re-write it
// (data unchanged, new name "zval<ts>") through writePreset, then verify the
// read-back matches exactly what ACTIVE_WRITE committed. Also snapshots every
// other slot before/after to confirm no collateral corruption.
//
// Run: node scripts/validateActiveWrite.js
// Safe: only writes to slot 0x3f000 (already a scratch slot); full backup of all
// 6 slots + EEPROM was taken before any experiments (see DECISIONS.md).

const fs = require('fs');
const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE, LALADY_PRESET_BASE, LALADY_PRESET_PITCH } = require('../src/laLadyModel');

const PAGE = 0x03f000;
const IDX = (PAGE - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH;

function nameOf(slotHex) {
  const bytes = Buffer.from(slotHex, 'hex');
  const n = bytes.indexOf(0);
  const slice = bytes.slice(0, n < 0 ? bytes.length : n);
  return slice.toString('ascii');
}

function snapshotAll(p) {
  const out = {};
  for (const pg of SLOT_PAGES) out[pg.toString(16)] = p.readSlotRaw(pg).toString('hex');
  return out;
}

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const before = snapshotAll(p);
  const cur = before[PAGE.toString(16)]; // data + name

  const body = Buffer.from(cur, 'hex');
  const data = body.slice(0, LALADY_DATA_SIZE);
  const oldName = nameOf(body.slice(LALADY_DATA_SIZE));

  const newName = 'zval' + Date.now().toString().slice(-6);
  console.log('slot 0x3f000 before: name="' + oldName + '" data=' + data.toString('hex'));

  const beforeOther = {};
  for (const pg of SLOT_PAGES) if (pg !== PAGE) beforeOther[pg.toString(16)] = before[pg.toString(16)];

  const want = p.writePreset(PAGE, { name: newName, params: require('../src/neuroMap').decodeBinary53(data), idx: IDX });
  const back = p.readSlotRaw(PAGE);
  const ok = want.equals(back);

  console.log('writePreset returned ' + want.length + 'B; name="' + nameOf(want.slice(LALADY_DATA_SIZE)) + '"');
  console.log('read-back matches:', ok);
  if (!ok) {
    const diff = [];
    for (let i = 0; i < want.length; i++) if (want[i] !== back[i]) diff.push(i);
    console.log('diff bytes:', diff.join(','));
  }

  const after = snapshotAll(p);
  let collateral = false;
  for (const pg of SLOT_PAGES) {
    const k = pg.toString(16);
    if (pg === PAGE) continue;
    if (after[k] !== beforeOther[k]) {
      collateral = true;
      console.log('COLLATERAL CHANGE on 0x' + k + ': ' + beforeOther[k].slice(0, 32) + ' -> ' + after[k].slice(0, 32));
    }
  }
  console.log('collateral corruption on other slots:', collateral);

  console.log(ok && !collateral ? '\nRESULT: PASS — ACTIVE_WRITE commit verified' : '\nRESULT: FAIL');
} finally {
  p.close();
}