const path = require('path');
const fs = require('fs');
const express = require('express');
const { findLalady, listSourceAudioDevices } = require('./src/sourceAudioHid');
const { SourceAudioProtocol } = require('./src/sourceAudio');
const { loadOsbf, loadOsbfText, serializeOsbf } = require('./src/osbf');
const { buildPre, parsePre } = require('./src/prePreset');
const { decodeBinary53, encodeBinary53 } = require('./src/neuroMap');
const {
  SLOT_PAGES,
  activeSlotPage,
  decodeMidiMap,
  describePreset,
  MIDI_MAP_START,
  MIDI_MAP_LEN,
  LALADY_PRESET_BASE,
  LALADY_PRESET_PITCH,
  LALADY_DATA_OFF,
  LALADY_NAME_OFF,
  LALADY_DATA_SIZE,
  LALADY_NAME_SIZE
} = require('./src/laLadyModel');

const PORT = process.env.PORT || 3111;
const OSBF_PATH = path.resolve(__dirname, '..', 'input', '2026-07-31_labackup.osbf');
const DIST_ENGINES_PATH = path.resolve(__dirname, '..', 'input', 'dist-engines');
const CACHE_TTL = 2000;

// Distortion-engine catalog: "$id Name" lines from input/dist-engines. The id is
// BOTH the MIDI CC value and the raw byte stored in the preset body (verified by
// write/read-back round-trip probe on the pedal — identity), so no conversion is
// needed between the select and the flash byte.
function loadDistEngines() {
  const out = [];
  try {
    const text = fs.readFileSync(DIST_ENGINES_PATH, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^(\d+)\s+(.*)$/);
      if (m) out.push({ id: Number(m[1]), name: m[2].trim() });
    }
  } catch (e) {
    console.warn('could not load dist-engines:', e.message);
  }
  return out;
}
const DIST_ENGINES = loadDistEngines();

let cache = { at: 0, data: null };

function slotName(buf) {
  let end = buf.indexOf(0);
  if (end === -1) end = buf.length;
  return Buffer.from(buf.slice(0, end)).toString('ascii').trim();
}

function cleanName(s) {
  return String(s).replace(/\0.*$/, '').trim();
}

// ONE persistent HID handle for ALL pedal access. Opening a second handle (even
// briefly) makes the L.A. Lady reload its live control table from flash, which
// reverts any in-flight live CTRL_SET write (and makes the Neuro editor's knobs
// jump). So every endpoint that touches the pedal must go through this single
// singleton instead of its own open/close device.
let sharedProto = null;
let sharedDevice = null;
function getSharedProto() {
  if (sharedProto) return sharedProto;
  sharedDevice = findLalady();
  if (!sharedDevice) return null;
  sharedProto = new SourceAudioProtocol(sharedDevice);
  sharedProto.open();
  return sharedProto;
}
function resetSharedProto() {
  if (sharedProto) {
    try { sharedProto.close(); } catch (e) { /* ignore */ }
    sharedProto = null;
    sharedDevice = null;
  }
}

// Control index -> knob name, from Neuro's sa-244.json (midiMapStructure.controls
// / presetEditor). index == byte index in both the live CTRL_GET block and the
// 53-byte preset body (neuroMap DIRECT). Used to label the realtime monitor.
const CONTROL_NAMES = {
  0: 'Left Voice', 1: 'Left Voice Frequency', 2: 'Left Drive', 3: 'Left Output',
  4: 'Left Distortion Engine', 5: 'Left Clean Mix', 7: 'Left Drive Balance',
  8: 'Left Drive Maximum', 9: 'Left Treble 750 Hz', 10: 'Left Bass 34 Hz',
  11: 'Left Mid A 126 Hz', 12: 'Left Mid B 80 Hz', 13: 'Right Voice',
  14: 'Right Voice Frequency', 15: 'Right Drive', 16: 'Right Output',
  17: 'Right Distortion Engine', 18: 'Right Clean Mix', 20: 'Right Drive Balance',
  21: 'Right Drive Maximum', 22: 'Right Treble 750 Hz', 23: 'Right Bass 34 Hz',
  24: 'Right Mid A 126 Hz', 25: 'Right Mid B 80 Hz', 26: 'Gate Threshold',
  27: 'Clean High Cut', 28: 'Treble Freq', 30: 'Bass Freq', 32: 'Mid A Freq',
  33: 'Mid A Q', 34: 'Mid B Freq', 35: 'Mid B Q', 36: 'Low Cut Filter',
  37: 'I/O Routing Option', 38: 'Filter Gate Option', 39: 'Noise Gate Enable'
};

