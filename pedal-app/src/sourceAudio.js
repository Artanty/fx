const {
  CMD,
  RESP,
  PAYLOAD_LEN,
  EEPROM_SIZE,
  buildReport,
  SourceAudioHid
} = require('./sourceAudioHid');

// L.A. Lady flash layout (overrides the generic C4-style base below).
const {
  LALADY_PRESET_BASE,
  LALADY_PRESET_PITCH,
  LALADY_DATA_OFF,
  LALADY_NAME_OFF,
  LALADY_DATA_SIZE,
  LALADY_NAME_SIZE
} = require('./laLadyModel');
const { encodeBinary53 } = require('./neuroMap');

const WRITE_ROW = 16; // FLASH_WRITE programs 16-byte rows (matches probeWrite.js)

const PRESET_ADDR_BASE = 0x080000;
const PRESET_ADDR_PITCH = 0x1000;
const PRESET_ADDR_NAME = 0xa0;
const PRESET_NAME_LEN = 32;
const PRESET_COUNT = 128;

function parseReply(reply, respType) {
  if (reply[0] === respType) return reply.slice(1);
  if (reply.length > 1 && reply[1] === respType) return reply.slice(2);
  return null;
}

function u16(p, i) {
  return (p[i + 1] << 8) | p[i];
}

// L.A. Lady config report (0x45 -> 0x32): [fw u16][model][b3][activePreset][...]
// Offsets after activePreset are NOT verified against C4's as_hw_config_t, so the
// tail is exposed raw.
function decodeConfig(payload) {
  return {
    firmwareVersion: u16(payload, 0),
    deviceModel: payload[2],
    field3: payload[3],
    activePreset: payload[4],
    hardwareBypassMode: payload[6],
    midiChannel: payload[7],
    raw: hex(payload)
  };
}

class SourceAudioProtocol {
  constructor(deviceInfo) {
    this.dev = new SourceAudioHid(deviceInfo);
  }

  open() {
    this.dev.open();
  }

  close() {
    this.dev.close();
  }

  getHardwareConfig() {
    const reply = this.dev.requestSkim(CMD.CONFIG_GET, buildReport(CMD.CONFIG_GET), RESP.CONFIG_GET, 1500);
    const payload = parseReply(reply, RESP.CONFIG_GET);
    if (!payload) throw new Error(`unexpected config reply: ${hex(reply)}`);
    return decodeConfig(payload);
  }

  flashRead(address) {
    const reply = this.dev.requestSkim(
      CMD.FLASH_READ,
      buildReport(CMD.FLASH_READ, (address >> 16) & 0xff, (address >> 8) & 0xff, address & 0xff, 0),
      CMD.FLASH_READ,
      1500
    );
    const payload = parseReply(reply, CMD.FLASH_READ);
    if (!payload) throw new Error(`unexpected flash reply @0x${address.toString(16)}: ${hex(reply)}`);
    return payload.slice(0, PAYLOAD_LEN);
  }

  getPresetName(idx) {
    const addr = PRESET_ADDR_BASE + (idx & 0x7f) * PRESET_ADDR_PITCH + PRESET_ADDR_NAME;
    const block = this.flashRead(addr);
    let end = block.indexOf(0);
    if (end === -1) end = block.length;
    return Buffer.from(block.slice(0, end)).toString('ascii');
  }

  readPreset(idx, includeName) {
    const base = PRESET_ADDR_BASE + (idx & 0x7f) * PRESET_ADDR_PITCH;
    const chunks = [];
    for (let i = 1; i < (includeName ? 5 : 4) + 1; i++) {
      chunks.push(this.flashRead(base + i * PAYLOAD_LEN));
    }
    return Buffer.concat(chunks.map(c => Buffer.from(c)));
  }

  getEEPROM() {
    const out = [];
    for (let off = 0; off < EEPROM_SIZE; off += PAYLOAD_LEN) {
      const reply = this.dev.requestSkim(CMD.EEPROM_READ, buildReport(CMD.EEPROM_READ, off, 0x20, 0, 0), CMD.EEPROM_READ, 1500);
      const payload = parseReply(reply, CMD.EEPROM_READ);
      if (!payload) throw new Error(`unexpected eeprom reply @${off}: ${hex(reply)}`);
      out.push(...payload.slice(0, PAYLOAD_LEN));
    }
    return out;
  }

  getControlValue(ctrl) {
    const reply = this.dev.requestSkim(CMD.CTRL_GET, buildReport(CMD.CTRL_GET, 0, ctrl & 0xff, PAYLOAD_LEN), CMD.CTRL_GET, 1500);
    const payload = parseReply(reply, CMD.CTRL_GET);
    if (!payload) throw new Error(`unexpected ctrl reply @${ctrl}: ${hex(reply)}`);
    return payload[0];
  }

