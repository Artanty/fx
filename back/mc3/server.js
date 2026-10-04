const express = require('express');
const { build, summary, C4_CHANNEL } = require('./src/mc3Data');

const PORT = process.env.PORT || 3223;

let cache = null;

function get() {
  if (!cache) cache = build();
  return cache;
}

const app = express();

app.get('/api/summary', (req, res) => {
  const m = get();
  res.json({ ...m.device, ...m.settings, ...summary(m) });
});

app.get('/api/channels', (req, res) => {
  const m = get();
  res.json({ channels: m.channels, c4Channel: m.c4Channel });
});

app.get('/api/c4-presets', (req, res) => {
  res.json(get().c4Presets);
});

app.get('/api/banks', (req, res) => {
  const m = get();
  res.json({ c4Channel: m.c4Channel, banks: m.banks });
});

app.get('/api/banks/:bank', (req, res) => {
  const n = Number(req.params.bank);
  const bank = get().banks.find((b) => b.bankNumber === n);
  if (!bank) return res.status(404).json({ error: 'no such bank', bank: n });
  res.json(bank);
});

app.get('/api/preset/:bank/:preset', (req, res) => {
  const bankNo = Number(req.params.bank);
  const presetNo = Number(req.params.preset);
  const bank = get().banks.find((b) => b.bankNumber === bankNo);
  if (!bank) return res.status(404).json({ error: 'no such bank', bank: bankNo });
  const preset = [...bank.presets, ...bank.expPresets].find((p) => p.presetNum === presetNo);
  if (!preset) return res.status(404).json({ error: 'no such preset', bank: bankNo, preset: presetNo });
  res.json({ bank: bank.bankNumber, bankName: bank.bankName, ...preset });
});

app.get('/api/reload', (req, res) => {
  cache = null;
  try {
    res.json(get().files);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`mc3 inspector on http://localhost:${PORT}  (C4 = MIDI channel ${C4_CHANNEL})`);
  try {
    const s = summary(get());
    console.log(`  banks: ${s.bankCount}, source: input/${s.files.mc3Backup}`);
    console.log(`  c4 presets: input/${s.files.c4Backup || '(none found)'}`);
  } catch (err) {
    console.error(`  load failed: ${err.message}`);
  }
});

module.exports = app;
