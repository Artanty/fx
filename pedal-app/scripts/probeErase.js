// Diagnostic: find the correct PRESET_ERASE (0x38) argument encoding for the
// L.A. Lady. Sends candidate erase reports to one slot, checks whether the slot
// flash region clears to 0xFF, then restores the slot from a snapshot.
//
// Usage: node scripts/probeErase.js [hexPage]
//   hexPage defaults to the first onboard slot (0x03c000).
//
// Only ERASING happens here (no preset data is written). The pedal's real presets
// stay intact unless a candidate erases a different region — re-upload from the
// .osbf afterward to be safe.

const { findLalady, buildReport } = require('../src/sourceAudioHid');
const { SourceAudioProtocol } = require('../src/sourceAudio');
const { SLOT_PAGES, LALADY_DATA_OFF, LALADY_DATA_SIZE, LALADY_NAME_SIZE } = require('../src/laLadyModel');

const PAGE = parseInt(process.argv[2] || '0', 16) || SLOT_PAGES[0];
const REGION_LEN = LALADY_DATA_SIZE + LALADY_NAME_SIZE;

function wait(ms) { const e = Date.now() + ms; while (Date.now() < e) {} }

const p = new SourceAudioProtocol(findLalady());
p.open();
try {
  const region = () => p.readRegion(PAGE, LALADY_DATA_OFF, REGION_LEN);
  const header = p.readRegion(PAGE, 0, LALADY_DATA_OFF);
  const before = region();
  const neighborPage = SLOT_PAGES.find(pg => pg !== PAGE) || (PAGE + 0x1000);
  const neighborBefore = p.readRegion(neighborPage, LALADY_DATA_OFF, REGION_LEN);

  console.log('target slot page : 0x' + PAGE.toString(16));
  console.log('before (data16)  : ' + before.slice(0, 16).toString('hex'));
  console.log('neighbor page    : 0x' + neighborPage.toString(16));
  console.log('neighbor (data16): ' + neighborBefore.slice(0, 16).toString('hex'));
  console.log('---');

  const idx = ((PAGE - 0x03c000) / 0x1000) | 0;
  const candidates = [
    { name: '3-byte BE addr',        args: [(PAGE >> 16) & 0xff, (PAGE >> 8) & 0xff, PAGE & 0xff] },
    { name: '2-byte BE addr',        args: [(PAGE >> 8) & 0xff, PAGE & 0xff] },
    { name: '3-byte LE addr',        args: [PAGE & 0xff, (PAGE >> 8) & 0xff, (PAGE >> 16) & 0xff] },
    { name: '4-byte addr',           args: [0, (PAGE >> 16) & 0xff, (PAGE >> 8) & 0xff, PAGE & 0xff] },
    { name: '3-byte + pad 0',        args: [(PAGE >> 16) & 0xff, (PAGE >> 8) & 0xff, PAGE & 0xff, 0] },
    { name: 'idx ' + idx,            args: [idx & 0xff] },
    { name: 'idx + 0,0',             args: [idx & 0xff, 0, 0] },
    { name: '0xff,0xff,0xff',        args: [0xff, 0xff, 0xff] }
  ];

  let working = null;
  for (const c of candidates) {
    const r = buildReport(0x38, ...c.args);
    p.dev.send(r);
    const replies = [];
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      try { const x = p.dev.receive(200); if (x && x.length) replies.push('0x' + x[0].toString(16)); }
      catch (e) { break; }
    }
    wait(300);
    const after = region();
    const cleared = after.every(b => b === 0xff);
    console.log('[' + c.name.padEnd(16) + '] cleared=' + cleared + '  replies=' + (replies.join(',') || 'none') + '  after=' + after.slice(0, 8).toString('hex'));
    if (cleared) { working = c; break; }
  }

  if (working) {
    console.log('\n>>> WORKING ERASE FORMAT: ' + working.name + '  args=' + JSON.stringify(working.args));
    // restore the targeted slot from the snapshot
    p.writeRegion(PAGE, 0, header);
    p.writeRegion(PAGE, LALADY_DATA_OFF, before);
    const neighborAfter = p.readRegion(neighborPage, LALADY_DATA_OFF, REGION_LEN);
    const neighborHit = !neighborAfter.equals(neighborBefore);
    console.log('slot restored. neighbor affected by erase? ' + (neighborHit ? 'YES (erase is wide) — re-upload all from .osbf' : 'no'));
  } else {
    console.log('\n>>> no candidate cleared the slot; slot left intact');
  }
} finally {
  p.close();
}