  // FLASH_WRITE (0x35): report = [0x35, addrHi, addrMid, addrLo, ...data].
  // Writes one 16-byte row at `address` (matches probeWrite.js framing).
  flashWrite(address, chunk) {
    const data = Buffer.from(chunk);
    const r = buildReport(CMD.FLASH_WRITE, (address >> 16) & 0xff, (address >> 8) & 0xff, address & 0xff);
    for (let i = 0; i < data.length; i++) r[4 + i] = data[i];
    this.dev.send(r);
    // Drain any ack the pedal emits; tolerate none. Keep this short so bulk
    // writes (many rows) don't each block for over a second.
    const deadline = Date.now() + 500;
    while (Date.now() < deadline) {
      let rep;
      try {
        rep = this.dev.receive(Math.max(deadline - Date.now(), 1));
      } catch (e) {
        break;
      }
      if (rep && rep.length) return rep;
    }
    return null;
  }

  // Read `len` bytes from a slot starting at page-relative offset `off`.
  readRegion(page, off, len) {
    const out = [];
    for (let k = 0; k < len; k += WRITE_ROW) {
      const want = Math.min(WRITE_ROW, len - k);
      const chunk = this.flashRead(page + off + k);
      out.push(...chunk.slice(0, want));
    }
    return Buffer.from(out);
  }

  // Write `buf` to a slot starting at page-relative offset `off` (16-byte rows).
  writeRegion(page, off, buf) {
    for (let k = 0; k < buf.length; k += WRITE_ROW) {
      this.flashWrite(page + off + k, buf.slice(k, k + WRITE_ROW));
    }
  }

  // Read the full data+name region (85 B) of a slot for verification/snapshot.
  readSlotRaw(page) {
    return this.readRegion(page, LALADY_DATA_OFF, LALADY_DATA_SIZE + LALADY_NAME_SIZE);
  }

  // PRESET_ERASE (0x38): erases the flash slot for preset `idx`. The Neuro app
  // addresses erase by preset index (not a raw flash address); 0x38 always acks
  // with 0x37 regardless, so callers must verify the slot actually cleared.
  erasePreset(idx) {
    const r = buildReport(CMD.PRESET_ERASE, idx & 0xff);
    this.dev.send(r);
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      let rep;
      try {
        rep = this.dev.receive(Math.max(deadline - Date.now(), 1));
      } catch (e) {
        break;
      }
      if (rep && rep.length) return rep;
    }
    return null;
  }

  // Build the 85-byte slot body (53 data + 32 name) from named params.
  buildSlotBody({ name, params }) {
    const data = encodeBinary53(params);
    const nameBuf = Buffer.alloc(LALADY_NAME_SIZE, 0);
    if (name) Buffer.from(String(name).slice(0, LALADY_NAME_SIZE), 'ascii').copy(nameBuf);
    return Buffer.concat([data, nameBuf]);
  }

  // Write a preset (params + name) to a slot page and verify read-back.
  // FLASH_WRITE only clears bits, so we PRESET_ERASE the slot first. `idx` is the
  // preset index to erase; if omitted it is derived from `page`. The slot header
  // (page+0..0x1f) is preserved by reading it pre-erase and rewriting it after.
  writePreset(page, { name, params, idx }) {
    if (idx === undefined) idx = Math.round((page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH) - 3;
    const header = this.readRegion(page, 0, LALADY_DATA_OFF);
    const body = this.buildSlotBody({ name, params });

    this.erasePreset(idx);
    const wait = ms => { const e = Date.now() + ms; while (Date.now() < e) {} };
    let erased = null; // 'ff' (clear-bits flash) or '00' (set-bits flash)
    for (let attempt = 0; attempt < 8 && !erased; attempt++) {
      wait(250);
      const region = this.readRegion(page, LALADY_DATA_OFF, body.length);
      if (region.every(b => b === 0xff)) erased = 'ff';
      else if (region.every(b => b === 0x00)) erased = '00';
    }
    if (!erased) {
      throw new Error('erase did not clear slot region (idx=' + idx + ' -> page 0x' + page.toString(16) + ')');
    }

    this.writeRegion(page, 0, header);
    this.writeRegion(page, LALADY_DATA_OFF, body);

    const want = Buffer.concat([header, body]);
    const back = this.readRegion(page, 0, LALADY_DATA_OFF + body.length);
    if (!back.equals(want)) {
      const diff = [];
      for (let i = 0; i < want.length; i++) if (back[i] !== want[i]) diff.push(i);
      throw new Error(`verify failed at bytes [${diff.join(', ')}]`);
    }
    return want;
  }

  // Select a slot as the active/live preset. idx is the config.activePreset
  // index (0..127). Mapping comes from laLadyModel.activeSlotPage.
  setActivePreset(idx) {
    const r = buildReport(CMD.ACTIVE_SET, idx & 0xff);
    this.dev.send(r);
    const deadline = Date.now() + 1500;
    while (Date.now() < deadline) {
      let rep;
      try {
        rep = this.dev.receive(Math.max(deadline - Date.now(), 1));
      } catch (e) {
        break;
      }
      if (rep && rep.length) return rep;
    }
    return null;
  }
}

function hex(bytes) {
  return bytes.map(b => b.toString(16).padStart(2, '0')).join(' ');
}

module.exports = {
  PRESET_ADDR_BASE,
  PRESET_ADDR_PITCH,
  PRESET_ADDR_NAME,
  PRESET_NAME_LEN,
  PRESET_COUNT,
  SourceAudioProtocol,
  decodeConfig,
  hex
};
