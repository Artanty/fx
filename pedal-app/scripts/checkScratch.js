// Read-only integrity check: compare the live slot pages against the most
// recent backup JSON. Reports which pages (if any) differ, and exactly which
// bytes, so we know if a probe corrupted anything.
//
// Usage: node scripts/checkScratch.js [backup.json]

const fs = require('fs');
const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const REGION = LALADY_DATA_OFF + LALADY_DATA_SIZE + LALADY_NAME_SIZE;
const backupPath = process.argv[2] || require('child_process').execSync('ls -t runtime-actions/lalady-backup-*.json | head -1').toString().trim();

const bak = JSON.parse(fs.readFileSync(backupPath, 'latin1'));

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  let corrupted = false;
  for (const slot of bak.slots) {
    const pg = slot.page;
    const want = Buffer.from(slot.hex, 'hex').slice(0, REGION);
    const got = p.readRegion(pg, 0, REGION);
    if (!got.equals(want)) {
      corrupted = true;
      const diff = [];
      for (let i = 0; i < REGION; i++) if (got[i] !== want[i]) diff.push(i);
      console.log('SLOT 0x' + pg.toString(16) + ' DIFFERS at ' + diff.length + ' bytes: ' + diff.slice(0, 20).join(',') + (diff.length > 20 ? '...' : ''));
    } else {
      console.log('slot 0x' + pg.toString(16) + ' OK');
    }
  }
  const eepromWant = Buffer.from(bak.eeprom, 'hex');
  const eepromGot = Buffer.from(p.getEEPROM());
  console.log('eeprom', eepromGot.equals(eepromWant) ? 'OK' : 'DIFFERS');
  console.log(corrupted ? '--- CORRUPTION DETECTED ---' : '--- all slots match backup ---');
} finally {
  p.close();
}
