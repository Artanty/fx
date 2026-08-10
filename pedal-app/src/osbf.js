const fs = require('fs');

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
    const runs = [];
    for (const m of body.matchAll(/[0-9A-Fa-f]{40,}/g)) runs.push(m[0]);
    const payload = runs.sort((a, b) => b.length - a.length)[0] || '';
    blocks.push({ type, fields, payload });
  }
  return blocks;
}

function decodeHex(payload) {
  return Buffer.from(payload, 'hex');
}

function loadOsbf(path) {
  const text = fs.readFileSync(path, 'latin1');
  const blocks = parseOsbf(text);

  const result = { productId: null, eeprom: null, presets: [], selectors: [] };

  for (const b of blocks) {
    switch (b.type) {
      case 'BACKUP_INFO':
        result.productId = parseInt(b.fields.PRODUCT_ID, 10) || null;
        break;
      case 'USER_EEPROM':
        result.eeprom = decodeHex(b.payload);
        break;
      case 'USER_PRESET':
        result.presets.push({
          location: parseInt(b.fields.LOCATION, 10),
          name: b.fields.NAME,
          raw: decodeHex(b.payload)
        });
        break;
      case 'USER_PRESET_SELECTOR':
        result.selectors.push({
          location: parseInt(b.fields.LOCATION, 10),
          name: b.fields.NAME,
          raw: decodeHex(b.payload)
        });
        break;
    }
  }

  return result;
}

module.exports = { parseOsbf, loadOsbf };
