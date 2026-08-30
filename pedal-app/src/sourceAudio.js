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

function waitMs(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {};
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

  // PRESET_ERASE (0x38): erases the flash slot for preset `idx` (slot index
  // 0..5, i.e. (page - 0x3c000)/0x1000). Framing per sa_c4.h as_erase():
  // [0x38, (idx & 0x7f) | 0x80, 0, 0], then read the ack. The 0x80 high bit is
  // the erase flag; without it the command is inert. Note: ACTIVE_WRITE (used by
  // writePreset) already does erase+program atomically, so a standalone erase is
  // only needed to clear a slot. (Verified inert on the L.A. Lady's 0x3c000
  // on-board region during probing — ACTIVE_WRITE is the supported clear+write.)
  erasePreset(idx) {
    const i = idx & 0x7f;
    const r = buildReport(CMD.PRESET_ERASE, i | 0x80, 0, 0);
    this.dev.send(r);
    waitMs(500);
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
  // Uses the ACTIVE_* path that Neuro uses (sa_c4.h): stage the 53-byte body
  // into the working preset with ACTIVE_STORE (0x76) blocks ([0x76, lastFlag,
  // offset, len, ...data], 32-byte payloads, offsets 0 and 32), then ACTIVE_WRITE
  // (0x6e) [0x6e, presetIdx, 1, name(32)] commits it to the flash slot. `idx` is
  // the raw preset slot index (0..5, (page - 0x3c000)/0x1000); no separate erase
  // is needed — ACTIVE_WRITE does the erase+program.
  writePreset(page, { name, params, idx }) {
    if (idx === undefined) idx = Math.round((page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH);
    const body = this.buildSlotBody({ name, params });
    const data = body.slice(0, LALADY_DATA_SIZE);

    // Stage the 53-byte body in <=32-byte ACTIVE_STORE blocks.
    const blocks = [];
    for (let off = 0; off < data.length; off += PAYLOAD_LEN) {
      const chunk = data.slice(off, off + PAYLOAD_LEN);
      const last = off + chunk.length >= data.length ? 1 : 0;
      blocks.push(buildReport(CMD.ACTIVE_STORE, last, off, chunk.length, ...chunk));
    }
    for (const b of blocks) {
      this.dev.send(b);
      waitMs(500);
    }

    // Commit the working preset + name to the flash slot.
    const wr = buildReport(CMD.ACTIVE_WRITE, idx & 0x7f, 1);
    const nameBuf = body.slice(LALADY_DATA_SIZE);
    for (let i = 0; i < nameBuf.length; i++) wr[3 + i] = nameBuf[i];
    this.dev.send(wr);
    waitMs(500);

    // Verify: read back the data+name region and compare byte-for-byte.
    const want = body;
    const back = this.readSlotRaw(page);
    if (!back.equals(want)) {
      const diff = [];
      for (let i = 0; i < want.length; i++) if (back[i] !== want[i]) diff.push(i);
      throw new Error(`verify failed at bytes [${diff.join(', ')}]`);
    }
    return want;
  }

  // Select a slot as the active/live preset. idx is the raw preset slot index
  // (0..5, (page - 0x3c000)/0x1000). Framing per sa_c4.h: [0x77, presetIdx, 0].
  setActivePreset(idx) {
    const r = buildReport(CMD.ACTIVE_SET, idx & 0x7f, 0);
    this.dev.send(r);
    waitMs(500);
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