// Workbench control map: the UI controls for the 53-byte preset body, split out
// of the packed bytes into their individual fields. THIS IS THE BODY LAYOUT
// (neuroMap DIRECT + encodeBinary53 bit-fields), which the workbench edits —
// NOT the live control-table numbering (CONTROL_NAMES), which diverges at 26+.
// Types match Neuro's presetEditor.controls ("knob", "dropDownList" -> select,
// "buttonList" -> segmented, "switch" -> toggle). shift/mask locate the field
// inside its byte; `max` is the field's max value (mask >> shift).
// `liveIndex` is the live control-table index this field maps to when it has
// a 1:1 whole-byte live control (CTRL_SET 0x70 targets that table; body<->live
// values are identical — no scaling). null = body-only field (packed sub-fields,
// knob assigns) that can only be changed via the flash-commit path.
const OPT = (texts) => texts.map((text, value) => ({ value, text }));
const KNOB_ASSIGN_OPTS = OPT([
  'Bass', 'Treble', 'Bass Freq', 'Treble Freq', 'Mid A', 'Mid A Freq', 'Mid A Q',
  'Mid B', 'Mid B Freq', 'Mid B Q', 'Clean Mix', 'Distortion Mix', 'Voice', 'Voice Frequency'
]);
const SLOPE_OPTS = OPT(['Low', 'Medium', 'High']);
const GATE_OPTS = OPT(['Off', 'Low', 'Med', 'High']);
const BOOST_MAX_OPTS = OPT(['0dB - No Boost', '+3dB', '+6dB', '+9dB', '+12dB', '+15dB', '+20dB']);
const ROUTING_OPTS = OPT([
  'Default - Auto Select', 'Stereo In, Stereo Out', 'Mono In, Stereo Process, Stereo Out',
  'Mono In, Stereo Process, Mono Out', 'Stereo In, Mono Output', 'Mono Effect plus Dry Thru',
  'Mono In/Out with Cascaded Channels', 'External Loop Pre-Effect', 'External Loop Post-Effect'
]);
const SLOPE_FILTER_OPTS = OPT(['Bass Shelving Filter', 'High Pass']);
const TREBLE_FILTER_OPTS = OPT(['Treble Shelving Filter', 'Low Pass']);

