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

function collectBlocks(blocks) {
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

function loadOsbf(path) {
  const text = fs.readFileSync(path, 'latin1');
  return collectBlocks(parseOsbf(text));
}

function loadOsbfText(text) {
  return collectBlocks(parseOsbf(text));
}

// --- Serializer: mirror the parseOsbf text format exactly ---

function padName(name) {
  const s = String(name || '').slice(0, 32);
  return s + ' '.repeat(32 - s.length);
}

function block(type, lines) {
  return 'START_DATA\n' + type + ';\n' + lines.join(';\n') + ';\nEND_DATA';
}

function serializeOsbf({ productId, eeprom, presets, selectors }) {
  const parts = [];

  parts.push(block('BACKUP_INFO', ['PRODUCT_ID=' + (productId || 244)]));

  if (eeprom) {
    parts.push(block('USER_EEPROM', [
      'SIZE=256',
      Buffer.from(eeprom).toString('hex').toUpperCase()
    ]));
  }

  for (const p of presets) {
    const raw = Buffer.isBuffer(p.raw) ? p.raw : Buffer.from(p.raw);
    parts.push(block('USER_PRESET', [
      'LOCATION=' + p.location,
      'SIZE=53',
      'NAME=' + padName(p.name),
      raw.toString('hex').toUpperCase()
    ]));
  }

  for (const s of selectors) {
    const raw = Buffer.isBuffer(s.raw) ? s.raw : Buffer.from(s.raw);
    parts.push(block('USER_PRESET_SELECTOR', [
      'LOCATION=' + s.location,
      'SIZE=53',
      'NAME=' + padName(s.name),
      raw.toString('hex').toUpperCase()
    ]));
  }

  return parts.join('\n') + '\n';
}

module.exports = { parseOsbf, loadOsbf, loadOsbfText, serializeOsbf };
