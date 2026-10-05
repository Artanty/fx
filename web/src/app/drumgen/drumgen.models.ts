/** One cell of the grid: a velocity 0..127, 0 = empty. */
export interface DrumgenVoice {
  lane: number;
  id: string;
  label: string;
  note: number;
}

/** One scheduled note. `tick` is the position inside the bar, at TICKS_PER_STEP per step. */
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
  tempo: number;
  playing: boolean;
  /** 1..steps, where the host's playhead is, or undefined when stopped. */
  playhead?: number;
  /** Which param the encoders are turning, 1..4. */
  selected: number;
  /** Key 3 has swapped the encoders over to swing. */
  swing_page: boolean;
  enc_params: string[];
  ticks_per_step: number;
  voices: DrumgenVoice[];
  events: DrumgenEvent[];
}

/** The screen as run-length encoded levels: [count, level] pairs in reading order. */
export type DrumgenRle = [number, number][];

export interface DrumgenPixels {
  width: number;
  height: number;
  rle: DrumgenRle;
}

export interface DrumgenReply<T = DrumgenState> {
  ok: boolean;
  state?: T;
  error?: string;
  events?: DrumgenEvent[];
  pixels?: DrumgenPixels;
  /** Whether this render changed anything, so a host knows to push. */
  dirty?: boolean;
}

/** Device-shaped input, the same shape a norns key()/enc() callback would produce. */
export type DrumgenInputEvent =
  | { kind: 'enc'; n: number; d: number }
  | { kind: 'key'; n: number; z: boolean };

export interface DrumgenManifest {
  source: string;
  files: Record<string, string>;
}

/** Bridge entry points, by name. Nothing else in the page may call Lua. */
export type BridgeFn = 'boot' | 'tick' | 'set' | 'cells' | 'render' | 'input';

/** The 128x64 screen as one array of levels, row major. */
export type DrumgenFrame = Uint8Array;