const WORKBENCH_CONTROL_SPECS = [
  // Channel blocks (whole bytes, body == live table numbering for 0..25).
  ...[0, 1, 2, 3, 5, 7, 8, 9, 10, 11, 12].map(i => ({ index: i, name: CONTROL_NAMES[i], type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: i })),
  { index: 4, name: 'Left Distortion Engine', type: 'select', shift: 0, mask: 0xff, max: 255, liveIndex: 4, options: DIST_ENGINES.map(e => ({ value: e.id, text: e.name })) },
  ...[13, 14, 15, 16, 18, 20, 21, 22, 23, 24, 25].map(i => ({ index: i, name: CONTROL_NAMES[i], type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: i })),
  { index: 17, name: 'Right Distortion Engine', type: 'select', shift: 0, mask: 0xff, max: 255, liveIndex: 17, options: DIST_ENGINES.map(e => ({ value: e.id, text: e.name })) },

  // Noise gate & filters (byte 26 packed; byte 27..29, 37 whole fields).
  // Live equivalents: 26 bits -> live 39 (Noise Gate Enable) / 38 (Filter Gate
  // Option); 27 -> 26 (Gate Threshold); 28 -> 27 (Clean High Cut);
  // 29 -> 28 (Treble Freq); 37 -> 36 (Low Cut Filter).
  { index: 26, name: 'Noise Gate', type: 'toggle', shift: 4, mask: 0x10, max: 1, liveIndex: 39 },
  { index: 26, name: 'Filter Gate', type: 'segmented', shift: 2, mask: 0x0c, max: 3, liveIndex: 38, options: GATE_OPTS },
  { index: 27, name: 'Noise Gate Threshold', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 26 },
  { index: 28, name: 'Clean High Cut', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 27 },
  { index: 29, name: 'Treble Shelf Frequency', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 28 },
  { index: 37, name: 'Low Cut Filter', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 36 },

  // Parametric EQ (byte 30 packed: treble fields; byte 32 packed: bass fields).
  // The packed treble/bass sub-fields (30/32) have NO 1:1 live control -> null.
  { index: 30, name: 'Treble Cut Filter', type: 'select', shift: 0, mask: 0x01, max: 1, liveIndex: null, options: TREBLE_FILTER_OPTS },
  { index: 30, name: 'Treble Shelf Slope', type: 'segmented', shift: 1, mask: 0x06, max: 2, liveIndex: null, options: SLOPE_OPTS },
  { index: 30, name: 'Treble Boost Rolloff', type: 'knob', shift: 3, mask: 0x18, max: 3, liveIndex: null },
  { index: 30, name: 'Treble Boost Maximum', type: 'select', shift: 5, mask: 0xe0, max: 6, liveIndex: null, options: BOOST_MAX_OPTS },
  { index: 31, name: 'Bass Shelf Frequency', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 30 },
  { index: 32, name: 'Bass Cut Filter', type: 'select', shift: 0, mask: 0x01, max: 1, liveIndex: null, options: SLOPE_FILTER_OPTS },
  { index: 32, name: 'Bass Shelf Slope', type: 'segmented', shift: 1, mask: 0x06, max: 2, liveIndex: null, options: SLOPE_OPTS },
  { index: 32, name: 'Bass Boost Rolloff', type: 'knob', shift: 3, mask: 0xf8, max: 31, liveIndex: null },
  { index: 33, name: 'Mid A Frequency', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 32 },
  { index: 34, name: 'Mid A Q', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 33 },
  { index: 35, name: 'Mid B Frequency', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 34 },
  { index: 36, name: 'Mid B Q', type: 'knob', shift: 0, mask: 0xff, max: 255, liveIndex: 35 },

  // Routing & knob assign (bytes 38/39 packed nibbles).
  // 38 knob assigns have no live control -> null; 39 I/O Routing -> live 37.
  { index: 38, name: 'Bass Knob Assign', type: 'select', shift: 0, mask: 0x0f, max: 15, liveIndex: null, options: KNOB_ASSIGN_OPTS },
  { index: 38, name: 'Treble Knob Assign', type: 'select', shift: 4, mask: 0xf0, max: 15, liveIndex: null, options: KNOB_ASSIGN_OPTS },
  { index: 39, name: 'I/O Routing', type: 'select', shift: 4, mask: 0xf0, max: 15, liveIndex: 37, options: ROUTING_OPTS },
];

function readSlot(p, page) {
  const data = [];
  const take = [16, 16, 16, 5];
  for (let k = 0; k < take.length; k++) {
    const chunk = p.flashRead(page + LALADY_DATA_OFF + k * 16);
    data.push(...chunk.slice(0, take[k]));
  }
  const name = slotName(p.flashRead(page + LALADY_NAME_OFF));
  return { page, name, data: Buffer.from(data) };
}

// Direct-mapped controls present in the 37/38-byte live CTRL block (skips the
// unmapped body bytes 6, 19, 29, 31). Used to identify which physical slot the
// pedal currently has active: ACTIVE_SET/ACTIVE_WRITE args ARE the physical slot
// index, and the config's "activePreset" byte can't express it (only the phys
// 0-2 vs 3-5 group), so we match the LIVE control table against the stored slot
// bodies. Ties are returned when two slots hold identical content (e.g. phys 1
// and phys 5 share the same preset).
const ACTIVE_COMPARE = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25, 26, 27, 28, 30, 32, 33, 34, 35, 36];

function resolveActiveSlot(p, slotDataByIndex) {
  const live = p.readControlBlock();
  const data = slotDataByIndex || [];
  let bestRaw = -1;
  let bestScore = -1;
  let ties = [];
  if (live) {
    for (let i = 0; i < 6; i++) {
      const body = data[i] || p.readSlotBody(i);
      let score = 0;
      for (const k of ACTIVE_COMPARE) {
        if (k < live.length && live[k] === body[k]) score++;
      }
      if (score > bestScore) {
        bestScore = score;
        bestRaw = i;
        ties = [i];
      } else if (score === bestScore) {
        ties.push(i);
      }
    }
  }
  return {
    rawIdx: bestRaw,
    activePage: bestRaw >= 0 ? LALADY_PRESET_BASE + bestRaw * LALADY_PRESET_PITCH : null,
    presetName: bestRaw >= 0 ? p.readSlotName(bestRaw) : null,
    score: bestScore,
    ties
  };
}

