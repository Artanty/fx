const LALADY_PRESET_BASE = 0x03c000;
const LALADY_PRESET_PITCH = 0x1000;
const LALADY_DATA_OFF = 0x20;
const LALADY_NAME_OFF = 0x55;
const LALADY_DATA_SIZE = 53;
const LALADY_NAME_SIZE = 32;

// flash pages for the 6 onboard sounds: selectors first, then user presets
const SLOT_PAGES = [
  0x03c000,
  0x03d000,
  0x03e000,
  0x03f000,
  0x040000,
  0x041000
];

// DEPRECATED / WRONG: this +3 formula only coincides with reality at physical
// slot 3. Empirically (live HID probe 2026-09-01), ACTIVE_SET/ACTIVE_WRITE args
// ARE the physical slot index (0..5 -> page 0x3c000+idx*0x1000), and the config
// report's byte 4 ("activePreset") only distinguishes the group phys 0-2 (0) vs
// phys 3-5 (1) — it cannot pin down the active slot. Determine the active slot
// by matching the pedal's LIVE control table against the stored slot bodies
// (server.js resolveActiveSlot). Kept only for reference/dev scripts.
function activeSlotPage(activePreset) {
  return LALADY_PRESET_BASE + (3 + (activePreset & 0x7f)) * LALADY_PRESET_PITCH;
}

// MIDI map region: CC numbers stored as 0x100 - cc, 0xff = unconfigured
const MIDI_MAP_START = 0xc0;
const MIDI_MAP_LEN = 64;

function decodeMidiMap(eeprom) {
  const out = [];
  for (let i = MIDI_MAP_START; i < MIDI_MAP_START + MIDI_MAP_LEN && i < eeprom.length; i++) {
    const b = eeprom[i];
    if (b === 0xff) continue;
    const cc = 0x100 - b;
    if (cc > 0 && cc <= 127) out.push({ position: i, cc });
  }
  return out;
}

const EFFECT_TYPES = [
  'Tube Drive',
  'Smooth Tube',
  'Power Stage',
  'Crunch Tube',
  'TS9000',
  'Big Pi',
  'El Raton',
  'Fuzz Facade',
  'Bender',
  'Metal',
  'Octave Fuzz',
  'Gated Fuzz',
  'Bass Tube Drive',
  'Bass Smooth Tube',
  'Bass Power Stage',
  'Bass Crunch Tube',
  'Bass Big Pi',
  'Bass El Raton',
  'Bass Fuzz Facade',
  'Bass Bender',
  'Bass Metal',
  'Bass Octave Fuzz',
  'Bass Gated Fuzz',
  'Bass Tone Drive',
  'Tone Drive'
];

// description of the 53-byte preset block layout (recovered structure)
const PRESET_REGIONS = [
  { name: 'params', start: 0x00, len: 0x2f },
  { name: 'footer', start: 0x30, len: 0x05 }
];

function describePreset(data) {
  const rows = [];
  for (let i = 0; i < data.length; i += 8) {
    const slice = data.slice(i, i + 8);
    const region = PRESET_REGIONS.find(r => i >= r.start && i < r.start + r.len);
    rows.push({
      offset: i,
      hex: Array.from(slice).map(b => b.toString(16).padStart(2, '0')).join(' '),
      ascii: Array.from(slice).map(b => (b >= 32 && b < 127 ? String.fromCharCode(b) : '.')).join(''),
      region: region ? region.name : ''
    });
  }
  return rows;
}

module.exports = {
  LALADY_PRESET_BASE,
  LALADY_PRESET_PITCH,
  LALADY_DATA_OFF,
  LALADY_NAME_OFF,
  LALADY_DATA_SIZE,
  LALADY_NAME_SIZE,
  SLOT_PAGES,
  activeSlotPage,
  MIDI_MAP_START,
  MIDI_MAP_LEN,
  decodeMidiMap,
  EFFECT_TYPES,
  PRESET_REGIONS,
  describePreset
};
