// READ-ONLY backup of all 128 C4 presets (names + 128-byte bodies) to a JSON
// file under backups/. Run before the first flash write so the user can restore
// if a commit misbehaves. Restore = feed each {idx, bodyHex} back via
// /api/presets/save (or a future restore endpoint). Writes no pedal data.
const fs = require('fs');
const path = require('path');
const { findC4 } = require('./c4Hid');
const { C4Protocol } = require('./c4Protocol');
const { C4_PRESET_COUNT, C4_DATA_SIZE } = require('./c4Model');

const BACKUP_DIR = path.resolve(__dirname, '..', 'backups');

function main() {
  const dev = findC4();
  if (!dev) throw new Error('C4 not found');
  const p = new C4Protocol(dev);
  p.open();
  const active = p.getHardwareConfig().activePreset;
  const presets = [];
  for (let idx = 0; idx < C4_PRESET_COUNT; idx++) {
    const name = p.getPresetName(idx).toString('ascii').replace(/\0/g, '').trim();
    const body = Array.from(p.readSlotBody(idx));
    presets.push({ idx, name, bodyHex: body.map((b) => b.toString(16).padStart(2, '0')).join('') });
  }
  p.close();

  fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, 'c4-backup-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  fs.writeFileSync(file, JSON.stringify({ productId: 249, activeIndex: active, dataSize: C4_DATA_SIZE, presets }, null, 2));
  console.log('backup written:', file, '(', presets.length, 'presets, active', active, ')');
}

try {
  main();
} catch (e) {
  console.error('BACKUP FAILED:', e.message);
  process.exit(1);
}