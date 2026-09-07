// C4 Synth model: flash layout constants + workbench control map.
// Control table extracted verbatim from TeensyC4Synth (MichaelMCE, MIT)
// ctrl_c4.c controls_c4[] as {label, liveIndex, bodyByte, width, shift}.
// The preset body is 128 data bytes at page+0x20, name 32B at page+0xA0,
// 128 user presets at 0x080000 + idx*0x1000.

const C4_PRESET_BASE = 0x080000;
const C4_PRESET_PITCH = 0x1000;
const C4_DATA_OFF = 0x20;
const C4_DATA_SIZE = 0x80;
const C4_NAME_OFF = 0xa0;
const C4_NAME_SIZE = 32;
const C4_PRESET_COUNT = 128;

// [label, liveIndex, bodyByte, width, shift] — verbatim from ctrl_c4.c.
const CTRL_ROWS = [
  // Input / level
  ['input1_gain', 0, 0, 8, 0],
  ['input2_gain', 1, 1, 8, 0],
  ['master_depth', 2, 2, 8, 0],
  ['mod_source', 3, 3, 8, 0],
  ['bass', 4, 4, 8, 0],
  ['treble', 5, 5, 8, 0],
  ['mix', 6, 6, 8, 0],
  ['lo_retain', 7, 7, 8, 0],
  ['output', 8, 8, 8, 0],
  ['output_balance', 9, 9, 8, 0],
  // Voice 1
  ['voice1_level', 10, 10, 8, 0],
  ['voice1_pan', 11, 11, 8, 0],
  ['voice1_detune', 12, 12, 8, 0],
  ['voice1_tremolo', 13, 13, 8, 0],
  ['voice1_octave', 14, 14, 3, 0],
  ['voice1_semitone', 15, 14, 5, 3],
  ['voice1_mode', 16, 15, 2, 0],
  ['voice1_source', 17, 15, 4, 2],
  ['voice1_envelope', 18, 15, 2, 6],
  ['voice1_destination', 19, 16, 2, 0],
  ['voice1_tremolo_source', 20, 16, 1, 1],
  ['voice1_modulate', 21, 16, 1, 2],
  ['voice1_enable', 22, 16, 4, 4],
  // Voice 2
  ['voice2_level', 23, 17, 8, 0],
  ['voice2_pan', 24, 18, 8, 0],
  ['voice2_detune', 25, 19, 8, 0],
  ['voice2_tremolo', 26, 20, 8, 0],
  ['voice2_octave', 27, 21, 3, 0],
  ['voice2_semitone', 28, 21, 5, 3],
  ['voice2_mode', 29, 22, 2, 0],
  ['voice2_source', 30, 22, 4, 2],
  ['voice2_envelope', 31, 22, 2, 6],
  ['voice2_destination', 32, 23, 2, 0],
  ['voice2_tremolo_source', 33, 23, 1, 1],
  ['voice2_modulate', 34, 23, 1, 2],
  ['voice2_enable', 35, 23, 4, 4],
  // Voice 3
  ['voice3_level', 36, 24, 8, 0],
  ['voice3_pan', 37, 25, 8, 0],
  ['voice3_detune', 38, 26, 8, 0],
  ['voice3_tremolo', 39, 27, 8, 0],
  ['voice3_octave', 40, 28, 3, 0],
  ['voice3_semitone', 41, 28, 5, 3],
  ['voice3_mode', 42, 29, 2, 0],
  ['voice3_source', 43, 29, 4, 2],
  ['voice3_envelope', 44, 29, 2, 6],
  ['voice3_destination', 45, 30, 2, 0],
  ['voice3_tremolo_source', 46, 30, 1, 1],
  ['voice3_modulate', 47, 30, 1, 2],
  ['voice3_enable', 48, 30, 4, 4],
  // Voice 4
  ['voice4_level', 49, 31, 8, 0],
  ['voice4_pan', 50, 32, 8, 0],
  ['voice4_detune', 51, 33, 8, 0],
  ['voice4_tremolo', 52, 34, 8, 0],
  ['voice4_octave', 53, 35, 3, 0],
  ['voice4_semitone', 54, 35, 5, 3],
  ['voice4_mode', 55, 36, 2, 0],
  ['voice4_source', 56, 36, 4, 2],
  ['voice4_envelope', 57, 36, 2, 6],
  ['voice4_destination', 58, 37, 2, 0],
  ['voice4_tremolo_source', 59, 37, 1, 1],
  ['voice4_modulate', 60, 37, 1, 2],
  ['voice4_enable', 61, 37, 4, 4],
  // Distortion
  ['distortion_drive', 62, 56, 8, 0],
  ['distortion_mix', 63, 57, 8, 0],
  ['distortion_output', 64, 58, 8, 0],
  ['distortion_type', 65, 59, 4, 0],
  ['distortion_enable', 66, 59, 4, 4],
  // Filter 1 + mix1
  ['filter1_depth', 67, 38, 8, 0],
  ['filter1_frequency', 68, 39, 8, 0],
  ['filter1_q', 69, 40, 8, 0],
  ['filter1_type', 70, 41, 5, 0],
  ['filter1_envelope', 71, 41, 1, 5],
  ['filter1_invert', 72, 41, 1, 6],
  ['filter1_enable', 73, 41, 1, 7],
  ['filter1_pitch_track', 74, 42, 2, 0],
  ['mix1_destination', 75, 42, 2, 2],
  ['mix1_enable', 168, 42, 4, 4],
  // Filter 2 + mix2
  ['filter2_depth', 76, 43, 8, 0],
  ['filter2_frequency', 77, 44, 8, 0],
  ['filter2_q', 78, 45, 8, 0],
  ['filter2_type', 79, 46, 5, 0],
  ['filter2_envelope', 80, 46, 1, 5],
  ['filter2_invert', 81, 46, 1, 6],
  ['filter2_enable', 82, 46, 1, 7],
  ['filter2_pitch_track', 83, 47, 2, 0],
  ['mix2_destination', 84, 47, 2, 2],
  ['mix2_enable', 169, 47, 4, 4],
  // Envelope 1
  ['envelope1_sensitivity', 85, 48, 8, 0],
  ['envelope1_speed', 86, 49, 8, 0],
  ['envelope1_gate', 87, 50, 8, 0],
  ['envelope1_type', 88, 51, 4, 0],
  ['envelope1_input', 89, 51, 4, 4],
  // Envelope 2
  ['envelope2_sensitivity', 90, 52, 8, 0],
  ['envelope2_speed', 91, 53, 8, 0],
  ['envelope2_gate', 92, 54, 8, 0],
  ['envelope2_type', 93, 55, 4, 0],
  ['envelope2_input', 94, 55, 4, 4],
  // FM
  ['fm_sine1', 95, 60, 8, 0],
  ['fm_sine2', 96, 61, 8, 0],
  ['fm_sine1_input', 97, 62, 1, 0],
  ['fm_sine2_input', 98, 62, 7, 1],
  ['mono_pitch_filter1', 99, 63, 8, 0],
  ['mono_pitch_filter2', 100, 64, 8, 0],
  // LFO (lfo_tempo is a set-only 32-bit field at body 71..74 — excluded here)
  ['lfo_speed', 101, 65, 8, 0],
  ['lfo_env_to_speed', 102, 66, 8, 0],
  ['lfo_env_to_depth', 103, 67, 8, 0],
  ['lfo_2_phase', 104, 68, 8, 0],
  ['lfo_2_multiply', 105, 69, 8, 0],
  ['lfo_shape', 106, 70, 4, 0],
  ['lfo_restart', 107, 70, 1, 4],
  ['lfo_beat_division', 108, 70, 3, 5],
  // Sequencer 1
  ['sequencer1_steps', 109, 75, 8, 0],
  ['sequencer1_value0', 110, 76, 8, 0],
  ['sequencer1_value1', 111, 77, 8, 0],
  ['sequencer1_value2', 112, 78, 8, 0],
  ['sequencer1_value3', 113, 79, 8, 0],
  ['sequencer1_value4', 114, 80, 8, 0],
  ['sequencer1_value5', 115, 81, 8, 0],
  ['sequencer1_value6', 116, 82, 8, 0],
  ['sequencer1_value7', 117, 83, 8, 0],
  ['sequencer1_value8', 118, 84, 8, 0],
  ['sequencer1_value9', 119, 85, 8, 0],
  ['sequencer1_value10', 120, 86, 8, 0],
  ['sequencer1_value11', 121, 87, 8, 0],
  ['sequencer1_value12', 122, 88, 8, 0],
  ['sequencer1_value13', 123, 89, 8, 0],
  ['sequencer1_value14', 124, 90, 8, 0],
  ['sequencer1_value15', 125, 91, 8, 0],
  // Sequencer 2
  ['sequencer2_steps', 126, 92, 8, 0],
  ['sequencer2_value0', 127, 93, 8, 0],
  ['sequencer2_value1', 128, 94, 8, 0],
  ['sequencer2_value2', 129, 95, 8, 0],
  ['sequencer2_value3', 130, 96, 8, 0],
  ['sequencer2_value4', 131, 97, 8, 0],
  ['sequencer2_value5', 132, 98, 8, 0],
  ['sequencer2_value6', 133, 99, 8, 0],
  ['sequencer2_value7', 134, 100, 8, 0],
  ['sequencer2_value8', 135, 101, 8, 0],
  ['sequencer2_value9', 136, 102, 8, 0],
  ['sequencer2_value10', 137, 103, 8, 0],
  ['sequencer2_value11', 138, 104, 8, 0],
  ['sequencer2_value12', 139, 105, 8, 0],
  ['sequencer2_value13', 140, 106, 8, 0],
  ['sequencer2_value14', 141, 107, 8, 0],
  ['sequencer2_value15', 142, 108, 8, 0],
  // Harmony
  ['harmony_tuning', 143, 109, 8, 0],
  ['harmony_key', 144, 110, 4, 0],
  ['harmony_interval1', 146, 110, 4, 4],
  ['harmony_mode', 145, 111, 5, 0],
  ['harmony_interval2', 147, 111, 3, 5],
  // Pitch detect
  ['pitch_detect_input', 148, 112, 1, 0],
  ['pitch_detect_mode', 167, 112, 1, 1],
  ['pitch_detect_low_note', 149, 112, 6, 2],
  ['pitch_detect_high_note', 150, 113, 8, 0],
  // Knob assigns
  ['knob1_assign', 151, 114, 8, 0],
  ['knob2_assign', 152, 115, 8, 0],
  // Ext/misc byte 116
  ['routing_option', 170, 116, 3, 0],
  ['filter2_correction', -1, 116, 1, 3],
  ['on_off_status', 171, 116, 1, 4],
  ['ext_control_enable', 165, 116, 1, 5],
  ['lfo_midi_clock_sync', 166, 116, 2, 6],
  // External controller blocks (dest/source packed, min/max whole bytes)
  ['ext1_destination', 153, 117, 6, 0],
  ['ext1_source', 154, 117, 2, 6],
  ['ext1_min', 155, 118, 8, 0],
  ['ext1_max', 156, 119, 8, 0],
  ['ext2_destination', 157, 120, 6, 0],
  ['ext2_source', 158, 120, 2, 6],
  ['ext2_min', 159, 121, 8, 0],
  ['ext2_max', 160, 122, 8, 0],
  ['ext3_destination', 161, 123, 6, 0],
  ['ext3_source', 162, 123, 2, 6],
  ['ext3_min', 163, 124, 8, 0],
  ['ext3_max', 164, 125, 8, 0]
];

