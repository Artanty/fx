// Probe what PRESET_ERASE (0x38|0x80) actually does on the disposable slot
// 0x3f000. Captures the full region before and after erase, byte by byte, so we
// can see whether the slot becomes 0xff, 0x00, zeros-with-header, or unchanged.
// This slot is already scratch ("zval992200" from the write validation).
//
// Run: node scripts/probeErase.js

const { requireLalady } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const PAGE = 0x03f000;
const IDX = 3;
const REGION = LALADY_DATA_OFF + LALADY_DATA_SIZE + LALADY_NAME_SIZE;

function stats(b) {
  let ff = 0, z = 0, other = 0;
  for (const x of b) {
    if (x === 0xff) ff++;
    else if (x === 0x00) z++;
    else other++;
  }
  return { ff, z, other, len: b.length };
}

const p = new SourceAudioProtocol(requireLalady());
p.open();
try {
  const before = p.readRegion(PAGE, 0, REGION);
  console.log('before: ' + JSON.stringify(stats(before)) + ' header=' + before.slice(0, 0x20).toString('hex').slice(0, 40));
  console.log('before data=' + before.slice(LALADY_DATA_OFF, LALADY_DATA_OFF + 24).toString('hex'));
  console.log('before name=' + JSON.stringify(before.slice(LALADY_DATA_OFF + LALADY_DATA_SIZE).toString('ascii')));

  const ack = p.erasePreset(IDX);
  console.log('erasePreset(' + IDX + ') ack:', ack ? ack.join(',') : '(none)');

  // Poll up to ~8s watching the region settle.
  for (let delay = 0; delay <= 8000; delay += 2000) {
    const cur = p.readRegion(PAGE, 0, REGION);
    console.log('t+ ' + String(delay).padStart(4) + 'ms stats=' + JSON.stringify(stats(cur)) + ' data=' + cur.slice(LALADY_DATA_OFF, LALADY_DATA_OFF + 16).toString('hex') + ' name=' + JSON.stringify(cur.slice(LALADY_DATA_OFF + LALADY_DATA_SIZE).toString('ascii')));
  }
} finally {
  p.close();
}