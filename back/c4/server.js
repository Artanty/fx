const path = require('path');
const express = require('express');
const { findC4, listSourceAudioDevices } = require('./src/c4Hid');
const { C4Protocol } = require('./src/c4Protocol');
const c4UiLog = require('./src/c4UiLog');
const {
  C4_PRESET_BASE,
  C4_PRESET_PITCH,
  C4_DATA_OFF,
  C4_DATA_SIZE,
  C4_NAME_OFF,
  C4_NAME_SIZE,
  C4_PRESET_COUNT,
  WORKBENCH_CONTROL_SPECS
} = require('./src/c4Model');

const PORT = process.env.PORT || 3222;
const CACHE_TTL = 10000;

// Body-byte -> display name (first spec at that byte), and live index -> name.
const NAME_BY_BODY = {};
const NAME_BY_LIVE = {};
for (const s of WORKBENCH_CONTROL_SPECS) {
  if (!NAME_BY_BODY[s.index]) NAME_BY_BODY[s.index] = s.name;
  if (s.liveIndex != null && !NAME_BY_LIVE[s.liveIndex]) NAME_BY_LIVE[s.liveIndex] = s.name;
}

function bodyName(i) {
  return NAME_BY_BODY[i] || `byte ${i}`;
}

function liveName(i) {
  return NAME_BY_LIVE[i] || `live ${i}`;
}

// EEPROM MIDI map decode: 128-byte table at 0x80..0xff, indexed by CC number
// (same convention as the L.A. Lady). eeprom[0x80 + cc] = live control index it
// drives (0xff = unassigned).
function decodeMidiMapFromEeprom(eeprom) {
  const ccToControl = new Array(128).fill(0xff);
  const controlToCc = {};
  for (let cc = 0; cc < 128; cc++) {
    const addr = 0x80 + cc;
    if (addr >= eeprom.length) break;
    const ctrl = eeprom[addr];
    if (ctrl !== 0xff) {
      ccToControl[cc] = ctrl;
      controlToCc[ctrl] = cc;
    }
  }
  return { ccToControl, controlToCc };
}

// ONE persistent HID handle for ALL pedal access (same rule as the L.A. Lady:
// re-opening makes the pedal reload its live control table from flash and
// reverts in-flight live CTRL_SET writes).
let sharedProto = null;
let sharedDevice = null;
function getSharedProto() {
  if (sharedProto) return sharedProto;
  sharedDevice = findC4();
  if (!sharedDevice) return null;
  sharedProto = new C4Protocol(sharedDevice);
  sharedProto.open();
  return sharedProto;
}
function resetSharedProto() {
  if (sharedProto) {
    try {
      sharedProto.close();
    } catch (e) { /* ignore */ }
    sharedProto = null;
    sharedDevice = null;
  }
}

function cleanName(s) {
  return String(s).replace(/\0.*$/, '').trim();
}

// The config's activePreset byte is the direct preset index (0..127) on the C4.
function activePresetIdx(p) {
  const cfg = p.getHardwareConfig();
  const idx = cfg.activePreset;
  if (!Number.isInteger(idx) || idx < 0 || idx >= C4_PRESET_COUNT) {
    throw new Error(`config activePreset out of range: ${idx}`);
  }
  return idx;
}

let deviceCache = { at: 0, data: null };
function snapshot(fresh) {
  const now = Date.now();
  if (!fresh && deviceCache.data && now - deviceCache.at < 2000) return deviceCache.data;
  const p = getSharedProto();
  if (!p) return { error: 'Source Audio C4 Synth HID device not found', devices: listSourceAudioDevices() };
  const config = p.getHardwareConfig();
  deviceCache = {
    at: now,
    data: {
      config,
      device: {
        product: (sharedDevice.product || '').trim(),
        vendorId: sharedDevice.vendorId,
        productId: sharedDevice.productId,
        path: sharedDevice.path
      }
    }
  };
  return deviceCache.data;
}

function collectErrors(res, e) {
  resetSharedProto();
  res.status(500).json({ error: e.message });
}

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.get('/api/device', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json({ found: true, device: s.device });
});

app.get('/api/status', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json({ config: s.config, device: s.device });
});

app.get('/api/control-map', (req, res) => {
  res.json({ ok: true, count: WORKBENCH_CONTROL_SPECS.length, controls: WORKBENCH_CONTROL_SPECS });
});

