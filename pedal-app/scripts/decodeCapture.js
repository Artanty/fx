#!/usr/bin/env node
// Decode captured L.A. Lady host->device HID reports.
//
// Input: lines of hex (raw report bytes). Accepts either:
//   - plain hex lines:       3503f020aabbccddeeff0123456789abcdef101032...
//   - tshark -T fields output (tab separated), e.g. produced by:
//       tshark -r capture.pcapng -T fields \
//         -e usb.endpoint_address.direction \
//         -e usb.setup.bRequestType -e usb.setup.bRequest -e usb.capdata
//     In that form only host->device lines (direction 0) are decoded.
//
// Usage:
//   node scripts/decodeCapture.js < capture.txt
//   node scripts/decodeCapture.js capture.txt
//
// The script strips a leading 0x00 report-id byte, then prints the command
// name and its parsed fields (address, payload, slot index, ...).

const fs = require('fs');

const CMD = {
  0x35: 'FLASH_WRITE',
  0x36: 'FLASH_READ',
  0x38: 'PRESET_ERASE',
  0x6e: 'ACTIVE_WRITE',
  0x76: 'ACTIVE_STORE',
  0x77: 'ACTIVE_SET',
  0x6f: 'CONFIG_SET',
  0x70: 'CTRL_SET',
  0x71: 'CTRL_GET',
  0x30: 'PRESET_GET',
  0x31: 'PRESET_SET',
  0x1c: 'EEPROM_WRITE',
  0x1d: 'EEPROM_READ',
  0x40: 'GET_SERIAL',
  0x46: 'SET_NAME',
  0x47: 'GET_NAME',
};

function hexToBytes(s) {
  s = s.trim().replace(/^0x/, '').replace(/\s+/g, '');
  const out = [];
  for (let i = 0; i + 1 < s.length + 1 && i < s.length; i += 2) {
    const b = parseInt(s.substr(i, 2), 16);
    if (Number.isNaN(b)) break;
    out.push(b);
  }
  return out;
}

function h(b) {
  return b.map((x) => x.toString(16).padStart(2, '0')).join(' ');
}

function decode(buf) {
  while (buf.length && buf[0] === 0x00) buf = buf.slice(1);
  if (buf.length === 0) return null;
  const cmd = buf[0];
  const name = CMD[cmd] || `CMD_0x${cmd.toString(16)}`;
  let detail = '';
  switch (cmd) {
    case 0x35:
    case 0x36: {
      const addr = (buf[1] << 16) | (buf[2] << 8) | buf[3];
      const data = buf.slice(4, 20);
      detail = `addr=0x${addr.toString(16)} data=[${h(data)}]`;
      break;
    }
    case 0x38:
      detail = `args=[${h(buf.slice(1))}]`;
      break;
    case 0x77: {
      const sel = buf[1];
      const idx = (buf[2] << 8) | buf[3];
      detail = `sel=0x${sel.toString(16)} idx=${idx}`;
      break;
    }
    case 0x6e:
    case 0x76: {
      const idx = (buf[1] << 8) | buf[2];
      detail = `idx=${idx} payload=[${h(buf.slice(3))}]`;
      break;
    }
    case 0x6f:
      detail = `which=0x${buf[1].toString(16)} payload=[${h(buf.slice(2))}]`;
      break;
    case 0x70:
    case 0x71:
      detail = `payload=[${h(buf.slice(1))}]`;
      break;
    case 0x30:
    case 0x31:
      detail = `slot=${buf[1]} payload=[${h(buf.slice(2))}]`;
      break;
    case 0x1c:
    case 0x1d:
      detail = `addr=${buf[1]} payload=[${h(buf.slice(2))}]`;
      break;
    case 0x40:
      detail = '(no args)';
      break;
    case 0x46:
    case 0x47:
      detail = `payload=[${h(buf.slice(1))}]`;
      break;
    default:
      detail = `payload=[${h(buf.slice(1))}]`;
  }
  return `${name.padEnd(13)} ${detail}`;
}

function main() {
  const arg = process.argv[2];
  const input = arg ? fs.readFileSync(arg, 'utf8') : fs.readFileSync(0, 'utf8');
  let count = 0;
  for (const raw of input.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split('\t');
    if (parts.length >= 4) {
      const dir = parts[0].trim();
      if (dir !== '0') continue; // host->device only
      const capdata = parts[parts.length - 1].trim();
      if (!capdata) continue;
      const buf = hexToBytes(capdata);
      if (buf.length < 1) continue;
      const d = decode(buf);
      if (!d) continue;
      console.log(d);
      count++;
    } else {
      const buf = hexToBytes(line);
      if (buf.length < 1) continue;
      const d = decode(buf);
      if (!d) continue;
      console.log(d);
      count++;
    }
  }
  console.error(`\nDecoded ${count} host->device report(s).`);
}

main();
