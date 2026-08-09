const { findLalady } = require('./sourceAudioHid');
const { SourceAudioProtocol } = require('./sourceAudio');

// Definitive write-location scan.
// 1. Snapshot the affected slot page BEFORE writing (0x3f000..0x3f080).
// 2. Write a distinctive 16-byte pattern via `35 <hi> <mid> <lo> <data16>`.
// 3. Immediately read back the affected page at 0x10 granularity.
// 4. Scan a WIDE flash range (0x30000..0x43000) at 0x10 granularity for the pattern.
// This pinpoints the exact write addressing offset, if any.

function hex(bytes) {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join(' ');
}

const PATTERN = [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef, 0x10, 0x32];
const PAT_STR = hex(PATTERN);

function main() {
  const p = new SourceAudioProtocol(findLalady());
  p.open();
  try {
    const addr = 0x3f020;

    console.log('--- before: slot 0x3f000 page ---');
    for (let off = 0x00; off < 0x100; off += 0x10) {
      const got = p.flashRead(0x3f000 + off).slice(0, 16);
      console.log('  +0x' + off.toString(16).padStart(2, '0') + ': ' + hex(got));
    }

    const r = new Array(38).fill(0);
    r[0] = 0x35;
    r[1] = (addr >> 16) & 0xff;
    r[2] = (addr >> 8) & 0xff;
    r[3] = addr & 0xff;
    for (let i = 0; i < 16; i++) r[4 + i] = PATTERN[i];
    console.log('\n--- write report[0..23]: ' + hex(r.slice(0, 24)) + ' ---');
    p.dev.send(r);

    const deadline = Date.now() + 600;
    while (Date.now() < deadline) {
      try {
        const rep = p.dev.receive(150);
        if (rep && rep.length) console.log('  reply: ' + hex(rep));
      } catch (e) { break; }
    }

    console.log('\n--- after: slot 0x3f000 page ---');
    for (let off = 0x00; off < 0x100; off += 0x10) {
      const got = p.flashRead(0x3f000 + off).slice(0, 16);
      console.log('  +0x' + off.toString(16).padStart(2, '0') + ': ' + hex(got));
    }

    console.log('\n--- wide scan 0x30000..0x43000 for pattern ---');
    const found = [];
    for (let a = 0x30000; a < 0x43000; a += 0x10) {
      const got = hex(p.flashRead(a).slice(0, 16));
      if (got === PAT_STR) found.push(a);
    }
    if (found.length) {
      console.log('  FOUND at: ' + found.map(a => '0x' + a.toString(16)).join(', '));
    } else {
      console.log('  pattern not found in 0x30000..0x43000');
    }
  } finally {
    p.close();
  }
}

main();