// Live mirror/observe source: the ACTIVE preset's flash body (128 bytes) + name.
// The config activePreset byte is directly reliable on the C4, so no slot
// matching is needed. Flash reads are read-only and safe alongside the editor.
app.get('/api/controls', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const idx = activePresetIdx(p);
    const body = Array.from(p.readSlotBody(idx));
    const name = cleanName(p.readSlotName(idx).toString('ascii'));
    const params = body.map((value, i) => ({ index: i, name: bodyName(i), value }));
    res.json({ ok: true, ts: Date.now(), activeIndex: idx, presetName: name, params, body });
  } catch (e) {
    collectErrors(res, e);
  }
});

// Preset list (idx + name for all 128) or a single preset: ?idx=N.
let listCache = { at: 0, data: null };
app.get('/api/presets', (req, res) => {
  if (req.query.idx !== undefined) {
    const idx = parseInt(req.query.idx, 10);
    if (!Number.isInteger(idx) || idx < 0 || idx >= C4_PRESET_COUNT)
      return res.status(400).json({ error: `idx must be an integer 0..${C4_PRESET_COUNT - 1}` });
    const p = getSharedProto();
    if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
    try {
      const name = cleanName(p.getPresetName(idx).toString('ascii'));
      const raw = p.readSlotRaw(idx);
      const body = Array.from(raw.slice(0, C4_DATA_SIZE));
      res.json({
        ok: true,
        idx,
        count: C4_PRESET_COUNT,
        page: (C4_PRESET_BASE + idx * C4_PRESET_PITCH).toString(16),
        name,
        body,
        hex: Buffer.from(body).toString('hex'),
        params: body.map((value, i) => ({ index: i, name: bodyName(i), value }))
      });
    } catch (e) {
      collectErrors(res, e);
    }
    return;
  }

  const now = Date.now();
  if (listCache.data && now - listCache.at < CACHE_TTL) {
    return res.json({ ok: true, count: listCache.data.length, presets: listCache.data });
  }
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const presets = [];
    for (let idx = 0; idx < C4_PRESET_COUNT; idx++) {
      presets.push({ idx, name: cleanName(p.getPresetName(idx).toString('ascii')) });
    }
    listCache = { at: now, data: presets };
    res.json({ ok: true, count: presets.length, presets });
  } catch (e) {
    collectErrors(res, e);
  }
});

app.post('/api/activate', (req, res) => {
  const idx = req.body && req.body.idx;
  if (!Number.isInteger(idx) || idx < 0 || idx >= C4_PRESET_COUNT)
    return res.status(400).json({ error: `idx must be an integer 0..${C4_PRESET_COUNT - 1}` });
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const reply = p.setActivePreset(idx);
    c4UiLog.stamp('ACTIVATE', `preset=${idx}`);
    res.json({ ok: true, index: idx, page: (C4_PRESET_BASE + idx * C4_PRESET_PITCH).toString(16), reply: reply ? reply.join(',') : null });
  } catch (e) {
    collectErrors(res, e);
  }
});

