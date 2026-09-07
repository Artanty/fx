const {
  CMD,
  RESP,
  PAYLOAD_LEN,
  EEPROM_SIZE,
  buildReport,
  C4Hid
} = require('./c4Hid');
const {
  C4_PRESET_BASE,
  C4_PRESET_PITCH,
  C4_DATA_OFF,
  C4_DATA_SIZE,
  C4_NAME_OFF,
  C4_NAME_SIZE,
  C4_PRESET_COUNT
} = require('./c4Model');

const WRITE_ROW = 16;

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

// C4 config report (0x45 -> 0x32): [fw u16][deviceModel][numPresets][activePreset]
// [wysiwyg][bypass][midiChannel][...] per the TeensyC4Synth README decode. The
// activePreset byte is the direct preset index (0..127) on the C4 — no slot
// matching needed. Offsets beyond midiChannel are unverified; `raw` is included
// so the probe can pin them before they are trusted anywhere.
function decodeConfig(payload) {
  return {
    firmwareVersion: u16(payload, 0),
    deviceModel: payload[2],
    numPresets: payload[3],
    activePreset: payload[4],
    wysiwyg: payload[5],
    hardwareBypassMode: payload[6],
    midiChannel: payload[7],
    raw: hex(payload)
  };
}

class C4Protocol {
  constructor(deviceInfo) {
    this.dev = new C4Hid(deviceInfo);
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
    return Buffer.from(payload.slice(0, PAYLOAD_LEN));
  }

  // Read `len` bytes from a preset at page-relative offset `off` (16-byte rows).
  readRegion(idx, off, len) {
    const base = C4_PRESET_BASE + (idx & 0x7f) * C4_PRESET_PITCH;
    const out = [];
    for (let k = 0; k < len; k += WRITE_ROW) {
      const want = Math.min(WRITE_ROW, len - k);
      const chunk = this.flashRead(base + off + k);
      out.push(...chunk.slice(0, want));
    }
    return Buffer.from(out);
  }

  getPresetName(idx) {
    const addr = C4_PRESET_BASE + (idx & 0x7f) * C4_PRESET_PITCH + C4_NAME_OFF;
    const block = this.flashRead(addr);
    let end = block.indexOf(0);
    if (end === -1) end = block.length;
    return Buffer.from(block.slice(0, end)).toString('ascii');
  }

  readPreset(idx, includeName) {
    const base = C4_PRESET_BASE + (idx & 0x7f) * C4_PRESET_PITCH;
    const chunks = [];
    for (let i = 1; i < (includeName ? 5 : 4) + 1; i++) {
      chunks.push(this.flashRead(base + i * PAYLOAD_LEN));
    }
    return Buffer.concat(chunks.map((c) => c));
  }

  readSlotBody(idx) {
    return this.readRegion(idx, C4_DATA_OFF, C4_DATA_SIZE);
  }

  readSlotName(idx) {
    return this.readRegion(idx, C4_NAME_OFF, C4_NAME_SIZE);
  }

  readSlotRaw(idx) {
    return this.readRegion(idx, C4_DATA_OFF, C4_DATA_SIZE + C4_NAME_SIZE);
  }

  getEEPROM() {
    const out = [];
    for (let off = 0; off < EEPROM_SIZE; off += PAYLOAD_LEN) {
      const reply = this.dev.requestSkim(
        CMD.EEPROM_READ,
        buildReport(CMD.EEPROM_READ, off, 0x20, 0, 0),
        CMD.EEPROM_READ,
        1500
      );
      const payload = parseReply(reply, CMD.EEPROM_READ);
      if (!payload) throw new Error(`unexpected eeprom reply @${off}: ${hex(reply)}`);
      out.push(...payload.slice(0, PAYLOAD_LEN));
    }
    return out;
  }

  getControlValue(ctrl) {
    const reply = this.dev.requestSkim(
      CMD.CTRL_GET,
      buildReport(CMD.CTRL_GET, 0, ctrl & 0xff, PAYLOAD_LEN),
      CMD.CTRL_GET,
      1500
    );
    const payload = parseReply(reply, CMD.CTRL_GET);
    if (!payload) throw new Error(`unexpected ctrl reply @${ctrl}: ${hex(reply)}`);
    return payload[0];
  }