const numOpts = (max) => Array.from({ length: max + 1 }, (_, v) => ({ value: v, text: String(v) }));

// Filter type option names (index = value) taken verbatim from the official
// Neuro Desktop 3 editor's C4 module spec (shared-jvm/files/sa-249.json,
// filter1_type/filter2_type dropDownList items). The pedal field is 5-bit
// (0..31); the editor only defines 29 names (0..28).
const FILTER_TYPES = [
  '3 Parallel Low-Pass',
  '6 Pole Low-Pass',
  '2 Pole Low-Pass',
  'Notch, Low-Pass, Peak',
  'Notch, Notch, Low-Pass',
  'Peak, Notch, Low-Pass',
  'Low-Pass, Peak, Peak',
  '2 Parallel Low-Pass',
  '4 Pole Low-Pass',
  'Low-Pass, Peak',
  '4 Pole Low-Pass, Peak',
  'Peak, 4 Pole Low-Pass',
  'Bandpass 1',
  'Peak',
  'Triple Peak 1',
  'Triple Peak 2',
  'Triple Peak 3',
  'Triple Peak 4',
  'Peak, Notch, Peak',
  'Notch, Peak, Notch',
  '2-Stage Phaser',
  '3-Stage Phaser',
  '1-Stage Phaser',
  'High-Pass',
  'High-Pass, Peak',
  'Classic Wah',
  'Bandpass 2',
  'Double Peak',
  '6 Pole All-Pass'
];

