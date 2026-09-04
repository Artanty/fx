const { FIELD_ORDER } = require('./prePreset');

// byte index -> field name (1:1 direct mapping)
const DIRECT = {
  0: 'left_voice',
  1: 'left_voice_frequency',
  2: 'left_drive',
  3: 'left_output',
  4: 'left_distortion_engine',
  5: 'left_clean_mix',
  7: 'left_drive_balance',
  8: 'left_drive_maximum',
  9: 'left_treble_level',
  10: 'left_bass_level',
  11: 'left_mid_a_level',
  12: 'left_mid_b_level',
  13: 'right_voice',
  14: 'right_voice_frequency',
  15: 'right_drive',
  16: 'right_output',
  17: 'right_distortion_engine',
  18: 'right_clean_mix',
  20: 'right_drive_balance',
  21: 'right_drive_maximum',
  22: 'right_treble_level',
  23: 'right_bass_level',
  24: 'right_mid_a_level',
  25: 'right_mid_b_level',
  27: 'noise_gate_threshold',
  28: 'clean_high_cut_filter',
  29: 'treble_shelf_frequency',
  31: 'bass_shelf_frequency',
  33: 'mid_a_frequency',
  34: 'mid_a_q',
  35: 'mid_b_frequency',
  36: 'mid_b_q',
  37: 'low_cut_filter'
};

// fields present in the Neuro XML but with no location in the 53-byte block;
// preserved on round-trip, emitted as 0 when decoding a fresh binary.
const UNMAPPED = [
  'external_switch_mode',
  'external_switch_control_option',
  'ext_control_enable',
  'ext_control_source',
  'ext_control_destination',
  'extmin_0',
  'extmax_0',
  'extmin_1',
  'extmax_1',
  'extmin_2',
  'extmax_2',
  'extmin_3',
  'extmax_3',
  'link_channels'
];

function decodeBinary53(buf) {
  const params = {};
  for (const [i, name] of Object.entries(DIRECT)) params[name] = buf[i];
  params.noise_gate = (buf[26] >> 4) & 1;
  params.filter_gate_mode = (buf[26] >> 2) & 3;
  params.treble_cut_filter_type = buf[30] & 1;
  params.treble_shelf_slope = (buf[30] >> 1) & 3;
  params.treble_boost_rolloff = (buf[30] >> 3) & 3;
  params.treble_boost_maximum = (buf[30] >> 5) & 7;
  params.bass_cut_filter_type = buf[32] & 1;
  params.bass_shelf_slope = (buf[32] >> 1) & 3;
  params.bass_boost_rolloff = (buf[32] >> 3) & 0x1f;
  params.bass_clean_knob_assign = buf[38] & 0xf;
  params.treble_knob_assign = (buf[38] >> 4) & 0xf;
  params.io_routing_option = (buf[39] >> 4) & 0xf;
  params.control_range = buf[49] | (buf[50] << 8);
  params.control_min = buf[51] | (buf[52] << 8);
  for (const f of UNMAPPED) params[f] = 0;
  return params;
}

function encodeBinary53(params) {
  const b = Buffer.alloc(53);
  for (const [i, name] of Object.entries(DIRECT)) b[i] = params[name] & 0xff;
  b[26] = ((params.noise_gate & 1) << 4) | ((params.filter_gate_mode & 3) << 2);
  b[30] =
    (params.treble_cut_filter_type & 1) |
    ((params.treble_shelf_slope & 3) << 1) |
    ((params.treble_boost_rolloff & 3) << 3) |
    ((params.treble_boost_maximum & 7) << 5);
  b[32] = (params.bass_cut_filter_type & 1) | ((params.bass_shelf_slope & 3) << 1) | ((params.bass_boost_rolloff & 0x1f) << 3);
  b[38] = (params.bass_clean_knob_assign & 0xf) | ((params.treble_knob_assign & 0xf) << 4);
  b[39] = (params.io_routing_option & 0xf) << 4;
  b[49] = params.control_range & 0xff;
  b[50] = (params.control_range >> 8) & 0xff;
  b[51] = params.control_min & 0xff;
  b[52] = (params.control_min >> 8) & 0xff;
  return b;
}

module.exports = { DIRECT, UNMAPPED, decodeBinary53, encodeBinary53, FIELD_ORDER };
