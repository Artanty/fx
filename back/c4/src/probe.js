// READ-ONLY probe of the live C4 Synth: config, flash preset bodies/names,
// EEPROM MIDI map, live control block, and full preset-list timing. Writes
// nothing. Run with node from back/c4synth and NODE_PATH=<back/lalady/node_modules>.
const { findC4, listSourceAudioDevices } = require('./c4Hid');
const { C4Protocol } = require('./c4Protocol');
const { C4_PRESET_BASE, C4_PRESET_PITCH, C4_DATA_SIZE, C4_NAME_OFF, C4_NAME_SIZE, C4_PRESET_COUNT } = require('./c4Model');

function hex(bytes, per = 16) {
  const parts = [];
  for (let i = 0; i < bytes.length; i++) parts.push(bytes[i].toString(16).padStart(2, '0'));
  const lines = [];
  for (let i = 0; i < parts.length; i += per) lines.push(parts.slice(i, i + per).join(' '));
  return lines.join('\n');
}

async function main() {
  console.log('devices:', listSourceAudioDevices().map((d) => ({
    product: (d.product || '').toString(),
    vendorId: d.vendorId.toString(16),
    productId: d.productId.toString(16),
    usagePage: d.usagePage,
    interface: d.interface,
    path: d.path
  })));

  const dev = findC4();
  if (!dev) {
    console.error('NO C4 FOUND');
    return;
  }
  const p = new C4Protocol(dev);
  p.open();

  const cfg = p.getHardwareConfig();
  console.log('hardware config:', JSON.stringify(cfg, null, 2));

  let active = cfg.activePreset;
  console.log('\nactivePreset from config:', active);

  const t0 = Date.now();
  const names = [];
  for (let i = 0; i < C4_PRESET_COUNT; i++) names.push(i + ':' + p.getPresetName(i));
  console.log('name list (ms):', Date.now() - t0);
  console.log(names.filter((n) => !/:$/.test(n)).slice(0, 40).join('\n'));

  // Compare active body to the last read preset body if index matches a sample.
  const idx = active >= 0 && active < C4_PRESET_COUNT ? active : 0;
  const raw = p.readSlotRaw(idx);
  console.log('\nslot', idx, 'data@0x20 (128B):\n' + hex(raw.slice(0, C4_DATA_SIZE)));
  console.log('  name@0xA0:', Buffer.from(raw.slice(C4_DATA_SIZE, C4_DATA_SIZE + C4_NAME_SIZE)).toString('ascii') || '(empty)');

  // Verify readRegion vs readPreset agree.
  const body = p.readSlotBody(idx);
  const body2 = p.readPreset(idx, false).slice(0, C4_DATA_SIZE);
  console.log('readSlotBody==readPreset slice:', body.equals(body2), 'len', body.length);

  const name = p.readSlotName(idx);
  const name2 = p.getPresetName(idx);
  console.log('readSlotName==getPresetName:', name.toString('ascii') === name2, JSON.stringify(name.toString('ascii')));

  const eeprom = p.getEEPROM();
  console.log('\neeprom (256B):\n' + hex(eeprom));

  const block = p.readControlBlock();
  console.log('\nreadControlBlock len:', block ? block.length : null);
  if (block) {
    console.log('live block head:\n' + hex(block.slice(0, Math.min(block.length, 48))));
    // Heuristic: is payload[bodyByte] == body[bodyByte] for whole bytes?
    const matches = [];
    for (let i = 0; i < Math.min(body.length, block.length); i++) {
      if (body[i] === block[i]) matches.push(i);
    }
    console.log('positions where live-block[i]==body[i]:', matches.length, 'of', Math.min(body.length, block.length));
  }

  p.close();
  console.log('\nprobe complete (read-only)');
}

main().catch((e) => {
  console.error('PROBE FAILED:', e.message);
  console.error(e);
});