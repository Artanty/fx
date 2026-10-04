// Source Audio .osbf backup -> preset names.
//
// Format (see back/lalady/src/osbf.js for the shared parser): a text file made
// of `START_DATA <TYPE>; KEY=VALUE; ... <hex payload> END_DATA` blocks. For a
// C4 dump (PRODUCT_ID 249) the blocks are BACKUP_INFO, USER_EEPROM and one
// USER_PRESET per stored slot, each carrying `LOCATION` and a 32-byte
// space/NUL-padded `NAME`.
//
// Only the names are needed here: the MC3 side stores CC104 values, and the
// number the user sees on the pedal is the LOCATION. Slots absent from the dump
// (C4: 45 and 105) resolve to null and the UI shows the raw number.

const fs = require('fs');

const NAME_SIZE = 32;

function cleanName(raw) {
  return String(raw || '')
    .replace(/\0/g, ' ')
    .trim();
}

function parseOsbf(text) {
  const blocks = [];
  for (const part of text.split('START_DATA')) {
    const end = part.indexOf('END_DATA');
    if (end === -1) continue;
    const body = part.slice(0, end);
    const semi = body.indexOf(';');
    if (semi === -1) continue;
    const type = body.slice(0, semi).trim();
    const fields = {};
    for (const m of body.matchAll(/([A-Z_]+)=([^;\r\n]*)/g)) {
      fields[m[1]] = m[2].trim();
    }
    blocks.push({ type, fields });
  }
  return blocks;
}

// -> { productId, presets: [{ location, name }] }
function collectOsbf(text) {
  const result = { productId: null, presets: [] };
  for (const b of parseOsbf(text)) {
    if (b.type === 'BACKUP_INFO') {
      result.productId = parseInt(b.fields.PRODUCT_ID, 10) || null;
    } else if (b.type === 'USER_PRESET') {
      const location = parseInt(b.fields.LOCATION, 10);
      if (Number.isNaN(location)) continue;
      result.presets.push({ location, name: cleanName(b.fields.NAME) });
    }
  }
  result.presets.sort((a, b) => a.location - b.location);
  return result;
}

function loadOsbf(path) {
  return collectOsbf(fs.readFileSync(path, 'latin1'));
}

// Dense 0..127 lookup so the API can answer "what is C4 preset 61?" in O(1).
function presetNameMap(osbf) {
  const map = {};
  for (const p of osbf.presets) map[p.location] = p.name;
  return map;
}

module.exports = { loadOsbf, collectOsbf, parseOsbf, presetNameMap, cleanName, NAME_SIZE };
