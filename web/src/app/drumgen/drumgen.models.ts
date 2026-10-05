import { Injectable } from '@angular/core';

/** One cell of the grid: a MIDI note number, 0 = empty. */
export interface DrumgenVoice {
  lane: number;
  id: string;
  label: string;
  note: number;
}

export interface DrumgenEvent {
  lane: number;
  step: number;
  tick: number;
  vel: number;
  note: number;
  id: string;
}

export interface DrumgenState {
  booted: boolean;
  /** The pattern the host is editing. */
  rows: number[][];
  /** The last bar gen.lua produced, once tick has run. */
  bar_rows?: number[][];
  steps: number;
  lanes: number;
  style: string;
  styles: string[];
  params: Record<string, number>;
  fill_every: number;
  bar: number;
  last_fill: boolean;
  voices: DrumgenVoice[];
  events: DrumgenEvent[];
}

export interface DrumgenReply<T = DrumgenState> {
  ok: boolean;
  state?: T;
  error?: string;
}

export interface DrumgenBoot {
  version: string;
  modules: string[];
  manifest: Record<string, string>;
  state: DrumgenState;
}

export interface DrumgenManifest {
  source: string;
  files: Record<string, string>;
}

/** Bridge entry points, by name. Nothing else in the page may call Lua. */
export type BridgeFn = 'boot' | 'tick' | 'set' | 'cells';