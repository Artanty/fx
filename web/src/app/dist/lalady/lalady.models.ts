export interface LaladySlot {
  name: string;
  page: number;
  hex: string;
  rows: unknown;
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

