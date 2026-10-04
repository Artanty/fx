// Morningstar MC3 "all banks" backup -> plain JS model.
//
// Source of truth: input/Morningstar_MC3_All_Banks_Backup_20260731_181909.json
// (schemaVersion 1, dumpType 'allBanks', deviceModel 5). The dump carries
// 30 banks x (6 presets + 1 exp preset + 16 bank messages); the MC3 hardware
// allows more banks, so nothing here is hardcoded to 30.
//
// Layout notes that matter downstream:
//   data.bankArray[i].bankNumber        0-based, but not guaranteed sorted
//   data.bankArray[i].presetArray[j]    presetNum is the 0-based slot in bank
//   data.bankArray[i].expPresetArray    single expression (momentary) preset
//   data.controller_settings.data       midi_channels / controller_settings / ...

const fs = require('fs');
const { decodeMessage, c4Recall, isEmptySlot } = require('./mc3Model');

const EMPTY_NAME = 'EMPTY';

function pickArray(section) {
  if (Array.isArray(section)) return section;
  if (section && Array.isArray(section.data)) return section.data;
  return [];
}

function decodeTable(msgArray, channelName) {
  return (msgArray || [])
    .map((m, i) => decodeMessage({ ...m, m: i }, channelName))
    .filter((m) => !isEmptySlot(m));
}

function decodeSlot(slot, channelNames) {
  const messages = [];
  (slot.msgArray || []).forEach((m, i) => {
    if (isEmptySlot(m)) return;
    messages.push(decodeMessage({ ...m, m: i }, channelNames[m.c] || ''));
  });

  const byChannel = {};
  const c4Presets = [];
  for (const m of messages) {
    const key = m.channel;
    byChannel[key] = byChannel[key] || {
      channel: key,
      channelName: m.channelName,
      messages: [],
    };
    byChannel[key].messages.push(m);

    if (key !== C4_CHANNEL) continue;
    const recall = c4Recall(m);
    if (!recall) continue;
    c4Presets.push({
      preset: recall.preset,
      via: recall.via,
      note: recall.note == null ? null : recall.note,
      toggleGroup: m.toggleGroup,
      action: m.action,
      slot: m.slot,
    });
  }

  return {
    name: slot.shortName || '',
    toggleName: slot.toggleName || '',
    longName: slot.longName || '',
    toToggle: !!slot.toToggle,
    toBlink: !!slot.toBlink,
    toMsgScroll: !!slot.toMsgScroll,
    toggleGroup: slot.toggleGroup,
    empty: (slot.shortName || '') === EMPTY_NAME,
    messages,
    channels: Object.values(byChannel).sort((a, b) => a.channel - b.channel),
    c4Presets,
  };
}

// The C4 lives on MC3 MIDI channel slot 2 in this rig (the channel is literally
// named "C4"). Its `remap` value is carried through as metadata only.
const C4_CHANNEL = 2;

function parseBackup(json) {
  const data = (json && json.data) || {};
  const settings = (data.controller_settings && data.controller_settings.data) || {};

  const channelList = pickArray(settings.midi_channels).map((entry) => {
    const d = entry.data || entry;
    return {
      name: d.name || '',
      channel: d.channel,
      sendToPort: d.sendToPort,
      remap: d.remap,
      isMidiChannelOffset: !!d.isMidiChannelOffset,
      engageEnabled: !!d.engageEnabled,
      bypassEnabled: !!d.bypassEnabled,
    };
  });
  const channelNames = {};
  for (const ch of channelList) channelNames[ch.channel] = ch.name;

  const banks = (data.bankArray || [])
    .map((bank) => {
      const presets = (bank.presetArray || []).map((p) => ({
        kind: 'preset',
        presetNum: p.presetNum,
        ...decodeSlot(p, channelNames),
      }));
      const expPresets = (bank.expPresetArray || []).map((p) => ({
        kind: 'exp',
        presetNum: p.presetNum,
        ...decodeSlot(p, channelNames),
      }));
      return {
        bankNumber: bank.bankNumber,
        bankName: bank.bankName || '',
        bankClearToggle: bank.bankClearToggle,
        presets,
        expPresets,
        bankMessages: decodeTable(bank.bankMsgArray, ''),
      };
    })
    .sort((a, b) => a.bankNumber - b.bankNumber);

  const c4Channel = channelList.find((c) => c.channel === C4_CHANNEL) || null;

  return {
    device: {
      schemaVersion: json.schemaVersion,
      dumpType: json.dumpType,
      deviceModel: json.deviceModel,
      description: json.description || '',
      downloadDate: json.downloadDate || '',
      hash: json.hash,
    },
    settings: settings.controller_settings
      ? settings.controller_settings.data || settings.controller_settings
      : {},
    channels: channelList,
    c4Channel: {
      channel: C4_CHANNEL,
      name: c4Channel ? c4Channel.name : '',
      remap: c4Channel ? c4Channel.remap : null,
      presetCc: 104,
    },
    banks,
  };
}

function loadBackup(path) {
  return parseBackup(JSON.parse(fs.readFileSync(path, 'utf8')));
}

function countPresets(banks) {
  let all = 0;
  let named = 0;
  for (const bank of banks) {
    for (const p of bank.presets) {
      all += 1;
      if (!p.empty) named += 1;
    }
  }
  return { all, named };
}

module.exports = { parseBackup, loadBackup, countPresets, C4_CHANNEL, EMPTY_NAME };
