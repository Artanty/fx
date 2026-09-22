// back/c4/norns/tools/c4-overlay.js
// Display-only renames for the norns settings page + c4-params.txt (safe tier:
// cosmetics only - the pedal stores numbers, text never feeds the protocol).
// OPT_OVERLAY[name] = replacement option texts in value order; the count MUST
// equal the source spec's options (optsFor throws otherwise, so a dropped
// option can never silently shift the value<->text mapping).
// LABEL_OVERLAY[name] = replacement display label (param name only, options
// untouched). The identifier (name) stays the value-key / key for the web app.
const OPT_OVERLAY = {
  'voice1_mode': ['Fixed Int', 'Int + Harm 1', 'Int + Seq 1'],
  'voice2_mode': ['Fixed Int', 'Int + Harm 1', 'Int + Seq 1'],
  'voice3_mode': ['Fixed Int', 'Int + Harm 1', 'Int + Seq 1'],
  'voice4_mode': ['Fixed Int', 'Int + Harm 1', 'Int + Seq 1'],
  'voice1_source': ['Stereo In', 'PolyPitch 1', 'PolyPitch 2', 'MonoPitch 1', 'MonoPitch 2', 'Saw 1', 'Saw 2', 'Sine 1', 'Sine 2', 'Square 1', 'Square 2', 'Mono In 1', 'Mono In 2'],
  'voice2_source': ['Stereo In', 'PolyPitch 1', 'PolyPitch 2', 'MonoPitch 1', 'MonoPitch 2', 'Saw 1', 'Saw 2', 'Sine 1', 'Sine 2', 'Square 1', 'Square 2', 'Mono In 1', 'Mono In 2'],
  'voice3_source': ['Stereo In', 'PolyPitch 1', 'PolyPitch 2', 'MonoPitch 1', 'MonoPitch 2', 'Saw 1', 'Saw 2', 'Sine 1', 'Sine 2', 'Square 1', 'Square 2', 'Mono In 1', 'Mono In 2'],
  'voice4_source': ['Stereo In', 'PolyPitch 1', 'PolyPitch 2', 'MonoPitch 1', 'MonoPitch 2', 'Saw 1', 'Saw 2', 'Sine 1', 'Sine 2', 'Square 1', 'Square 2', 'Mono In 1', 'Mono In 2'],
  'voice1_envelope': ['Env OFF', 'Env 1', 'Env 2'],
  'voice2_envelope': ['Env OFF', 'Env 1', 'Env 2'],
  'voice3_envelope': ['Env OFF', 'Env 1', 'Env 2'],
  'voice4_envelope': ['Env OFF', 'Env 1', 'Env 2'],
  'voice1_destination': ['FilterDist', 'FilterOnly', 'Direct Out'],
  'voice2_destination': ['FilterDist', 'FilterOnly', 'Direct Out'],
  'voice3_destination': ['FilterDist', 'FilterOnly', 'Direct Out'],
  'voice4_destination': ['FilterDist', 'FilterOnly', 'Direct Out'],
  'filter1_type': ['3 Pll LP', '6 Pole LP', '2 Pole LP', 'Notch LP Pk', 'Notch Notch LP', 'Pk Notch LP', 'LP Pk Pk', '2 Pll LP', '4 Pole LP', 'LP Pk', '4 Pole LP Pk', 'Pk 4 Pole LP', 'Bandpass 1', 'Pk', 'Triple Pk 1', 'Triple Pk 2', 'Triple Pk 3', 'Triple Pk 4', 'Pk Notch Pk', 'Notch Pk Notch', '2st Phaser', '3st Phaser', '1st Phaser', 'HP', 'HP Peak', 'Wah', 'Bandpass 2', 'Double Pk', '6 PoleAllPass'],
  'filter2_type': ['3 Pll LP', '6 Pole LP', '2 Pole LP', 'Notch LP Pk', 'Notch Notch LP', 'Pk Notch LP', 'LP Pk Pk', '2 Pll LP', '4 Pole LP', 'LP Pk', '4 Pole LP Pk', 'Pk 4 Pole LP', 'Bandpass 1', 'Pk', 'Triple Pk 1', 'Triple Pk 2', 'Triple Pk 3', 'Triple Pk 4', 'Pk Notch Pk', 'Notch Pk Notch', '2st Phaser', '3st Phaser', '1st Phaser', 'HP', 'HP Peak', 'Wah', 'Bandpass 2', 'Double Pk', '6 PoleAllPass'],
  'filter1_pitch_track': ['OFF', '1/3 Octave', '2/3 Octave', '1 Octave'],
  'filter2_pitch_track': ['OFF', '1/3 Octave', '2/3 Octave', '1 Octave'],
  'mix1_destination': ['Out 1 only', 'Out 1 + 2', 'Out 2 only'],
  'mix2_destination': ['Out 1 only', 'Out 1 + 2', 'Out 2 only'],
  'envelope1_type': ['+At jDec', '+++At jDec', 'Wide1 j At/Dec', 'Wide2 ++Dec', 'Snappy', 'Swell', 'adsr1 j At/Dec', 'adsr2 +At jDec', 'adsr3 j At/Dec', 'adsr4', 'adsr5', 'adsr6 -At +Dec'],
  'envelope2_type': ['+At jDec', '+++At jDec', 'Wide1 j At/Dec', 'Wide2 ++Dec', 'Snappy', 'Swell', 'adsr1 j At/Dec', 'adsr2 +At jDec', 'adsr3 j At/Dec', 'adsr4', 'adsr5', 'adsr6 -At +Dec'],
  'envelope1_input': ['Audio In 1', 'Audio In 2'],
  'envelope2_input': ['Audio In 1', 'Audio In 2'],
  'distortion_type': ['Mild', 'Moderate', 'HeavyBassy', 'SmplReducer', 'OctFuzz', 'GatedFuzz', 'FldvrLight', 'FldvrHeavy', 'DblFldvr', 'DblOctFuzz', 'TripleFold', 'SingleClip', 'MaxFldvr'],
  'lfo_2_multiply': ['lfo2 = lfo1', 'lfo2 = 2x lfo1', 'lfo2 = 3x lfo1', 'lfo2 = 4x lfo1', 'lfo2 = 5x lfo1', 'lfo2 = 6x lfo1', 'lfo2 = 7x lfo1', 'lfo2 = 8x lfo1', 'lfo2 = 16x lfo1', 'lfo2 = 32x lfo1', 'lfo2 = 64x lfo1'],
  'lfo_shape': ['Sine', 'Pluck', 'Square', 'RisingSaw', 'FallingSaw', '3ngl', 'SampleHold', '4 Step', '4 Step + S&H', 'Sine + S&H', 'SineRiseSkew', 'SineFallSkew', '3anglRiseSkew', '3anglFallSkew'],
  'harmony_mode': ['IonianMajor', 'Dorian', 'Phrygian', 'Lydian', 'Mixolydian', 'AeolianNatMin', 'Locrian', 'HarmMin', 'LocrianNat 6', 'Ionian #5', 'Dorian #4', 'PhrygianNat 3', 'Lydian #2', 'Altered bb7', 'Jazz Min', 'PhrygianNat 6', 'Lydian #5', 'Lydian b7', 'Mixolydian b6', 'LocrianNat 2', 'Altered Scale', 'Half-Whole', 'Whole-Half'],
  'pitch_detect_input': ['Audio In 1', 'Audio In 2'],
  'pitch_detect_mode': ['Speed', 'Accuracy'],
  'pitch_detect_low_note': ['G2', 'F#2', 'F2', 'E2 6-StrGuit', 'D#2', 'D2', 'C#2', 'C2', 'B1 7-StrGuit', 'A#1', 'A1', 'G#1', 'G1', 'F#1', 'F1', 'E1 4-StrBass', 'D#1', 'D1', 'C#1', 'C1', 'B0 5-StrBass'],
  'pitch_detect_high_note': ['E6 Guit24fr', 'D#6', 'D6 Guit22fr', 'C#6', 'C6', 'B5', 'A#5', 'A5', 'G#5', 'G5', 'F#5', 'F5', 'E5', 'D#5', 'D5', 'C#5', 'C5', 'B4', 'A#4', 'A4', 'G#4', 'G4 Bass24fr', 'F#4', 'F4', 'E4', 'D#4 Bass20fr', 'D4', 'C#4', 'C4', 'B3', 'A#3', 'A3'],
  'routing_option': ['Auto', 'Single In 1', 'Dual In', 'Ext Loop'],
  'ext1_source': ['OFF', 'ExpIn X', 'ExpIn Y', 'Hub/midi ExpIn'],
  'ext2_source': ['OFF', 'ExpIn X', 'ExpIn Y', 'Hub/midi ExpIn'],
  'ext3_source': ['OFF', 'ExpIn X', 'ExpIn Y', 'Hub/midi ExpIn']
};

