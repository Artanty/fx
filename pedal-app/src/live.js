const path = require('path');
const { findLalady, listSourceAudioDevices } = require('./sourceAudioHid');
const {
  SourceAudioProtocol,
  hex,
  PRESET_ADDR_BASE,
  PRESET_ADDR_PITCH,
  PRESET_ADDR_NAME,
  PRESET_NAME_LEN
} = require('./sourceAudio');
const { loadOsbf } = require('./osbf');
const { SLOT_PAGES, decodeMidiMap, MIDI_MAP_START, MIDI_MAP_LEN } = require('./laLadyModel');

const OSBF_PATH = path.resolve(__dirname, '..', '..', 'input', '2026-07-31_labackup.osbf');

const LALADY_PRESET_BASE = 0x03c000;
const LALADY_PRESET_PITCH = 0x1000;
const LALADY_DATA_OFF = 0x20;
const LALADY_NAME_OFF = 0x55;

function slotName(buf) {
  let end = buf.indexOf(0);
  if (end === -1) end = buf.length;
  return Buffer.from(buf.slice(0, end)).toString('ascii').trim();
}

function readSlot(p, page) {
  const data = [];
  const take = [16, 16, 16, 5];
  for (let k = 0; k < take.length; k++) {
    const chunk = p.flashRead(page + LALADY_DATA_OFF + k * 16);
    data.push(...chunk.slice(0, take[k]));
  }
  const name = slotName(p.flashRead(page + LALADY_NAME_OFF));
  const hdr = p.flashRead(page);
  return { page, name, data: Buffer.from(data), hdr };
}

function main() {
  const dev = findLalady();
  if (!dev) {
    console.log('NO DEVICE. source audio devices found:');
    for (const d of listSourceAudioDevices()) {
      console.log('  pid=0x' + d.productId.toString(16), 'usagePage=0x' + d.usagePage.toString(16), 'interface=' + d.interface, d.path);
    }
    process.exit(1);
  }

  console.log('device:', dev.product || '', 'pid=0x' + dev.productId.toString(16), 'usagePage=0x' + dev.usagePage.toString(16), 'interface=' + dev.interface);

  const p = new SourceAudioProtocol(dev);
  p.open();
  try {
    const cfg = p.getHardwareConfig();
    console.log('\n--- HW CONFIG ---');
    console.log('  model:', cfg.deviceModel, '(L.A. Lady = 244)', 'firmware: 0x' + cfg.firmwareVersion.toString(16), 'activePreset:', cfg.activePreset, 'midiChannel:', cfg.midiChannel, 'bypassMode:', cfg.hardwareBypassMode);
    console.log('  raw:', JSON.stringify(cfg));

    console.log('\n--- EEPROM (256 B) vs .osbf ---');
    const eeprom = p.getEEPROM();
    const osbf = loadOsbf(OSBF_PATH);
    let diffCount = 0;
    for (let i = 0; i < eeprom.length; i++) {
      if (osbf.eeprom && eeprom[i] !== osbf.eeprom[i]) {
        diffCount++;
        if (diffCount <= 8) console.log('  diff @0x' + i.toString(16) + ': live=0x' + eeprom[i].toString(16) + ' osbf=0x' + osbf.eeprom[i].toString(16));
      }
    }
    console.log('  differing bytes:', diffCount, 'of', eeprom.length);
    console.log('  midi map region [0x' + MIDI_MAP_START.toString(16) + '..0x' + (MIDI_MAP_START + MIDI_MAP_LEN).toString(16) + ']: ' + hex(eeprom.slice(MIDI_MAP_START, MIDI_MAP_START + MIDI_MAP_LEN)));
    console.log('  midi map decoded:', JSON.stringify(decodeMidiMap(eeprom)));

    console.log('\n--- ONBOARD SLOTS (flash) ---');
    const slots = SLOT_PAGES.map(page => readSlot(p, page));
    for (const s of slots) {
      const isActive = s.page === LALADY_PRESET_BASE + (3 + cfg.activePreset) * LALADY_PRESET_PITCH;
      console.log('  ' + s.page.toString(16) + (isActive ? '  [ACTIVE]' : '') + '  ' + s.name + '  ' + s.data.toString('hex'));
    }

    console.log('\n--- WORKING/ACTIVE PRESET (config.activePreset -> flash) ---');
    const activePage = LALADY_PRESET_BASE + (3 + cfg.activePreset) * LALADY_PRESET_PITCH;
    const active = readSlot(p, activePage);
    console.log('  ' + activePage.toString(16) + '  ' + active.name);
    console.log('  data: ' + active.data.toString('hex'));

    console.log('\n--- PRESET NAME READS (C4-style base 0x080000, expected empty on L.A. Lady) ---');
    const probe = p.flashRead(PRESET_ADDR_BASE + PRESET_ADDR_NAME);
    console.log('  0x080000+0xA0:', hex(probe), '(all FF/7F = L.A. Lady does not use C4 128-preset flash)');
  } finally {
    p.close();
  }
}

main();