  // CTRL_SET (0x70): live 16-bit control write at the LIVE control index.
  // `value` is the raw byte (0..255) for whole-byte controls.
  setControlValue(ctrl, value) {
    const v = Math.max(0, Math.min(0xffff, value & 0xff));
    this.dev.send(buildReport(CMD.CTRL_SET, ctrl & 0xff, (v >> 8) & 0xff, v & 0xff));
  }

  // Read the live control block via CTRL_GET. The reply is [0x75, block0, ...];
  // the C4's block is body-byte-indexed (payload[bodyByte] == body byte). Used
  // by the probe to confirm alignment before the observer relies on it.
  readControlBlock() {
    this.dev.send(buildReport(CMD.CTRL_GET, 0, 0, 0x10));
    const deadline = Date.now() + 1200;
    while (Date.now() < deadline) {
      let r;
      try {
        r = this.dev.receive(Math.max(deadline - Date.now(), 1));
      } catch (e) {
        break;
      }
      if (r && r.length >= 1 + 32 && r[0] === CMD.CTRL_GET) return Buffer.from(r.slice(1));
    }
    return null;
  }

  flashWrite(address, chunk) {
    const data = Buffer.from(chunk);
    const r = buildReport(CMD.FLASH_WRITE, (address >> 16) & 0xff, (address >> 8) & 0xff, address & 0xff);
    for (let i = 0; i < data.length; i++) r[4 + i] = data[i];
    this.dev.send(r);
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

  // Stage a body into the working preset and commit it to flash slot `idx`
  // (ACTIVE_STORE blocks + ACTIVE_WRITE), verify read-back, then recall the
  // preset so the change is heard immediately. `data` is the full 128-byte body.
  commitRawPreset(idx, data, name) {
    const dataBuf = Buffer.from(data);
    if (dataBuf.length !== C4_DATA_SIZE)
      throw new Error(`commitRawPreset needs ${C4_DATA_SIZE} data bytes, got ${dataBuf.length}`);
    const nameBuf = Buffer.alloc(C4_NAME_SIZE, 0);
    if (name) {
      const clean = String(name).replace(/[^\x20-\x7e]/g, '').slice(0, C4_NAME_SIZE);
      Buffer.from(clean, 'ascii').copy(nameBuf);
    }

    const blocks = [];
    for (let off = 0; off < dataBuf.length; off += PAYLOAD_LEN) {
      const chunk = dataBuf.slice(off, off + PAYLOAD_LEN);
      const last = off + chunk.length >= dataBuf.length ? 1 : 0;
      blocks.push(buildReport(CMD.ACTIVE_STORE, last, off, chunk.length, ...chunk));
    }
    for (const b of blocks) {
      this.dev.send(b);
      waitMs(500);
    }

    const wr = buildReport(CMD.ACTIVE_WRITE, idx & 0x7f, 1);
    for (let i = 0; i < nameBuf.length; i++) wr[3 + i] = nameBuf[i];
    this.dev.send(wr);
    waitMs(500);

    const back = this.readRegion(idx, C4_DATA_OFF, C4_DATA_SIZE);
    if (!back.equals(dataBuf)) {
      const diff = [];
      for (let i = 0; i < dataBuf.length; i++) if (back[i] !== dataBuf[i]) diff.push(i);
      throw new Error(`commitRawPreset verify failed at bytes [${diff.join(', ')}]`);
    }
    this.setActivePreset(idx);
    return dataBuf;
  }

  // Select a preset (0..127) as the active/live preset. Framing per sa_c4.h:
  // [0x77, presetIdx, 0].
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
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join(' ');
}

module.exports = {
  C4_PRESET_BASE,
  C4_PRESET_PITCH,
  C4_DATA_OFF,
  C4_DATA_SIZE,
  C4_NAME_OFF,
  C4_NAME_SIZE,
  C4_PRESET_COUNT,
  C4Protocol,
  decodeConfig,
  hex
};