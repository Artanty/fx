const path = require('path');
const express = require('express');
const { findLalady, listSourceAudioDevices } = require('./src/sourceAudioHid');
const { SourceAudioProtocol } = require('./src/sourceAudio');
const { loadOsbf } = require('./src/osbf');
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
  LALADY_DATA_SIZE
} = require('./src/laLadyModel');

const PORT = process.env.PORT || 3111;
const OSBF_PATH = path.resolve(__dirname, '..', 'input', '2026-07-31_labackup.osbf');
const CACHE_TTL = 2000;

let cache = { at: 0, data: null };

function slotName(buf) {
  let end = buf.indexOf(0);
  if (end === -1) end = buf.length;
  return Buffer.from(buf.slice(0, end)).toString('ascii').trim();
}

function cleanName(s) {
  return String(s).replace(/\0.*$/, '').trim();
}

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

function collect() {
  const dev = findLalady();
  if (!dev) return { error: 'Source Audio L.A. Lady HID device not found', devices: listSourceAudioDevices() };

  const p = new SourceAudioProtocol(dev);
  p.open();
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

    const activePage = activeSlotPage(config.activePreset);
    let eepromDiff = [];
    if (osbf.eeprom) {
      for (let i = 0; i < eeprom.length; i++) {
        if (eeprom[i] !== osbf.eeprom[i]) eepromDiff.push(i);
      }
    }

    return {
      device: { product: (dev.product || '').trim(), vendorId: dev.vendorId, productId: dev.productId, path: dev.path },
      config,
      presets: { slots, activePage, activeIndex: config.activePreset },
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
  } finally {
    p.close();
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
app.use(express.static(path.join(__dirname, 'web')));

app.get('/api/device', (req, res) => {
  const s = snapshot(req.query.fresh === '1');
  if (s.error) return res.status(503).json(s);
  res.json({ found: true, device: s.device });
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
  const dev = findLalady();
  if (!dev) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });

  const p = new SourceAudioProtocol(dev);
  p.open();
  try {
    const s = readSlot(p, page);
    const xml = buildPreFromBinary(s.data, s.name || 'preset');
    servePre(res, xml, (s.name || 'preset') + '.pre');
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    p.close();
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

  const dev = findLalady();
  if (!dev) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });

  const p = new SourceAudioProtocol(dev);
  p.open();
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
    res.status(500).json({ error: e.message });
  } finally {
    p.close();
  }
});

// Make a slot the active/live preset. body: { slot: "0x03c000", idx? }
// ACTIVE_SET (0x77) selects a preset by raw slot index (0..5) directly
// (see sa_c4.h); the 6 on-board pages 0x3c000+idx*0x1000 match idx 0..5.
app.post('/api/activate', (req, res) => {
  const page = parseInt(req.body.slot, 16);
  if (!SLOT_PAGES.includes(page)) return res.status(400).json({ error: 'slot must be one of ' + SLOT_PAGES.map(p => p.toString(16)).join(',') });

  const dev = findLalady();
  if (!dev) return res.status(503).json({ error: 'Source Audio L.A. Lady HID device not found' });

  const p = new SourceAudioProtocol(dev);
  p.open();
  try {
    const idx = typeof req.body.idx === 'number' ? req.body.idx : (page - LALADY_PRESET_BASE) / LALADY_PRESET_PITCH;
    const reply = p.setActivePreset(idx);
    res.json({ ok: true, slot: page.toString(16), activeIndex: idx, reply: reply ? reply.join(',') : null });
  } catch (e) {
    res.status(500).json({ error: e.message });
  } finally {
    p.close();
  }
});

app.listen(PORT, () => {
  console.log('L.A. Lady inspector: http://localhost:' + PORT);
});
