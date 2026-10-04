// Assembles the read-only model the HTTP layer serves: MC3 banks/presets from
// the all-banks backup, with every CC104 recall on the C4 channel annotated
// with the C4 preset name taken from the .osbf dump next to it.

const fs = require('fs');
const path = require('path');
const { loadBackup, countPresets, C4_CHANNEL } = require('./mc3Backup');
const { loadOsbf, presetNameMap } = require('./c4Presets');

const ROOT = path.resolve(__dirname, '..', '..', '..');
const DEFAULT_INPUT = path.join(ROOT, 'input');

const MC3_BACKUP_RE = /^Morningstar_MC3_.*\.json$/i;
const C4_BACKUP_RE = /^.*c4backup\.osbf$/i;

function pickFile(inputDir, re) {
  const files = fs.existsSync(inputDir)
    ? fs.readdirSync(inputDir).filter((f) => re.test(f)).sort()
    : [];
  if (!files.length) return null;
  return path.join(inputDir, files[files.length - 1]);
}

function build(inputDir = process.env.MC3_INPUT || DEFAULT_INPUT) {
  const mc3File = pickFile(inputDir, MC3_BACKUP_RE);
  if (!mc3File) throw new Error(`no Morningstar_MC3_*.json backup in ${inputDir}`);

  const c4File = pickFile(inputDir, C4_BACKUP_RE);
  const c4 = c4File ? loadOsbf(c4File) : { productId: null, presets: [] };
  const c4Names = presetNameMap(c4);

  const model = loadBackup(mc3File);
  const decorate = (p) => ({
    ...p,
    c4Presets: p.c4Presets.map((r) => ({ ...r, name: c4Names[r.preset] || '' })),
  });

  const banks = model.banks.map((bank) => ({
    ...bank,
    presets: bank.presets.map(decorate),
    expPresets: bank.expPresets.map(decorate),
  }));

  return {
    files: {
      mc3Backup: path.basename(mc3File),
      c4Backup: c4File ? path.basename(c4File) : null,
    },
    ...model,
    banks,
    c4Presets: {
      productId: c4.productId,
      stored: c4.presets.length,
      presets: c4.presets,
    },
  };
}

function summary(model) {
  const counts = countPresets(model.banks);
  const used = new Set();
  let recalls = 0;
  for (const bank of model.banks) {
    for (const p of [...bank.presets, ...bank.expPresets]) {
      for (const r of p.c4Presets) {
        used.add(r.preset);
        recalls += 1;
      }
    }
  }
  return {
    files: model.files,
    c4Channel: model.c4Channel,
    bankCount: model.banks.length,
    presetCount: counts.all,
    namedPresetCount: counts.named,
    c4RecallCount: recalls,
    c4PresetsUsed: [...used].sort((a, b) => a - b),
  };
}

module.exports = { build, summary, pickFile, C4_CHANNEL, DEFAULT_INPUT };
