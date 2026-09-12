export interface ControlOption {
  value: number;
  text: string;
}

export interface ControlSpec {
  index: number; // body byte
  name: string;
  type: 'knob' | 'select' | 'toggle' | 'segmented';
  shift: number;
  mask: number;
  max: number;
  liveIndex?: number | null; // CTRL_SET live control index (whole-byte fields only)
  options?: ControlOption[];
}

export interface ControlMap {
  ok: boolean;
  count: number;
  controls: ControlSpec[];
}

export interface C4Device {
  found: boolean;
  device?: {
    product?: string;
    vendorId: number;
    productId: number;
    path: string;
  };
}

export interface C4Config {
  firmwareVersion: number;
  deviceModel: number;
  numPresets: number;
  activePreset: number;
  wysiwyg: number;
  hardwareBypassMode: number;
  midiChannel: number; // 0-based
  raw?: string;
}

export interface C4Status {
  config: C4Config;
  device?: C4Device['device'];
  error?: string;
}

export interface PresetSummary {
  idx: number;
  name: string;
}

export interface PresetList {
  ok: boolean;
  count: number;
  presets: PresetSummary[];
}

export interface SlotParam {
  index: number;
  name: string;
  value: number;
}

export interface SlotParams {
  ok: boolean;
  idx: number;
  page: string;
  name: string;
  hex?: string;
  body?: number[];
  params: SlotParam[];
  error?: string;
}

export interface LiveControls {
  ok: boolean;
  ts: number;
  activeIndex: number;
  presetName: string;
  params: SlotParam[];
  error?: string;
}

export interface ControlRequest {
  index: number;
  value: number;
}

export interface ControlResult {
  ok: boolean;
  index: number;
  value: number;
  readback?: number | null;
  presetIndex?: number;
  error?: string;
}

export interface ActivateResult {
  ok: boolean;
  index: number;
  page: string;
  reply?: string | null;
  error?: string;
}

export interface SlotSaveRequest {
  idx?: number;
  name?: string;
  overrides: Record<number, number>;
}

export interface SlotSaveResult {
  ok: boolean;
  presetIndex: number;
  page: string;
  name: string;
  readback: number[];
  error?: string;
}

export interface MidiBinding {
  cc: number;
  ctrl: number;
  name: string;
}

export interface MidiMap {
  ok: boolean;
  ccToControl: number[];
  controlToCc: Record<string, number>;
  bound: MidiBinding[];
  boundCount: number;
  error?: string;
}

export interface EepromData {
  ok: boolean;
  hex: string;
  midiMap: { ccToControl: number[]; controlToCc: Record<string, number> };
  midiMapRegion: { start: number; len: number; hex: string };
  bound: MidiBinding[];
  boundCount: number;
  error?: string;
}

// Randomizer: named scene presets + control groups, persisted by the backend
// in back/c4/randomizer-data/ (local DB today, remote DB later).
export interface RandomizeGroup {
  id: string;
  name: string;
  priority: number;
  props: number; // number of random props applied per scene from this group (0 = all)
  mode: 'include' | 'exclude'; // include: randomize these controls; exclude: never randomize them
  enabled: boolean; // on/off toggle: disabled groups are ignored entirely by the randomizer
  specKeys: string[]; // control-map entries "index:name"
  createdAt: number;
  updatedAt: number;
}

export interface RandomizePreset {
  id: string;
  name: string;
  bodyHex: string; // 256 hex chars = 128-byte preset body
  source: string;
  slot?: number | null; // last C4 preset location this scene was saved to
  createdAt: number;
  updatedAt: number;
}

export interface RandomizePresetCreate {
  name?: string;
  source?: string;
  saveToSlot?: number | null;
  bodyHex: string;
}

export interface RandomizeList<T> {
  ok: boolean;
  count: number;
  error?: string;
  groups?: T[];
  presets?: T[];
}