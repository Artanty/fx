const { HID, devices } = require('node-hid');

const AS_VID = 0x29a4;
const AS_PID_LALADY = 0x0300;

const CMD = {
  CTRL_SET: 0x70,
  CTRL_GET: 0x75,
  ACTIVE_STORE: 0x76,
  ACTIVE_SET: 0x77,
  ACTIVE_WRITE: 0x6e,
  CONFIG_SET: 0x6f,
  CONFIG_GET: 0x45,
  PRESET_ERASE: 0x38,
  FLASH_READ: 0x36,
  FLASH_WRITE: 0x35,
  EEPROM_READ: 0x80,
  EEPROM_WRITE: 0x81
};

const RESP = {
  CONFIG_GET: 0x32,
  ERASE_ACK: 0x37
};

const PAYLOAD_LEN = 32;
const REPORT_LEN = 38;
const EEPROM_SIZE = 256;

function listSourceAudioDevices() {
  return devices().filter(d => d.vendorId === AS_VID);
}

function findLalady() {
  const list = listSourceAudioDevices();
  return (
    list.find(d => d.productId === AS_PID_LALADY) ||
    list.find(d => d.usagePage === 0xffa0 && d.interface === 2) ||
    list[0] ||
    null
  );
}

function buildReport(cmd) {
  const r = new Array(REPORT_LEN).fill(0);
  r[0] = cmd;
  for (let i = 1; i < arguments.length; i++) r[i] = arguments[i] & 0xff;
  return r;
}

class SourceAudioHid {
  constructor(deviceInfo) {
    this.deviceInfo = deviceInfo;
    this.hid = null;
  }

  open() {
    this.hid = new HID(this.deviceInfo.path);
  }

  close() {
    if (this.hid) this.hid.close();
    this.hid = null;
  }

  send(report) {
    const buf = new Array(REPORT_LEN + 1).fill(0);
    buf[0] = 0x00;
    for (let i = 0; i < report.length; i++) buf[i + 1] = report[i];
    const n = this.hid.write(buf);
    if (n !== buf.length) throw new Error(`short write: ${n} of ${buf.length}`);
  }

  receive(timeoutMs) {
    const data = this.hid.readTimeout(timeoutMs || 1000);
    if (!data) throw new Error('read timeout');
    return Array.from(data);
  }

  request(cmd, report, timeoutMs) {
    this.send(report);
    return this.receive(timeoutMs);
  }

  requestSkim(cmd, report, heads, timeoutMs) {
    this.send(report);
    const deadline = Date.now() + (timeoutMs || 1500);
    const list = Array.isArray(heads) ? heads : [heads];
    while (Date.now() < deadline) {
      let r;
      try {
        r = this.receive(Math.max(deadline - Date.now(), 1));
      } catch (e) {
        break;
      }
      if (r.length && list.includes(r[0])) return r;
    }
    throw new Error(`timeout waiting for reply 0x${heads.map(h => h.toString(16)).join('/')} to 0x${cmd.toString(16)}`);
  }
}

module.exports = {
  AS_VID,
  AS_PID_LALADY,
  CMD,
  RESP,
  PAYLOAD_LEN,
  REPORT_LEN,
  EEPROM_SIZE,
  listSourceAudioDevices,
  findLalady,
  buildReport,
  SourceAudioHid
};
