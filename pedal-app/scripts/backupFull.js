// Full read-only device backup. Reads all 6 slot pages (header + data + name)
// and the EEPROM, and writes them to runtime-actions/lalady-backup-<ts>.json.
// Safe: reads only, no writes. Run before any erase/write experiment so a
// mishap is recoverable (once a working erase exists, restore = erase + write).
//
// Usage: node scripts/backupFull.js

const fs = require('fs');
const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const REGION = LALADY_DATA_OFF + LALADY_DATA_SIZE + LALADY_NAME_SIZE;

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const slots = [];
  for (const pg of SLOT_PAGES) {
    const reg = p.readRegion(pg, 0, REGION);
    slots.push({ page: pg, hex: reg.toString('hex') });
  }
  const eeprom = p.getEEPROM();
  const out = {
    product: 'lalady',
    ts: new Date().toISOString(),
    slots,
    eeprom: Buffer.from(eeprom).toString('hex')
  };
  const file = 'runtime-actions/lalady-backup-' + Date.now() + '.json';
  fs.writeFileSync(file, JSON.stringify(out, null, 2));
  console.log('wrote ' + file);
  console.log('  slots: ' + slots.length + ', eeprom bytes: ' + eeprom.length);
  for (const s of slots) {
    const nameBytes = Buffer.from(s.hex, 'hex').slice(LALADY_DATA_OFF + LALADY_DATA_SIZE, LALADY_DATA_OFF + LALADY_DATA_SIZE + 16);
    const n = nameBytes.indexOf(0);
    const name = Buffer.from(nameBytes.slice(0, n < 0 ? 16 : n)).toString('ascii');
    console.log('  page 0x' + s.page.toString(16) + ' name="' + name + '" first16=' + s.hex.slice(0, 32));
  }
} finally {
  p.close();
}
