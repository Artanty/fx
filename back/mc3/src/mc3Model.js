// Decoding rules for the Morningstar MC3 all-banks backup JSON.
//
// Every bank owns three message tables: `bankMsgArray` (16), one `msgArray` per
// preset in `presetArray` (6 x 16) and one per `expPresetArray` entry. All of
// them are 16 slots of the same shape:
//
//   { d1, d2, d3, d4, m, c, t, a, tg, mi }
//
//   m  slot index inside the 16-entry table (matches the array position)
//   c  outgoing MIDI channel (1..16), NOT the MC3 slot position
//   t  message type id
//   a  action / attribute byte
//   tg toggle group (0/1 are the two states of one toggle, 2 = plain message)
//   mi free-text note ("mi" for "midi input") authored by the user
//
// Only three type ids can be named with confidence from the dump itself; the
// rest are passed through as `raw` with their typeId so nothing is invented.

const NOTE_NAMES = [
  'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B',
];

const TYPES = {
  1: 'note',
  2: 'cc',
  3: 'program',
  32: 'notecc',
};

const C4_PRESET_CC = 104;

function noteName(note) {
  if (note == null || note < 0 || note > 127) return String(note);
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

function describe(msg, channelName) {
  const ch = channelName ? ` · ${channelName}` : '';
  switch (msg.t) {
    case 1:
      return `Note ${noteName(msg.d1)} vel ${msg.d2}${ch}`;
    case 2:
      return `CC${msg.d1} = ${msg.d2}${ch}`;
    case 3:
      return `Program ${msg.d1}${ch}`;
    case 32:
      return `Note ${noteName(msg.d1)} + CC${msg.d2} = ${msg.d3}${ch}`;
    default:
      return `type ${msg.t} [${msg.d1}, ${msg.d2}, ${msg.d3}, ${msg.d4}]${ch}`;
  }
}

function decodeMessage(msg, channelName) {
  const type = TYPES[msg.t] || 'raw';
  const out = {
    slot: msg.m,
    type,
    typeId: msg.t,
    channel: msg.c,
    channelName: channelName || '',
    toggleGroup: msg.tg,
    action: msg.a,
    d1: msg.d1,
    d2: msg.d2,
    d3: msg.d3,
    d4: msg.d4,
    note: '',
    text: describe(msg, channelName),
  };
  if (msg.mi) out.note = msg.mi;
  return out;
}

// Which C4 user preset does this message recall, if any? CC104 is the Source
// Audio "load user preset" controller, its value being the 0..127 preset index.
// Takes a *decoded* message (typeId, not t).
//
// `via: 'cc'`       plain CC104 = <preset>            (t=2)
// `via: 'notecc'`   note + CC104 = <preset> bundled   (t=32, d1 is the note)
function c4Recall(msg) {
  if (msg.typeId === 2 && msg.d1 === C4_PRESET_CC) {
    return { preset: msg.d2, via: 'cc' };
  }
  if (msg.typeId === 32 && msg.d2 === C4_PRESET_CC) {
    return { preset: msg.d3, via: 'notecc', note: msg.d1 };
  }
  return null;
}

function isEmptySlot(msg) {
  return msg.t === 0;
}

module.exports = {
  C4_PRESET_CC,
  TYPES,
  decodeMessage,
  c4Recall,
  isEmptySlot,
  noteName,
};