// ext1/2/3 destination + knob1/2 assign option lists reference other controls;
// show them under shortened labels. Order mirrors EXT_DESTINATIONS in
// c4Model.js (49 items); knob assigns are the same list minus the trailing
// entry (48). User tweaks on top of the view labels: Input->in, output->out,
// External Modulation->Ext Mod. optsFor() count guard validates each spec.
const DEST_SHORT = [
  'in1 gain', 'in2 gain', 'master depth', 'mod source', 'bass', 'treble',
  'mix', 'out', 'out balance',
  'voice1 level', 'voice1 pan', 'voice1 detune', 'voice1 tremolo',
  'voice2 level', 'voice2 pan', 'voice2 detune', 'voice2 tremolo',
  'voice3 level', 'voice3 pan', 'voice3 detune', 'voice3 tremolo',
  'voice4 level', 'voice4 pan', 'voice4 detune', 'voice4 tremolo',
  'dist drive', 'dist mix', 'dist out',
  'filter1 depth', 'filter1 freq', 'filter1 q',
  'filter2 depth', 'filter2 freq', 'filter2 q',
  'env1 sens', 'env1 speed', 'env1 gate',
  'env2 sens', 'env2 speed', 'env2 gate',
  'fm sine1', 'fm sine2',
  'monoPitchFltr1', 'monoPitchFltr2',
  'lfo speed', 'lfo env2speed', 'lfo env2depth', 'lfo2 phase',
  'Ext Mod'
];
for (const n of ['ext1_destination', 'ext2_destination', 'ext3_destination']) {
  OPT_OVERLAY[n] = DEST_SHORT;
}
for (const n of ['knob1_assign', 'knob2_assign']) {
  OPT_OVERLAY[n] = DEST_SHORT.slice(0, 48);
}