// Commit a control byte DIRECTLY into the active preset's flash body, then
// re-activate so the change is heard. body: { index: body byte 0..127, value }.
// Used by the workbench for whole composed bytes (packed fields send the FULL
// composed byte after combining sibling bits client-side, so nothing clobbers).
app.post('/api/control', (req, res) => {
  const index = parseInt(req.body && req.body.index, 10);
  const value = parseInt(req.body && req.body.value, 10);
  if (!Number.isInteger(index) || index < 0 || index >= C4_DATA_SIZE)
    return res.status(400).json({ error: `index must be an integer 0..${C4_DATA_SIZE - 1} (body byte)` });
  if (!Number.isInteger(value) || value < 0 || value > 255)
    return res.status(400).json({ error: 'value must be an integer 0..255' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const rawIdx = activePresetIdx(p);
    const body = p.readSlotBody(rawIdx);
    body[index] = value;
    const name = cleanName(p.readSlotName(rawIdx).toString('ascii'));
    const written = p.commitRawPreset(rawIdx, body, name);
    c4UiLog.stamp('FLASH', `byte=${index} name=${bodyName(index)} value=0x${value.toString(16).padStart(2, '0')} readback=0x${written[index].toString(16).padStart(2, '0')} preset=${rawIdx}`);
    res.json({ ok: true, index, value, readback: written[index], presetIndex: rawIdx });
  } catch (e) {
    collectErrors(res, e);
  }
});

// Live realtime param set via CTRL_SET at the LIVE control index (whole-byte
// controls only). NOT persisted — the flash-commit /api/control + Save persist.
app.post('/api/control/live', (req, res) => {
  const index = parseInt(req.body && req.body.index, 10);
  const value = parseInt(req.body && req.body.value, 10);
  if (!Number.isInteger(index) || index < 0 || index > 171)
    return res.status(400).json({ error: 'index must be an integer 0..171 (live control index)' });
  if (!Number.isInteger(value) || value < 0 || value > 255)
    return res.status(400).json({ error: 'value must be an integer 0..255' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    p.setControlValue(index, value);
    c4UiLog.stamp('LIVE', `idx=${index} name=${liveName(index)} value=${value}`);
    res.json({ ok: true, index, value });
  } catch (e) {
    collectErrors(res, e);
  }
});

// Persist a full edited state into a preset slot (default: the current active).
// body: { idx?: 0..127, overrides: { bodyByte: value } }. Starts from the slot's
// current flash body, applies overrides (full composed bytes), commits + recalls.
app.post('/api/presets/save', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const activeIdx = activePresetIdx(p);
    const rawIdx = Number.isInteger(req.body && req.body.idx) ? req.body.idx : activeIdx;
    if (!Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx >= C4_PRESET_COUNT)
      return res.status(400).json({ error: `idx must be an integer 0..${C4_PRESET_COUNT - 1}` });

    const body = Buffer.from(p.readSlotBody(rawIdx));
    const overrides = (req.body && req.body.overrides) || {};
    for (const key of Object.keys(overrides)) {
      const index = parseInt(key, 10);
      const value = parseInt(overrides[key], 10);
      if (!Number.isInteger(index) || index < 0 || index >= C4_DATA_SIZE)
        return res.status(400).json({ error: `overrides key ${key} not a valid body byte` });
      if (!Number.isInteger(value) || value < 0 || value > 255)
        return res.status(400).json({ error: `overrides[${key}] must be 0..255` });
      body[index] = value;
    }

    const name = req.body && typeof req.body.name === 'string' ? req.body.name : cleanName(p.readSlotName(rawIdx).toString('ascii'));
    const written = p.commitRawPreset(rawIdx, body, name);
    c4UiLog.stamp('SAVE', `preset=${rawIdx} name="${name}" bytes=${Object.keys(overrides).length}`);
    res.json({ ok: true, presetIndex: rawIdx, page: (C4_PRESET_BASE + rawIdx * C4_PRESET_PITCH).toString(16), name, readback: Array.from(written) });
  } catch (e) {
    collectErrors(res, e);
  }
});

// EEPROM live map + MIDI map for the Inspect-lite view.
function eepromPayload(p) {
  const eeprom = p.getEEPROM();
  const midiMap = decodeMidiMapFromEeprom(eeprom);
  const bound = [];
  for (let cc = 0; cc < midiMap.ccToControl.length; cc++) {
    const ctrl = midiMap.ccToControl[cc];
    if (ctrl !== 0xff) bound.push({ cc, ctrl, name: liveName(ctrl) });
  }
  return {
    hex: Buffer.from(eeprom).toString('hex'),
    midiMap,
    midiMapRegion: { start: 0x80, len: 128, hex: Buffer.from(eeprom.slice(0x80, 0x100)).toString('hex') },
    bound,
    boundCount: bound.length
  };
}

app.get('/api/eeprom', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    res.json({ ok: true, ...eepromPayload(p) });
  } catch (e) {
    collectErrors(res, e);
  }
});

app.get('/api/midimap', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio C4 Synth HID device not found' });
  try {
    const m = eepromPayload(p);
    res.json({ ok: true, ccToControl: m.midiMap.ccToControl, controlToCc: m.midiMap.controlToCc, bound: m.bound, boundCount: m.boundCount });
  } catch (e) {
    collectErrors(res, e);
  }
});

// UI activity log. The workbench posts every user action here so the file
// reflects everything happening in the UI. The frontend resets the file on each
// fresh web session (page load) via /api/log/reset; the backend also resets on
// boot so a file always covers one continuous session.
app.post('/api/log', (req, res) => {
  const lines = Array.isArray(req.body && req.body.lines)
    ? req.body.lines.filter((l) => typeof l === 'string' && l.length > 0)
    : typeof req.body && typeof req.body.line === 'string' && req.body.line.length > 0
      ? [req.body.line]
      : [];
  if (!lines.length) return res.status(400).json({ error: 'line must be a non-empty string (or lines[])' });
  for (const l of lines) {
    if (l.length <= 1000) c4UiLog.append(l);
  }
  res.json({ ok: true, count: lines.length });
});

app.post('/api/log/reset', (req, res) => {
  c4UiLog.reset();
  res.json({ ok: true, file: c4UiLog.logFile });
});

app.listen(PORT, () => {
  c4UiLog.reset();
  console.log('C4 Synth workbench: http://localhost:' + PORT);
  console.log('C4 UI/operation log: ' + c4UiLog.logFile);
});