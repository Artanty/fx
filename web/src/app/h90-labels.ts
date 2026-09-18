const GENERIC_LABELS: Record<string, string> = {
  preset_mix: 'Preset Mix',
  killdry: 'Kill Dry',
  tmpv: 'Tempo',
  tsyn: 'Tap Sync',
  slow_mode: 'Slow Mode',
  expression_pedal: 'Expression Pedal',
  pedal: 'Pedal',
  in1_sens: 'In 1 Sens',
  in2_sens: 'In 2 Sens',
  out1_sens: 'Out 1 Sens',
  out2_sens: 'Out 2 Sens',
  bypa_normal: 'Bypass',
  bypt_normal: 'ByPass Tails',
  x_switch: 'X Switch',
  y_switch: 'Y Switch',
  z_switch: 'Z Switch',
  size: 'Size',
};

const ALGORITHM_LABELS: Record<string, Record<string, string>> = {
  ModEchoVerb: {
    dcay: 'Delay Time',
    efbk: 'Feedback',
    eton: 'Echo Tone',
    fxmx: 'Loop Mix',
    hilv: 'High Level',
    lolv: 'Low Level',
    mmix: 'Mix',
    mrat: 'Mod Rate',
    pdly: 'Predelay',
    dcay_hot_switch: 'Delay HotSwitch',
    efbk_hot_switch: 'Feedback HotSwitch',
    pdly_hot_switch: 'Predelay HotSwitch',
  },
  ModFilter: {
    dpth: 'Depth',
    itsy: 'Intensity',
    mrat: 'Mod Rate',
    msrc: 'Mod Source',
    shpe: 'Shape',
    smod: 'Mod Shape',
    sped: 'Speed',
    wdth: 'Width',
    brake: 'Brake',
    dmod: 'Deep Mod',
    type: 'Type',
  },
};

export function knobLabel(algorithm: string | null, key: string): string {
  const mapped =
    algorithm && ALGORITHM_LABELS[algorithm] && ALGORITHM_LABELS[algorithm][key];
  if (mapped) return mapped;
  return GENERIC_LABELS[key] ?? key;
}