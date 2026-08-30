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
