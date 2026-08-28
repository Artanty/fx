// Step 2 of the plan: re-derive FLASH_WRITE (0x35) behavior on a confirmed USB
// link, SAFELY. We write all-0xFF (0xff) to a scratch region of one slot.
//   - clear-only flash: programming 0xff clears no bits -> region UNCHANGED (safe).
//   - auto-erasing flash: cell is erased to 0xff then "programmed" with 0xff ->
//     region becomes 0xff, which we can restore via the same FLASH_WRITE.
// Either outcome is non-destructive to the real preset data.
//
// Usage: node scripts/probeWriteBehavior.js

const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF } = require('../src/laLadyModel');

const REGION = 32;
const TEST_PAGE = SLOT_PAGES[0]; // 0x3c000
const TEST_OFF = LALADY_DATA_OFF; // 0x20

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const snap = p.readRegion(TEST_PAGE, TEST_OFF, REGION);
  console.log('before:', snap.toString('hex'));

  p.writeRegion(TEST_PAGE, TEST_OFF, Buffer.alloc(REGION, 0xff));
  const after = p.readRegion(TEST_PAGE, TEST_OFF, REGION);
  console.log('after :', after.toString('hex'));

  if (after.every(b => b === 0xff)) {
    console.log('RESULT: FLASH_WRITE AUTO-ERASES (region became 0xff). No separate erase needed.');
    p.writeRegion(TEST_PAGE, TEST_OFF, snap);
    const back = p.readRegion(TEST_PAGE, TEST_OFF, REGION);
    console.log('restored:', back.toString('hex'), back.equals(snap) ? 'OK' : 'MISMATCH');
  } else if (after.equals(snap)) {
    console.log('RESULT: FLASH_WRITE is clear-only / no-op for 0xff (NO auto-erase). Separate erase required.');
  } else {
    console.log('RESULT: FLASH_WRITE modified bits (clear-only). Separate erase required.');
    console.log('  WARNING: scratch region may be corrupted; restore once erase is known.');
  }
} finally {
  p.close();
}