function enumOpts(names) {
  return names.map((text, value) => ({ value, text }));
}

// Enum name tables (index = value) taken verbatim from the official Neuro
// Desktop 3 editor's C4 module spec (shared-jvm/files/sa-249.json, product 249).
// Where the editor's range is shorter than the pedal field (e.g. filter1_type
// max 28 vs 5-bit field max 31) upper values stay unnamed; the UI shows a
// disabled numeric placeholder via selectValueKnown.
const VOICE_OCTAVES = [
  'Oct +3',
  'Oct +2',
  'Oct +1',
  'Oct --',
  'Oct -1',
  'Oct -2',
  'Oct -3'
];
const VOICE_SEMITONES = [
  'Semi +11', 'Semi +10', 'Semi +9', 'Semi +8', 'Semi +7', 'Semi +6',
  'Semi +5', 'Semi +4', 'Semi +3', 'Semi +2', 'Semi +1',
  'Semi --',
  'Semi -1', 'Semi -2', 'Semi -3', 'Semi -4', 'Semi -5', 'Semi -6',
  'Semi -7', 'Semi -8', 'Semi -9', 'Semi -10', 'Semi -11'
];
const VOICE_MODES = [
  'Fixed Interval',
  'Interval + Harmony 1',
  'Interval + Sequencer 1'
];
const VOICE_SOURCES = [
  'Stereo Input Mix',
  'Polyphonic Pitch 1',
  'Polyphonic Pitch 2',
  'Monophonic Pitch 1',
  'Monophonic Pitch 2',
  'Saw 1',
  'Saw 2',
  'Sine 1',
  'Sine 2',
  'Square 1',
  'Square 2',
  'Mono Input 1',
  'Mono Input 2'
];
const VOICE_ENVELOPES = ['Envelope OFF', 'Envelope 1', 'Envelope 2'];
const VOICE_DESTINATIONS = ['Filter + Distortion', 'Filter Only', 'Direct Output'];
const DISTORTION_TYPES = [
  'Mild',
  'Moderate',
  'Heavy and Bassy',
  'Sample Reducer',
  'Octave Fuzz',
  'Gated Fuzz',
  'Foldover Light',
  'Foldover Heavy',
  'Double Foldover',
  'Double Octave Fuzz',
  'Triple Fold',
  'Single Clip',
  'Max Foldover'
];
const MIX_DESTINATIONS = ['Output 1 Only', 'Output 1 + Output 2', 'Output 2 Only'];
const FILTER_ENVELOPES = ['Env/LFO 1', 'Env/LFO 2'];
const FILTER_PITCH_TRACK = ['Pitch Track OFF', '1/3 Octave', '2/3 Octave', '1 Octave'];
const ENVELOPE_TYPES = [
  'Fast Attack, Adjust Decay',
  'Fastest Attack, Adjust Decay',
  'Wide Range 1, Adjust Attack/Decay',
  'Wide Range 2, Faster Decay',
  'Snappy',
  'Swell',
  'ADSR 1 Adjust Attack/Decay',
  'ADSR 2 Fast Attack, Adjust Decay',
  'ADSR 3 Adjust Attack/Decay',
  'ADSR 4',
  'ADSR 5',
  'ADSR 6 Slow Attack, Fast Decay'
];
const ENVELOPE_INPUTS = ['Audio Input 1', 'Audio Input 2'];
const LFO_SHAPES = [
  'Sine',
  'Pluck',
  'Square',
  'Rising Saw',
  'Falling Saw',
  'Triangle',
  'Sample & Hold',
  '4 Step',
  '4 Step + S&H',
  'Sine + S&H',
  'Sine Rise Skew',
  'Sine Fall Skew',
  'Triangle Rise Skew',
  'Triangle Fall Skew'
];
const LFO_BEAT_DIVISIONS = ['Whole', 'Half', 'Quarter', 'Eighth', 'Triplet', 'Sixteenth'];
const LFO_2_MULTIPLY = [
  'LFO 2 = LFO 1',
  'LFO 2 = 2x LFO 1',
  'LFO 2 = 3x LFO 1',
  'LFO 2 = 4x LFO 1',
  'LFO 2 = 5x LFO 1',
  'LFO 2 = 6x LFO 1',
  'LFO 2 = 7x LFO 1',
  'LFO 2 = 8x LFO 1',
  'LFO 2 = 16x LFO 1',
  'LFO 2 = 32x LFO 1',
  'LFO 2 = 64x LFO 1'
];
const HARMONY_KEYS = ['A', 'A#', 'B', 'C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#'];
const HARMONY_MODES = [
  'Ionian (Major)',
  'Dorian',
  'Phrygian',
  'Lydian',
  'Mixolydian',
  'Aeolian (Natural Minor)',
  'Locrian',
  'Harmonic Minor',
  'Locrian nat. 6',
  'Ionian #5',
  'Dorian #4',
  'Phrygian nat. 3',
  'Lydian #2',
  'Altered bb7',
  'Jazz Minor',
  'Phrygian nat. 6',
  'Lydian #5',
  'Lydian b7',
  'Mixolydian b6',
  'Locrian nat. 2',
  'Altered Scale',
  'Half-Whole',
  'Whole-Half'
];
const HARMONY_INTERVALS = ['+2nd', '+3rd', '+4th', '+5th', '+6th', '+7th'];
const ROUTING_OPTIONS = ['Auto-Detect', 'Single Input 1', 'Dual Input 1 & 2', 'External Loop'];
const PITCH_DETECT_INPUTS = ['Audio Input 1', 'Audio Input 2'];
const PITCH_DETECT_MODES = ['Faster Tracking', 'Higher Accuracy Tracking'];
const PITCH_DETECT_LOW_NOTES = [
  'G2',
  'F#2',
  'F2',
  'E2 (6-String Guitar)',
  'D#2',
  'D2',
  'C#2',
  'C2',
  'B1 (7-String Guitar)',
  'A#1',
  'A1',
  'G#1',
  'G1',
  'F#1',
  'F1',
  'E1 (4-String Bass)',
  'D#1',
  'D1',
  'C#1',
  'C1',
  'B0 (5-String Bass)'
];
const PITCH_DETECT_HIGH_NOTES = [
  'E6 (Guitar with 24 Frets)',
  'D#6',
  'D6 (Guitar with 22 Frets)',
  'C#6',
  'C6',
  'B5',
  'A#5',
  'A5',
  'G#5',
  'G5',
  'F#5',
  'F5',
  'E5',
  'D#5',
  'D5',
  'C#5',
  'C5',
  'B4',
  'A#4',
  'A4',
  'G#4',
  'G4 (Bass with 24 Frets)',
  'F#4',
  'F4',
  'E4',
  'D#4 (Bass with 20 Frets)',
  'D4',
  'C#4',
  'C4',
  'B3',
  'A#3',
  'A3'
];
const EXT_SOURCES = [
  'OFF',
  'Control Input X (HH/Dual Exp)',
  'Control Input Y (HH/Dual Exp)',
  'Hub Expression Input (Hub/MIDI)'
];
const EXT_DESTINATIONS = [
  'Input 1 Gain',
  'Input 2 Gain',
  'Master Depth',
  'Mod Source',
  'Bass',
  'Treble',
  'Mix',
  'Output',
  'Output Balance',
  'Voice 1 Level',
  'Voice 1 Pan',
  'Voice 1 Detune',
  'Voice 1 Tremolo',
  'Voice 2 Level',
  'Voice 2 Pan',
  'Voice 2 Detune',
  'Voice 2 Tremolo',
  'Voice 3 Level',
  'Voice 3 Pan',
  'Voice 3 Detune',
  'Voice 3 Tremolo',
  'Voice 4 Level',
  'Voice 4 Pan',
  'Voice 4 Detune',
  'Voice 4 Tremolo',
  'Drive',
  'Distortion Mix',
  'Distortion Output',
  'Filter 1 Depth',
  'Filter 1 Frequency',
  'Filter 1 Q',
  'Filter 2 Depth',
  'Filter 2 Frequency',
  'Filter 2 Q',
  'Envelope 1 Sensitivity',
  'Envelope 1 Speed',
  'Envelope 1 Gate',
  'Envelope 2 Sensitivity',
  'Envelope 2 Speed',
  'Envelope 2 Gate',
  'FM Depth 1',
  'FM Depth 2',
  'Octaver Filter 1',
  'Octaver Filter 2',
  'LFO Speed',
  'LFO Envelope To Speed',
  'LFO Envelope To Depth',
  'LFO 2 Phase Offset',
  'External Modulation'
];
// Knob assignments list the same destinations minus the trailing External
// Modulation (48 entries, values 0..47).
const KNOB_ASSIGNS = EXT_DESTINATIONS.slice(0, 48);
const SEQUENCER_STEPS = [
  '2 Steps', '3 Steps', '4 Steps', '5 Steps', '6 Steps', '7 Steps', '8 Steps',
  '9 Steps', '10 Steps', '11 Steps', '12 Steps', '13 Steps', '14 Steps', '15 Steps',
  '16 Steps'
];

