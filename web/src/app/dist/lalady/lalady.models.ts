export interface DistEngine {
  id: number;
  name: string;
}

export interface ControlOption {
  value: number;
  text: string;
}

export interface ControlSpec {
  index: number;
  name: string;
  type: 'knob' | 'select' | 'toggle' | 'segmented';
  shift: number;
  mask: number;
  max: number;
  liveIndex?: number | null;
  cc?: number | null;
  options?: ControlOption[];
}

export interface ControlMap {
  ok: boolean;
  count: number;
  controls: ControlSpec[];
}

export interface EngineList {
  ok: boolean;
  count: number;
  engines: DistEngine[];
}

export interface LaladySlot {
  name: string;
  page: number;
  hex: string;
  rows: PresetRow[];
  kind: string;
}

export interface LaladyPresets {
  slots: LaladySlot[];
  activePage: number;
  activeIndex: number;
}

export interface LaladyDevice {
  found: boolean;
  device?: unknown;
}

export interface LaladyConfig {
  firmwareVersion: number;
  deviceModel: number;
  field3?: number;
  activePreset: number;
  hardwareBypassMode: number;
  midiChannel: number; // 0-based (payload[7] of the hardware config report)
  raw?: string;
}

export interface LaladyStatus {
  config: LaladyConfig;
  device?: unknown;
  activePage: number;
  error?: string;
}

export interface WriteRequest {
  slot: string;
  preText: string;
}

export interface WriteResult {
  ok: boolean;
  slot: string;
  idx?: number;
  rawIdx?: number;
  before: string;
  after: string;
  written: string;
  error?: string;
}

export interface ActivateResult {
  ok: boolean;
  slot: string;
  activeIndex: number;
  reply?: string | null;
}

export interface EraseResult {
  ok: boolean;
  slot: string;
  idx: number;
  erased: string;
  after: string;
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
  error?: string;
}

export interface LiveControl {
  index: number;
  name: string;
  value: number | null;
}

export interface LiveControls {
  ok: boolean;
  ts: number;
  activeIndex: number;
  activePage: number;
  presetName: string;
  raw?: number[] | null;
  controls: LiveControl[];
  error?: string;
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
  params: SlotParam[];
  error?: string;
}

export interface SlotSaveRequest {
  overrides: Record<number, number>;
  idx?: number;
}

export interface SlotSaveResult {
  ok: boolean;
  presetIndex: number;
  activePage: number;
  readback: number[];
  error?: string;
}

export interface RestoreSlotResult {
  slot: number;
  page: string;
  name: string;
  readbackName: string;
  before: string;
  after: string;
}

export interface RestoreResult {
  ok: boolean;
  slots: RestoreSlotResult[];
  recallIdx: number;
  error?: string;
}

// Randomizer: named scene presets + control groups, persisted by the backend
// in back/lalady/randomizer-data/ (local DB today, remote DB later).
export interface RandomizeGroup {
  id: string;
  name: string;
  priority: number;
  props: number; // number of random props applied per scene from this group (0 = all)
  specKeys: string[]; // control-map entries "index:name"
  createdAt: number;
  updatedAt: number;
}

export interface RandomizePreset {
  id: string;
  name: string;
  bodyHex: string; // 106 hex chars = 53-byte preset body
  source: string;
  slot?: number | null; // last pedal slot this preset was saved to
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

export interface PresetRow {
  offset: number;
  hex: string;
  ascii: string;
  region: string;
}

export interface EepromData {
  hex: string;
  midiMap: { ccToControl: number[]; controlToCc: Record<string, number> };
  midiMapRegion: { start: number; len: number; hex: string };
  osbfMatch: boolean;
  osbfDiffCount: number;
  osbfDiffOffsets: number[];
}

export interface OsbfData {
  productId: number;
  presets: { location: number; name: string }[];
  selectors: { location: number; name: string }[];
}

