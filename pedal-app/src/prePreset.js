const fs = require('fs');

// Field sequence as emitted by the official Neuro app for the L.A. Lady
// (One Series Overdrive template). Version 1, product 244.
const FIELD_ORDER = [
  'left_voice',
  'left_voice_frequency',
  'left_drive',
  'left_output',
  'left_distortion_engine',
  'left_clean_mix',
  'left_drive_balance',
  'left_drive_maximum',
  'left_treble_level',
  'left_bass_level',
  'left_mid_a_level',
  'left_mid_b_level',
  'right_voice',
  'right_voice_frequency',
  'right_drive',
  'right_output',
  'right_distortion_engine',
  'right_clean_mix',
  'right_drive_balance',
  'right_drive_maximum',
  'right_treble_level',
  'right_bass_level',
  'right_mid_a_level',
  'right_mid_b_level',
  'noise_gate',
  'filter_gate_mode',
  'noise_gate_threshold',
  'clean_high_cut_filter',
  'treble_shelf_frequency',
  'treble_cut_filter_type',
  'treble_shelf_slope',
  'treble_boost_rolloff',
  'treble_boost_maximum',
  'bass_shelf_frequency',
  'bass_cut_filter_type',
  'bass_shelf_slope',
  'bass_boost_rolloff',
  'mid_a_frequency',
  'mid_a_q',
  'mid_b_frequency',
  'mid_b_q',
  'low_cut_filter',
  'bass_clean_knob_assign',
  'treble_knob_assign',
  'io_routing_option',
  'external_switch_mode',
  'external_switch_control_option',
  'ext_control_enable',
  'ext_control_source',
  'ext_control_destination',
  'control_range',
  'control_min',
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

function parsePre(text) {
  const get = (tag) => {
    const m = text.match(new RegExp('<' + tag + '>([^<]*)</' + tag + '>'));
    return m ? m[1] : null;
  };
  const params = {};
  for (const tag of FIELD_ORDER) {
    const v = get(tag);
    if (v !== null) params[tag] = parseInt(v, 10);
  }
  return {
    info: {
      version: get('version'),
      product_id: get('product_id'),
      name: get('name'),
      subname: get('subname'),
      description: get('description'),
      preset_name: get('preset_name'),
      preset_owner: get('preset_owner'),
      original_creator_id: get('original_creator_id')
    },
    params
  };
}

// Emit a .pre file byte-identical in style to the official Neuro export:
// tabs as indentation, LF line endings, trailing newline.
function buildPre({ presetName, presetOwner, originalCreatorId, productId, name, subname, description, params }) {
  const info = [
    '\t<info>',
    '\t\t<version>1</version>',
    '\t\t<product_id>' + (productId || '244') + '</product_id>',
    '\t\t<name>' + (name || 'L.A. Lady') + '</name>',
    '\t\t<subname>' + (subname || 'Overdrive') + '</subname>',
    '\t\t<description>' + (description || '') + '</description>',
    '\t\t<preset_name>' + (presetName || '') + '</preset_name>',
    '\t\t<preset_owner>' + (presetOwner || '') + '</preset_owner>',
    '\t\t<original_creator_id>' + (originalCreatorId || presetOwner || '') + '</original_creator_id>',
    '\t</info>'
  ];
  const lines = ['<neuro_preset>', ...info];
  for (const tag of FIELD_ORDER) {
    lines.push('\t<' + tag + '>' + params[tag] + '</' + tag + '>');
  }
  lines.push('</neuro_preset>');
  return lines.join('\n') + '\n';
}

function savePre(path, xml) {
  fs.writeFileSync(path, xml, 'utf8');
}

module.exports = { FIELD_ORDER, parsePre, buildPre, savePre };