const ENUM_NAMES = {};
for (const n of [1, 2, 3, 4]) {
  ENUM_NAMES[`voice${n}_mode`] = VOICE_MODES;
  ENUM_NAMES[`voice${n}_source`] = VOICE_SOURCES;
  ENUM_NAMES[`voice${n}_envelope`] = VOICE_ENVELOPES;
  ENUM_NAMES[`voice${n}_destination`] = VOICE_DESTINATIONS;
  ENUM_NAMES[`voice${n}_octave`] = VOICE_OCTAVES;
  ENUM_NAMES[`voice${n}_semitone`] = VOICE_SEMITONES;
}
ENUM_NAMES.distortion_type = DISTORTION_TYPES;
ENUM_NAMES.mix1_destination = MIX_DESTINATIONS;
ENUM_NAMES.mix2_destination = MIX_DESTINATIONS;
ENUM_NAMES.filter1_type = FILTER_TYPES;
ENUM_NAMES.filter2_type = FILTER_TYPES;
ENUM_NAMES.filter1_envelope = FILTER_ENVELOPES;
ENUM_NAMES.filter2_envelope = FILTER_ENVELOPES;
ENUM_NAMES.filter1_pitch_track = FILTER_PITCH_TRACK;
ENUM_NAMES.filter2_pitch_track = FILTER_PITCH_TRACK;
ENUM_NAMES.envelope1_type = ENVELOPE_TYPES;
ENUM_NAMES.envelope2_type = ENVELOPE_TYPES;
ENUM_NAMES.envelope1_input = ENVELOPE_INPUTS;
ENUM_NAMES.envelope2_input = ENVELOPE_INPUTS;
ENUM_NAMES.lfo_shape = LFO_SHAPES;
ENUM_NAMES.lfo_beat_division = LFO_BEAT_DIVISIONS;
ENUM_NAMES.lfo_2_multiply = LFO_2_MULTIPLY;
ENUM_NAMES.harmony_key = HARMONY_KEYS;
ENUM_NAMES.harmony_interval1 = HARMONY_INTERVALS;
ENUM_NAMES.harmony_interval2 = HARMONY_INTERVALS;
ENUM_NAMES.harmony_mode = HARMONY_MODES;
ENUM_NAMES.routing_option = ROUTING_OPTIONS;
ENUM_NAMES.pitch_detect_input = PITCH_DETECT_INPUTS;
ENUM_NAMES.pitch_detect_mode = PITCH_DETECT_MODES;
ENUM_NAMES.pitch_detect_low_note = PITCH_DETECT_LOW_NOTES;
ENUM_NAMES.pitch_detect_high_note = PITCH_DETECT_HIGH_NOTES;
ENUM_NAMES.ext1_source = EXT_SOURCES;
ENUM_NAMES.ext2_source = EXT_SOURCES;
ENUM_NAMES.ext3_source = EXT_SOURCES;
ENUM_NAMES.ext1_destination = EXT_DESTINATIONS;
ENUM_NAMES.ext2_destination = EXT_DESTINATIONS;
ENUM_NAMES.ext3_destination = EXT_DESTINATIONS;
ENUM_NAMES.knob1_assign = KNOB_ASSIGNS;
ENUM_NAMES.knob2_assign = KNOB_ASSIGNS;
ENUM_NAMES.sequencer1_steps = SEQUENCER_STEPS;
ENUM_NAMES.sequencer2_steps = SEQUENCER_STEPS;