const LABEL_OVERLAY = {
  'filter1_frequency': 'filter1 freq',
  'filter1_envelope': 'filter1 env',
  'filter1_pitch_track': 'filter1 pitch',
  'mix1_destination': 'mix1 dest',
  'filter2_frequency': 'filter2 freq',
  'filter2_envelope': 'filter2 env',
  'filter2_pitch_track': 'filter2 pitch',
  'mix2_destination': 'mix2 dest',
  'envelope1_sensitivity': 'env1 sens',
  'envelope1_speed': 'env1 speed',
  'envelope1_gate': 'env1 gate',
  'envelope1_type': 'env1 type',
  'envelope1_input': 'env1 input',
  'envelope2_sensitivity': 'env2 sens',
  'envelope2_speed': 'env2 speed',
  'envelope2_gate': 'env2 gate',
  'envelope2_type': 'env2 type',
  'envelope2_input': 'env2 input',
  'distortion_drive': 'dist drive',
  'distortion_mix': 'dist mix',
  'distortion_output': 'dist output',
  'distortion_type': 'dist type',
  'distortion_enable': 'dist enable',
  'fm_sine1_input': 'fm sine1 in',
  'fm_sine2_input': 'fm sine2 in',
  'mono_pitch_filter1': 'monoPitchFltr1',
  'mono_pitch_filter2': 'monoPitchFltr2',
  'lfo_env_to_speed': 'lfo env2speed',
  'lfo_env_to_depth': 'lfo env2depth',
  'lfo_2_phase': 'lfo2 phase',
  'lfo_2_multiply': 'lfo2 mult',
  'lfo_beat_division': 'lfoBeatDiv',
  'sequencer1_steps': 'seq1 steps',
  'sequencer1_value0': 'seq1 value0',
  'sequencer1_value1': 'seq1 value1',
  'sequencer1_value2': 'seq1 value2',
  'sequencer1_value3': 'seq1 value3',
  'sequencer1_value4': 'seq1 value4',
  'sequencer1_value5': 'seq1 value5',
  'sequencer1_value6': 'seq1 value6',
  'sequencer1_value7': 'seq1 value7',
  'sequencer1_value8': 'seq1 value8',
  'sequencer1_value9': 'seq1 value9',
  'sequencer1_value10': 'seq1 value10',
  'sequencer1_value11': 'seq1 value11',
  'sequencer1_value12': 'seq1 value12',
  'sequencer1_value13': 'seq1 value13',
  'sequencer1_value14': 'seq1 value14',
  'sequencer1_value15': 'seq1 value15',
  'sequencer2_steps': 'seq2 steps',
  'sequencer2_value0': 'seq2 value0',
  'sequencer2_value1': 'seq2 value1',
  'sequencer2_value2': 'seq2 value2',
  'sequencer2_value3': 'seq2 value3',
  'sequencer2_value4': 'seq2 value4',
  'sequencer2_value5': 'seq2 value5',
  'sequencer2_value6': 'seq2 value6',
  'sequencer2_value7': 'seq2 value7',
  'sequencer2_value8': 'seq2 value8',
  'sequencer2_value9': 'seq2 value9',
  'sequencer2_value10': 'seq2 value10',
  'sequencer2_value11': 'seq2 value11',
  'sequencer2_value12': 'seq2 value12',
  'sequencer2_value13': 'seq2 value13',
  'sequencer2_value14': 'seq2 value14',
  'sequencer2_value15': 'seq2 value15',
  'harmony_tuning': 'harm tuning',
  'harmony_key': 'harm key',
  'harmony_interval1': 'harm int1',
  'harmony_mode': 'harm mode',
  'harmony_interval2': 'harm int2',
  'pitch_detect_input': 'pitch in',
  'pitch_detect_mode': 'pitch mode',
  'filter2_correction': 'filter2 corr',
  'ext_control_enable': 'ext control on',
  'lfo_midi_clock_sync': 'midi clock',
  'ext1_destination': 'ext1 dest',
  'ext2_destination': 'ext2 dest',
  'ext3_destination': 'ext3 dest'
};

function optsFor(name, sourceTexts) {
  const override = OPT_OVERLAY[name];
  if (!override) return sourceTexts;
  if (override.length !== sourceTexts.length) {
    throw new Error(`c4-overlay count mismatch for '${name}': overlay ${override.length} != source ${sourceTexts.length}`);
  }
  return override;
}

function labelFor(name) {
  return LABEL_OVERLAY[name] || name;
}

module.exports = { OPT_OVERLAY, optsFor, LABEL_OVERLAY, labelFor };