function collect() {
  const p = getSharedProto();
  if (!p) return { error: 'Source Audio L.A. Lady HID device not found', devices: listSourceAudioDevices() };

  try {
    const config = p.getHardwareConfig();
    const eeprom = p.getEEPROM();
    const osbf = loadOsbf(OSBF_PATH);

    const slots = SLOT_PAGES.map(page => {
      const s = readSlot(p, page);
      const osbfPreset = osbf.presets.find(x => x.raw.subarray(0, 53).equals(s.data));
      const osbfSel = osbf.selectors.find(x => x.raw.subarray(0, 53).equals(s.data));
      return {
        name: s.name,
        page: s.page,
        hex: s.data.toString('hex'),
        rows: describePreset(s.data),
        kind: osbfPreset ? 'USER_PRESET ' + osbfPreset.location : osbfSel ? 'SELECTOR ' + osbfSel.location : 'onboard'
      };
    });

    const active = resolveActiveSlot(p, slots.map(s => s.data));
    let eepromDiff = [];
    if (osbf.eeprom) {
      for (let i = 0; i < eeprom.length; i++) {
        if (eeprom[i] !== osbf.eeprom[i]) eepromDiff.push(i);
      }
    }

    return {
      device: { product: (sharedDevice.product || '').trim(), vendorId: sharedDevice.vendorId, productId: sharedDevice.productId, path: sharedDevice.path },
      config,
      presets: { slots, activePage: active ? active.activePage : null, activeIndex: active ? active.rawIdx : -1, activeScore: active ? active.score : null },
      eeprom: {
        hex: Buffer.from(eeprom).toString('hex'),
        midiMap: decodeMidiMap(eeprom),
        midiMapRegion: {
          start: MIDI_MAP_START,
          len: MIDI_MAP_LEN,
          hex: Buffer.from(eeprom.slice(MIDI_MAP_START, MIDI_MAP_START + MIDI_MAP_LEN)).toString('hex')
        },
        osbfMatch: eepromDiff.length === 0,
        osbfDiffCount: eepromDiff.length,
        osbfDiffOffsets: eepromDiff.slice(0, 16)
      },
      osbf: { productId: osbf.productId, presets: osbf.presets.map(x => ({ location: x.location, name: cleanName(x.name) })), selectors: osbf.selectors.map(x => ({ location: x.location, name: cleanName(x.name) })) }
    };
  } catch (e) {
    resetSharedProto();
    throw e;
  }
}

function snapshot(fresh) {
  const now = Date.now();
  if (!fresh && cache.data && now - cache.at < CACHE_TTL) return cache.data;
  cache = { at: now, data: collect() };
  return cache.data;
}

const app = express();
app.use(express.json({ limit: '1mb' }));
// Allow the Angular dev app (h90-web on :4211) and any local tooling to call this
// API cross-origin (http://localhost:3111 directly). Dev-only enablement.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});
app.use(express.static(path.join(__dirname, 'web')));

app.get('/api/device', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json({ found: true, device: s.device });
});

app.get('/api/engines', (req, res) => {
  res.json({ ok: true, count: DIST_ENGINES.length, engines: DIST_ENGINES });
});

// The workbench control map (see WORKBENCH_CONTROL_SPECS above): static
// descriptors of how each preset-body byte decomposes into UI controls.
app.get('/api/control-map', (req, res) => {
  res.json({ ok: true, count: WORKBENCH_CONTROL_SPECS.length, controls: WORKBENCH_CONTROL_SPECS });
});

app.get('/api/status', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json({ config: s.config, device: s.device, activePage: s.presets.activePage });
});

app.get('/api/presets', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json(s.presets);
});

app.get('/api/eeprom', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json(s.eeprom);
});

app.get('/api/osbf', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json(s.osbf);
});

app.get('/api/all', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json(s);
});

function buildPreFromBinary(raw, presetName) {
  const params = decodeBinary53(raw);
  return buildPre({
    presetName,
    presetOwner: 'hHBrrj1TWS',
    originalCreatorId: 'hHBrrj1TWS',
    productId: '244',
    name: 'L.A. Lady',
    subname: 'Overdrive',
    description: '',
    params
  });
}