// Fields the editor exposes as a plain on/off switch. voiceN_enable,
// distortion_enable and mixN_enable are 4-bit in the pedal map but semantically
// two-state; lfo_midi_clock_sync is 2-bit but editor shows a boolean.
const SWITCH_BY_NAME = new Set([
  'voice1_enable',
  'voice2_enable',
  'voice3_enable',
  'voice4_enable',
  'distortion_enable',
  'mix1_enable',
  'mix2_enable',
  'lfo_midi_clock_sync'
]);

// Build the workbench control-map specs. A field is a whole-byte knob when it
// owns its entire body byte (width 8 shift 0); only those get a 1:1 live write
// index (CTRL_SET at liveIndex — the value is byte-identical body<->live).
// Bit-packed fields (anything else) go through the flash-commit path because a
// CTRL_SET on their byte would clobber sibling bits: liveIndex = null.
// Named enums render as dropdowns regardless of their width (incl. whole-byte
// fields the editor exposes as menus: LFO Time Ratio, knob assignments, pitch
// detect high note, sequencer steps) and 1-bit fields with real labels (filter
// env source, pitch detect input/mode).
function buildControlSpecs() {
  const specs = [];
  for (const [label, live, body, width, shift] of CTRL_ROWS) {
    const mask = (((1 << width) - 1) << shift) & 0xff;
    const max = (1 << width) - 1;
    const wholeByte = width === 8 && shift === 0;
    const named = ENUM_NAMES[label];
    const type = named ? 'select' : width === 1 || SWITCH_BY_NAME.has(label) ? 'toggle' : wholeByte ? 'knob' : 'select';
    specs.push({
      index: body,
      name: label,
      type,
      shift,
      mask,
      max,
      liveIndex: wholeByte ? live : null,
      options: type === 'select' ? (named ? enumOpts(named) : numOpts(max)) : undefined
    });
  }
  specs.sort((a, b) => a.index - b.index || a.shift - b.shift);
  return specs;
}

const WORKBENCH_CONTROL_SPECS = buildControlSpecs();

module.exports = {
  C4_PRESET_BASE,
  C4_PRESET_PITCH,
  C4_DATA_OFF,
  C4_DATA_SIZE,
  C4_NAME_OFF,
  C4_NAME_SIZE,
  C4_PRESET_COUNT,
  WORKBENCH_CONTROL_SPECS
};