const {
  CMD,
  RESP,
  PAYLOAD_LEN,
  EEPROM_SIZE,
  buildReport,
  SourceAudioHid
} = require('./sourceAudioHid');

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