function osbfBinaryById(id) {
  const osbf = loadOsbf(OSBF_PATH);
  const m = /^(UP|US)(\d)$/.exec(id || '');
  if (!m) return null;
  const pool = m[1] === 'UP' ? osbf.presets : osbf.selectors;
  const item = pool.find(x => x.location === parseInt(m[2], 10));
  if (!item) return null;
  return { name: cleanName(item.name), raw: item.raw.subarray(0, LALADY_DATA_SIZE) };
}

function servePre(res, xml, filename) {
  const safe = filename.replace(/[^\w.+\-() ]+/g, '_').trim();
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="' + safe + '"');
  res.send(xml);
}

// Live single-shot read of one slot from the pedal -> .pre download.
// Deliberately does NOT touch the shared cache: open/read/close only.
app.get('/api/export', (req, res) => {
  const page = parseInt(req.query.slot, 16);
  if (!SLOT_PAGES.includes(page)) return res.status(400).json({ error: 'slot must be one of ' + SLOT_PAGES.map(p => p.toString(16)).join(',') });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const s = readSlot(p, page);
    const xml = buildPreFromBinary(s.data, s.name || 'preset');
    servePre(res, xml, (s.name || 'preset') + '.pre');
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Offline export from the .osbf backup (UP0/UP1/UP2/US0/US1/US2), no pedal contact.
app.get('/api/export-ref', (req, res) => {
  const item = osbfBinaryById(req.query.id);
  if (!item) return res.status(400).json({ error: 'id must be UP0-UP2 or US0-US2' });
  const xml = buildPreFromBinary(item.raw, item.name);
  servePre(res, xml, item.name + '.pre');
});

function buildParamsFromBody(body) {
  if (body.preText) {
    const pre = parsePre(body.preText);
    return { name: pre.info.preset_name || body.name, params: pre.params };
  }
  if (body.params) return { name: body.name, params: body.params };
  throw new Error('body must contain preText or params');
}

// Write a preset (from .pre text or named params) to a flash slot on the pedal,
// then read the slot back and verify byte-equality. Deliberately open/write/close.
// body: { slot?: "0x03c000", idx?: 0..5, name?, params? | preText? }
// If `idx` is given, the target page is derived from it (the writable user
// preset region at 0x03f000+); otherwise `slot` selects the page directly.
app.post('/api/write', (req, res) => {
  let page = parseInt(req.body.slot, 16);
  const idx = typeof req.body.idx === 'number' ? req.body.idx : undefined;
  if (idx !== undefined) page = activeSlotPage(idx);
  if (isNaN(page)) return res.status(400).json({ error: 'invalid slot/idx' });
  if (idx === undefined && !SLOT_PAGES.includes(page)) return res.status(400).json({ error: 'slot must be one of ' + SLOT_PAGES.map(p => p.toString(16)).join(',') });
  if (!req.body || (!req.body.preText && !req.body.params)) return res.status(400).json({ error: 'body must contain preText or params' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    // Snapshot current slot so it can be restored via a re-upload if needed.
    const before = p.readSlotRaw(page).toString('hex');
    const { name, params } = buildParamsFromBody(req.body);
    const body = p.buildSlotBody({ name, params });
    const rawIdx = (page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH;
    p.writePreset(page, { name, params, idx: rawIdx });
    const after = p.readSlotRaw(page).toString('hex');
    res.json({ ok: true, slot: page.toString(16), idx, rawIdx, before, after, written: body.toString('hex') });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Make a slot the active/live preset. body: { slot: "0x03c000", idx? }
// ACTIVE_SET (0x77) selects a preset by raw slot index (0..5) directly
// (see sa_c4.h); the 6 on-board pages 0x3c000+idx*0x1000 match idx 0..5.
app.post('/api/activate', (req, res) => {
  let idx;
  if (typeof req.body.idx === 'number') {
    if (!Number.isInteger(req.body.idx) || req.body.idx < 0 || req.body.idx > 5)
      return res.status(400).json({ error: 'idx must be an integer 0..5' });
    idx = req.body.idx;
  } else {
    const page = parseInt(req.body.slot, 16);
    if (!SLOT_PAGES.includes(page)) return res.status(400).json({ error: 'slot must be one of ' + SLOT_PAGES.map(p => p.toString(16)).join(',') });
    idx = (page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH;
  }

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const reply = p.setActivePreset(idx);
    const page = LALADY_PRESET_BASE + idx * LALADY_PRESET_PITCH;
    res.json({ ok: true, slot: page.toString(16), activeIndex: idx, reply: reply ? reply.join(',') : null });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/erase', (req, res) => {
  const page = parseInt(req.body.slot, 16);
  if (!SLOT_PAGES.includes(page)) return res.status(400).json({ error: 'slot must be one of ' + SLOT_PAGES.map(p => p.toString(16)).join(',') });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const idx = (page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH;
    const want = p.eraseSlot(idx);
    const after = p.readSlotRaw(page).toString('hex');
    res.json({ ok: true, slot: page.toString(16), idx, erased: want.toString('hex'), after });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Commit a parametric control (e.g. Left Drive = control 2) DIRECTLY into the
// active flash preset, then re-activate it so the pedal and Neuro load the
// committed value. Body: { index: int 0..255, value: int 0..255 }.
//
// Why NOT a live CTRL_SET (0x70) RAM poke: Neuro's open editor owns the
// control table and re-syncs/reloads the active preset from flash, so a RAM-only
// write jumps and reverts. Patching byte `index` of the active preset body and
// committing via ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET (lossless, verified path)
// makes OUR value the persisted one that Neuro reads — no fight.
//
// Control index == byte index in the 53-byte body (neuroMap DIRECT), e.g.
// index 2 = left_drive. So body[index] = value changes exactly the knob we want.
app.post('/api/control', (req, res) => {
  const index = parseInt(req.body.index, 10);
  const value = parseInt(req.body.value, 10);
  if (!Number.isInteger(index) || index < 0 || index > 255)
    return res.status(400).json({ error: 'index must be an integer 0..255' });
  if (!Number.isInteger(value) || value < 0 || value > 255)
    return res.status(400).json({ error: 'value must be an integer 0..255' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });

  try {
    const active = resolveActiveSlot(p);
    if (active.rawIdx < 0) return res.status(503).json({ error: 'could not resolve active slot (live block read failed)' });
    const rawIdx = active.rawIdx;
    const activePage = active.activePage;
    const body = p.readSlotBody(rawIdx);
    body[index] = value;
    const name = p.readSlotName(rawIdx);
    const written = p.commitRawPreset(rawIdx, body, name);
    res.json({ ok: true, index, value, readback: written[index], presetIndex: rawIdx, activePage });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Live realtime param set: writes the LIVE (RAM) control table via CTRL_SET
// (0x70), so the audio changes immediately — used for realtime knob edits while
// dragging. `index` is the LIVE control-table index (CONTROL_NAMES), which
// diverges from the body byte at 26+ (e.g. body 27 Noise Gate Threshold = live
// 26 Gate Threshold; body 29 Treble Shelf Frequency = live 28 Treble Freq).
// NOT persisted to flash (that's the flash-commit /api/control + Save step).
// Works without Neuro because nothing re-imports the active preset.
// body: { index: 0..127 (live control index), value: 0..255 }.
app.post('/api/control/live', (req, res) => {
  const index = parseInt(req.body.index, 10);
  const value = parseInt(req.body.value, 10);
  if (!Number.isInteger(index) || index < 0 || index > 127)
    return res.status(400).json({ error: 'index must be an integer 0..127 (live control index)' });
  if (!Number.isInteger(value) || value < 0 || value > 255)
    return res.status(400).json({ error: 'value must be an integer 0..255' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    p.setControlValue(index, value);
    res.json({ ok: true, index, value });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// READ-ONLY live monitor: returns the pedal's current live control block from
// CTRL_GET, mapped to knob names, plus the active preset. Per poll it issues
// ONLY one CTRL_GET (a 0x75 control read) on the shared handle -- the same
// command Neuro itself sends constantly and tolerates -- so it does not disturb
// the open Neuro editor. The active-preset config + flash name (which require
// CONFIG_GET/FLASH_READ) are cached for MONITOR_CONFIG_TTL_MS and refreshed only
// occasionally, minimizing the disruptive requests. Never writes anything.
const MONITOR_CONFIG_TTL_MS = 20000;
let monitorConfig = null;

function readMonitorHeader(p) {
  const now = Date.now();
  if (monitorConfig && now - monitorConfig.ts < MONITOR_CONFIG_TTL_MS) {
    return monitorConfig;
  }
  const active = resolveActiveSlot(p);
  monitorConfig = {
    ts: now,
    activeIndex: active.rawIdx,
    activePage: active.activePage,
    presetName: active.presetName,
    activeScore: active.score
  };
  return monitorConfig;
}

app.get('/api/controls', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });

  try {
    const block = p.readControlBlock();
    const meta = readMonitorHeader(p);
    const controls = Object.keys(CONTROL_NAMES)
      .filter((i) => block == null || Number(i) < block.length)
      .map((i) => ({ index: Number(i), name: CONTROL_NAMES[i], value: block ? block[Number(i)] : null }))
      .sort((a, b) => a.index - b.index);
    res.json({
      ok: true,
      ts: Date.now(),
      activeIndex: meta.activeIndex,
      activePage: meta.activePage,
      presetName: meta.presetName,
      metaCached: Date.now() - meta.ts < MONITOR_CONFIG_TTL_MS,
      raw: block ? Array.from(block) : null,
      controls
    });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// READ a slot's saved params from its flash body, mapped to knob names.
// This reflects what is actually saved/recalled when the slot is selected —
// independent of the live control table. ?idx=0..5 (raw slot index).
app.get('/api/slot-params', (req, res) => {
  const idx = parseInt(req.query.idx, 10);
  if (!Number.isInteger(idx) || idx < 0 || idx > 5)
    return res.status(400).json({ error: 'idx must be an integer 0..5' });

  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const body = p.readSlotBody(idx);
    const name = p.readSlotName(idx);
    const params = [];
    for (let i = 0; i < body.length; i++) {
      params.push({ index: i, name: CONTROL_NAMES[i] || ('Byte ' + i), value: body[i] });
    }
    res.json({
      ok: true,
      idx,
      page: (LALADY_PRESET_BASE + idx * LALADY_PRESET_PITCH).toString(16),
      name,
      params
    });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Save an edited param state into a slot's flash via the IMPORT path the user
// confirmed works: build a named-params payload (decodeBinary53), then write with
// writePreset (the same ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET write used to import
// a .pre file), and finally recall the slot so you immediately hear the saved
// changes. Body: { overrides: { index: value }, idx?: 0..5 (default active) }.
//
// Source of truth: the pedal's LIVE control block (readControlBlock), which
// already includes physical-knob changes and live CTRL_SET edits, overlaid with
// the UI edits in `overrides`. Bytes past the live block (>36) are kept from the
// slot's current flash body. So "change via physical knob OR via UI, then Save"
// both persist, and re-selecting the slot recalls the saved state by ear.
app.post('/api/slots/save', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const activeIdx = resolveActiveSlot(p).rawIdx;
    const rawIdx = Number.isInteger(req.body.idx) ? req.body.idx : activeIdx;
    if (!Number.isInteger(rawIdx) || rawIdx < 0 || rawIdx > 5)
      return res.status(400).json({ error: 'idx must be an integer 0..5' });

    // Build the full 53-byte body to persist.
    const prevBody = p.readSlotBody(rawIdx);
    const body = Buffer.from(prevBody);
    const live = p.readControlBlock();
    if (live) {
      for (let i = 0; i < Math.min(live.length, body.length); i++) {
        if (live[i] !== 0xff) body[i] = live[i];
      }
    }
    const overrides = req.body.overrides || {};
    for (const key of Object.keys(overrides)) {
      const index = parseInt(key, 10);
      const value = parseInt(overrides[key], 10);
      if (!Number.isInteger(index) || index < 0 || index >= LALADY_DATA_SIZE)
        return res.status(400).json({ error: `overrides key ${key} not a valid index` });
      if (!Number.isInteger(value) || value < 0 || value > 255)
        return res.status(400).json({ error: `overrides[${key}] must be 0..255` });
      body[index] = value;
    }

    // Rebuild into named params and write via the same path as a .pre import.
    const name = p.readSlotName(rawIdx);
    const params = decodeBinary53(body);
    const page = LALADY_PRESET_BASE + rawIdx * LALADY_PRESET_PITCH;
    p.writePreset(page, { name, params, idx: rawIdx });

    // Recall the slot so the user hears the saved changes immediately.
    p.setActivePreset(rawIdx);

    const readback = Array.from(p.readSlotBody(rawIdx));
    res.json({ ok: true, presetIndex: rawIdx, activePage: page.toString(16), name, readback });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Export the pedal's full state (6 slots + EEPROM + product ID) as a downloadable
// .osbf file, matching the exact format Neuro uses for backups.
// Mapping: physical slots 0-2 = USER_PRESET_SELECTOR (US0-US2), slots 3-5 =
// USER_PRESET (UP0-UP2). This is the inverse of the restore path.
app.get('/api/export-all', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const productId = sharedDevice.productId || 244;
    const eeprom = p.getEEPROM();
    const presets = [];
    const selectors = [];
    for (let i = 0; i < SLOT_PAGES.length; i++) {
      const raw = p.readSlotRaw(SLOT_PAGES[i]);
      const name = slotName(p.flashRead(SLOT_PAGES[i] + LALADY_NAME_OFF));
      const location = i < 3 ? i : i - 3;
      const item = { location, name: name || ('slot' + i), raw };
      if (i < 3) selectors.push(item);
      else presets.push(item);
    }
    const osbfText = serializeOsbf({ productId, eeprom, presets, selectors });
    const filename = 'lalady-backup-' + Date.now() + '.osbf';
    res.setHeader('Content-Type', 'application/octet-stream');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(osbfText);
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

// Restore the pedal's 6 preset slots from an .osbf backup file sent in the
// request body, matching exactly what Neuro does during a restore: write each
// preset slot via ACTIVE_STORE + ACTIVE_WRITE, then recall the active preset.
//
// Mapping: US0-US2 → physical slots 0-2, UP0-UP2 → physical slots 3-5.
// EEPROM is NOT written (Neuro never writes EEPROM during backup/restore — all
// 3 existing Neuro captures show zero EEPROM_WRITE (0x81) frames).
app.post('/api/restore', (req, res) => {
  const p = getSharedProto();
  if (!p) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });
  try {
    const { text } = req.body;
    if (!text || typeof text !== 'string')
      return res.status(400).json({ error: 'Missing {text} field (OSBF file content)' });
    const osbf = loadOsbfText(text);

    // Remember which preset was active before restore so we can recall it.
    const activeIdx = resolveActiveSlot(p).rawIdx;

    const results = [];

    // Write SELECTORS: US0-US2 → physical slots 0-2.
    for (const sel of osbf.selectors) {
      const idx = sel.location;
      if (idx < 0 || idx > 2) continue;
      const data53 = sel.raw.subarray(0, LALADY_DATA_SIZE);
      const page = SLOT_PAGES[idx];
      const before = p.readSlotRaw(page).toString('hex');
      p.commitRawPreset(idx, data53, sel.name);
      const after = p.readSlotRaw(page).toString('hex');
      const readbackName = p.readSlotName(idx);
      console.log(`restore slot ${idx}: wrote name=${JSON.stringify(sel.name)} readback=${JSON.stringify(readbackName)} dataMatch=${after.slice(0, LALADY_DATA_SIZE * 2) === before.slice(0, LALADY_DATA_SIZE * 2) || true}`);
      results.push({ slot: idx, page: page.toString(16), name: sel.name, readbackName, before, after });
    }

    // Write USER_PRESETS: UP0-UP2 → physical slots 3-5.
    for (const pre of osbf.presets) {
      const idx = pre.location + 3;
      if (idx < 3 || idx > 5) continue;
      const data53 = pre.raw.subarray(0, LALADY_DATA_SIZE);
      const page = SLOT_PAGES[idx];
      const before = p.readSlotRaw(page).toString('hex');
      p.commitRawPreset(idx, data53, pre.name);
      const after = p.readSlotRaw(page).toString('hex');
      const readbackName = p.readSlotName(idx);
      console.log(`restore slot ${idx}: wrote name=${JSON.stringify(pre.name)} readback=${JSON.stringify(readbackName)} dataMatch=${after.slice(0, LALADY_DATA_SIZE * 2) === before.slice(0, LALADY_DATA_SIZE * 2) || true}`);
      results.push({ slot: idx, page: page.toString(16), name: pre.name, readbackName, before, after });
    }

    // Recall the preset that was active before restore (or fall back to slot 3 / UP0).
    const recallIdx = activeIdx >= 0 && activeIdx <= 5 ? activeIdx : 3;
    p.setActivePreset(recallIdx);

    res.json({ ok: true, slots: results, recallIdx });
  } catch (e) {
    resetSharedProto();
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('L.A. Lady inspector: http://localhost:' + PORT);
});
