import { DecimalPipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  ElementRef,
  OnDestroy,
  OnInit,
  viewChild,
} from '@angular/core';

import { DrumgenLuaService } from './drumgen-lua.service';
import { DrumgenEvent, DrumgenState } from './drumgen.models';

/**
 * The norns drum machine, in a browser tab.
 *
 * Nothing here generates a hit or draws a pixel. This component:
 *
 * - asks lib/bridge.lua for a bar, and schedules the events it returns against the
 *   WebAudio clock (a timer would drift, and drift is audible on a hi-hat);
 * - paints the pixels lib/ui.lua drew, scaled, onto a canvas;
 * - turns clicks on three knobs and three buttons into the same JSON the norns
 *   enc()/key() callbacks send, so both hosts run identical Lua.
 *
 * The playhead is a host concern: Lua draws a column where the host says it is,
 * so the screen and the sound cannot disagree.
 */

/** Screen scale options. 4x is what the norns shield shows at its native setting. */
const SCALES = [2, 3, 4] as const;

/** How one voice is synthesised. No samples: these are quick WebAudio shapes. */
interface VoiceRecipe {
  /** WebAudio oscillator type, or undefined for noise. */
  type?: OscillatorType;
  /** Frequency of the tone, in Hz. */
  hz?: number;
  /** Seconds. */
  decay: number;
  /** A little pitch drop on drum hits, in Hz. */
  drop?: number;
  /** Filter cutoff for noise voices, in Hz. */
  cutoff?: number;
}

const RECIPES: Record<string, VoiceRecipe> = {
  kick: { type: 'sine', hz: 110, decay: 0.32, drop: 80 },
  snare: { decay: 0.18, cutoff: 1800 },
  rim: { type: 'square', hz: 420, decay: 0.06 },
  clap: { decay: 0.14, cutoff: 1400 },
  hatc: { decay: 0.05, cutoff: 8000 },
  hato: { decay: 0.22, cutoff: 6000 },
  shak: { decay: 0.09, cutoff: 5000 },
  ride: { type: 'triangle', hz: 620, decay: 0.5, drop: 240 },
  bell: { type: 'sine', hz: 520, decay: 0.45, drop: 200 },
  perc: { type: 'sine', hz: 240, decay: 0.14, drop: 100 },
};

interface ServedFile {
  name: string;
  hash: string;
}

@Component({
  selector: 'app-drumgen',
  standalone: true,
  templateUrl: './drumgen.component.html',
  styleUrl: './drumgen.component.scss',
  imports: [DecimalPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrumgenComponent implements OnInit, OnDestroy {
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('screen');

  /** The screen Lua draws, 128x64, one level 0..15 per pixel. */
  private frame?: Uint8Array;
  private frameWidth = 0;
  private frameHeight = 0;

  private ctx?: AudioContext;
  private timer?: number;
  /** Whether this component's clock is running, as opposed to what Lua believes. */
  private running = false;
  /** When the current bar started, on the AudioContext clock. */
  private barStartedAt = 0;
  private barEvents: DrumgenEvent[] = [];
  /** Set while scheduled notes play, so the page knows it has made a sound. */
  audioBlocked = true;

  readonly scales = SCALES;
  readonly recipes = RECIPES;

  status = 'loading the lua vm…';
  luaVersion = '';
  files: ServedFile[] = [];
  state?: DrumgenState;
  error = '';
  scale: (typeof SCALES)[number] = 4;
  eventCount = 0;
  /** Bars since the last change, so a fresh bar is visible without a click. */
  barsPlayed = 0;

  constructor(
    private readonly lua: DrumgenLuaService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.lua.start();
      this.luaVersion = this.lua.luaVersion();
      const manifest = await this.lua.manifest();
      this.files = Object.entries(manifest.files).map(([name, hash]) => ({ name, hash }));
      const boot = await this.lua.boot({
        gen: { style: 'four_on_floor', seed: 7 },
        grid: {},
      });
      if (!boot.ok || !boot.state) throw new Error(boot.error ?? 'boot failed');
      this.state = boot.state;
      this.status = 'real lua is running in this tab';
      this.cdr.markForCheck();
      await this.paint();
      // Running on load is what a drum machine does. The context may start
      // suspended, so the first tick can be visual only until a click resumes it.
      await this.startAudio();
      await this.begin();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.status = 'failed';
    }
    this.cdr.markForCheck();
  }

  ngOnDestroy(): void {
    this.haltTimer();
    this.stopPlayheadLoop();
  }

  // ------------------------------------------------------------------ the clock

  /** Milliseconds per step at the current tempo: 16th notes. */
  get stepMs(): number {
    const tempo = this.state?.tempo ?? 120;
    return (60_000 / tempo) / 4;
  }

  get barMs(): number {
    return this.stepMs * (this.state?.steps ?? 16);
  }

  /**
   * How far ahead of the clock the next bar is queued, in ms.
   *
   * Half a bar, not a whole one. The timer fires at the same interval as this
   * lookahead, so a bar queued `barMs` ahead by a timer that also fires every
   * `barMs` arrives exactly one bar late: the audio gets a gap the length of a
   * bar and the playhead sits on the last step waiting for a bar that has not
   * been asked for yet.
   */
  get lookaheadMs(): number {
    return this.barMs / 2;
  }

  /**
   * Start playing from the beginning. The first bar is generated and scheduled
   * immediately, then the timer queues the bar after it, so the beat does not
   * stutter at the loop point.
   */
  async begin(): Promise<void> {
    await this.startAudio();
    // Playing is a fact about Lua's state, and it starts out false after boot, so
    // starting the clock has to say so. Without this the first bar plays and the
    // second never does: onBar() trusts state.playing, sees false, and stops.
    if (this.state?.playing !== true) {
      const reply = await this.lua.set({ playing: true });
      if (!reply.ok || !reply.state) {
        this.error = reply.error ?? 'could not start playing';
        return;
      }
      this.state = reply.state;
    }
    this.lastDrawnStep = undefined;
    await this.scheduleBar(0);
    this.running = true;
    this.armTimer();
  }

  stop(): void {
    this.haltTimer();
    this.running = false;
    void this.setPlaying(false);
  }

  /**
   * Make the host clock agree with the play state Lua reports.
   *
   * Lua owns `playing` - the PLAY key goes through input() like any other key, and
   * so does anything else a host might do - while this component owns the timer
   * that actually queues bars. Those are two pieces of state, so every path that
   * changes one has to put the other right, or a stopped machine keeps ticking.
   */
  private async syncClock(): Promise<void> {
    const shouldRun = this.state?.playing ?? false;
    if (shouldRun === this.running) return;
    if (!shouldRun) {
      this.haltTimer();
      this.stopPlayheadLoop();
      this.running = false;
      // One last redraw with no playhead, so the screen says stopped rather than
      // leaving the column lit where it was.
      await this.paint();
      return;
    }
    await this.begin();
  }

  private armTimer(): void {
    this.haltTimer();
    // Look ahead by a bar so the next one is already queued when this ends.
    this.timer = window.setTimeout(() => void this.onBar(), this.lookaheadMs + 20);
  }

  private haltTimer(): void {
    if (this.timer !== undefined) {
      window.clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private async onBar(): Promise<void> {
    // A pending stop can land between the timeout firing and this running, so the
    // timer is not the authority: Lua's play state is.
    if (this.state?.playing !== true) {
      this.haltTimer();
      this.running = false;
      return;
    }
    await this.scheduleBar(this.lookaheadMs / 1000);
    this.armTimer();
    this.cdr.markForCheck();
  }

  /**
   * Ask Lua for one bar and queue its notes.
   *
   * `when` is how far ahead of now the bar starts on the AudioContext clock. Every
   * event is placed at its own tick, which is what makes a swing feel like a
   * swing rather than a shuffle applied afterwards.
   */
  private async scheduleBar(when: number): Promise<void> {
    const reply = await this.lua.tick({});
    if (!reply.ok || !reply.state) {
      this.error = reply.error ?? 'tick failed';
      this.cdr.markForCheck();
      return;
    }
    this.state = reply.state;
    this.eventCount = reply.state.events.length;
    this.barsPlayed++;

    const now = this.ctx?.currentTime ?? 0;
    const stepSec = this.stepMs / 1000;
    for (const e of reply.state.events) {
      this.voice(e, now + when + (e.step - 1) * stepSec);
    }
    // The playhead is drawn by Lua at the position the host reports, and the host
    // learns that position from the same tick numbers it just scheduled. This bar
    // may be a bar ahead of the one sounding, so it waits its turn (see tickPlayhead).
    this.queuePlayhead(when);
    await this.paint();
    this.cdr.markForCheck();
  }

  /**
   * Walk the playhead across the bar that is sounding.
   *
   * One loop for the life of playback, not one per bar: a loop per bar leaves the
   * old ones running, and two of them setting the same column is how it used to
   * stick near the end of the bar. Bars are queued one ahead, so a new bar waits
   * here until its start time actually arrives.
   *
   * A redraw is a fengari call and is far slower than a frame, so it happens only
   * when the step changes rather than on every animation frame - otherwise the
   * renders queue up behind each other and the column lags the sound.
   */
  private startPlayheadLoop(): void {
    if (this.playheadLoop !== undefined) return;
    const loop = (): void => {
      this.playheadLoop = requestAnimationFrame(loop);
      this.tickPlayhead();
    };
    this.playheadLoop = requestAnimationFrame(loop);
  }

  private stopPlayheadLoop(): void {
    if (this.playheadLoop !== undefined) {
      cancelAnimationFrame(this.playheadLoop);
      this.playheadLoop = undefined;
    }
    this.currentBar = undefined;
    this.pendingBar = undefined;
  }

  /** Note a bar that has just been scheduled, possibly starting in the future. */
  private queuePlayhead(when: number): void {
    const bar = {
      startsAt: performance.now() + when * 1000,
      steps: this.state?.steps ?? 16,
    };
    if (this.currentBar && performance.now() < this.currentBar.startsAt) {
      // Nothing is sounding yet, so this bar is the current one.
      this.currentBar = bar;
    } else {
      this.pendingBar = bar;
    }
    this.startPlayheadLoop();
  }

  private tickPlayhead(): void {
    const now = performance.now();
    // Promote the queued bar once it actually begins.
    if (this.pendingBar && now >= this.pendingBar.startsAt) {
      this.currentBar = this.pendingBar;
      this.pendingBar = undefined;
      this.lastDrawnStep = undefined;
    }
    const bar = this.currentBar;
    if (!bar) {
      this.drawPlayhead(undefined);
      return;
    }
    const stepMs = this.stepMs;
    const step = Math.min(bar.steps, Math.floor((now - bar.startsAt) / stepMs) + 1);
    this.drawPlayhead(step);
  }

  /** Redraw only when the column actually moved, and stop cleanly when paused. */
  private drawPlayhead(step: number | undefined): void {
    if (step === this.lastDrawnStep) return;
    this.lastDrawnStep = step;
    this.playheadStep = step;
    void this.paint().then(() => this.cdr.markForCheck());
  }

  private playheadStep?: number;
  private lastDrawnStep?: number;
  /** Wall-clock start of the bar sounding now, and of the one queued behind it. */
  private currentBar?: { startsAt: number; steps: number };
  private pendingBar?: { startsAt: number; steps: number };
  private playheadLoop?: number;

  // -------------------------------------------------------------------- audio

  /**
   * Audio contexts start suspended until a gesture, so this is called from a
   * click handler and from start(). A failed resume is not fatal: the page still
   * runs the clock and still draws, it just does not make a sound yet.
   */
  private async startAudio(): Promise<void> {
    try {
      this.ctx ??= new AudioContext();
      if (this.ctx.state === 'suspended') await this.ctx.resume();
      this.audioBlocked = this.ctx.state !== 'running';
    } catch {
      this.audioBlocked = true;
    }
    this.cdr.markForCheck();
  }

  /** Play one event at an absolute AudioContext time. */
  private voice(e: DrumgenEvent, at: number): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const recipe = RECIPES[e.id] ?? { decay: 0.15, cutoff: 2000 };
    const gain = ctx.createGain();
    const level = Math.max(0.02, e.vel / 127);

    if (recipe.type && recipe.hz) {
      const osc = ctx.createOscillator();
      osc.type = recipe.type;
      osc.frequency.setValueAtTime(recipe.hz, at);
      if (recipe.drop) {
        osc.frequency.exponentialRampToValueAtTime(
          Math.max(20, recipe.hz - recipe.drop),
          at + recipe.decay,
        );
      }
      gain.gain.setValueAtTime(level, at);
      gain.gain.exponentialRampToValueAtTime(0.001, at + recipe.decay);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + recipe.decay + 0.02);
      return;
    }

    // Noise voice: one second of noise is generated once and reused, because
    // making a buffer per hit is what makes a drum machine stutter.
    const noise = this.noise(ctx);
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = recipe.cutoff ?? 4000;
    gain.gain.setValueAtTime(level, at);
    gain.gain.exponentialRampToValueAtTime(0.001, at + recipe.decay);
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start(at, Math.random() * 0.5, recipe.decay + 0.02);
  }

  private noiseBuffer?: AudioBuffer;

  private noise(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer) return this.noiseBuffer;
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noiseBuffer = buf;
    return buf;
  }

  // ---------------------------------------------------------------- the screen

  /** Redraw in Lua and paint the pixels it produced. */
  private async paint(): Promise<void> {
    const reply = await this.lua.render({
      // undefined tells Lua to draw no column, which is what stopped looks like
      playhead: this.state?.playing ? this.playheadStep : undefined,
      playing: this.state?.playing ?? false,
    });
    if (!reply.ok || !reply.pixels) {
      this.error = reply.error ?? 'render failed';
      return;
    }
    this.state = reply.state ?? this.state;
    this.frame = DrumgenLuaService.toFrame(reply.pixels);
    this.frameWidth = reply.pixels.width;
    this.frameHeight = reply.pixels.height;
    this.blit();
  }

  /**
   * Paint the frame at the current scale. A norns level 0..15 is 4 bits, so the
   * colour is that value scaled across the palette rather than a brightness
   * curve: the browser shows what the device shows.
   */
  private blit(): void {
    const canvas = this.canvas().nativeElement;
    const ctx = canvas.getContext('2d');
    if (!ctx || !this.frame) return;
    const scale = this.scale;
    const w = this.frameWidth * scale;
    const h = this.frameHeight * scale;
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    const image = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const srcRow = Math.floor(y / scale) * this.frameWidth;
      for (let x = 0; x < w; x++) {
        const level = this.frame[srcRow + Math.floor(x / scale)] ?? 0;
        const at = (y * w + x) * 4;
        const v = Math.round((level / 15) * 255);
        image.data[at] = v;
        image.data[at + 1] = v;
        image.data[at + 2] = v;
        image.data[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
  }

  setScale(scale: (typeof SCALES)[number]): void {
    this.scale = scale;
    this.blit();
  }

  // ------------------------------------------------------------------- controls

  /** Three knobs and three buttons, sent as the same JSON the device sends. */
  async send(events: { kind: 'enc' | 'key'; n: number; d?: number; z?: boolean }[]): Promise<void> {
    await this.startAudio();
    const reply = await this.lua.input(
      events.map((e) =>
        e.kind === 'enc'
          ? { kind: 'enc' as const, n: e.n, d: e.d ?? 0 }
          : { kind: 'key' as const, n: e.n, z: e.z ?? true },
      ),
    );
    if (!reply.ok) this.error = reply.error ?? 'input failed';
    if (reply.state) this.state = reply.state;
    // The PLAY key only toggles a flag in Lua; the clock has to follow it.
    await this.syncClock();
    await this.paint();
    this.cdr.markForCheck();
  }

  /** One detent. d is -3..3 like a real norns encoder. */
  async turn(n: number, d: number): Promise<void> {
    await this.send([{ kind: 'enc', n, d }]);
  }

  async press(n: number): Promise<void> {
    await this.send([{ kind: 'key', n, z: true }]);
  }

  /** FILL is not a key: on the device it is the third key, held. Here it is its own action. */
  async forceFill(): Promise<void> {
    const reply = await this.lua.tick({ force_fill: true });
    if (reply.ok && reply.state) this.state = reply.state;
    await this.paint();
    this.cdr.markForCheck();
  }

  private async setPlaying(playing: boolean): Promise<void> {
    const reply = await this.lua.set({ playing });
    if (reply.ok && reply.state) this.state = reply.state;
    // Forget which column was drawn, so a resume starts from step 1 instead of
    // waiting for that column to come round again.
    this.lastDrawnStep = undefined;
    await this.syncClock();
    await this.paint();
    this.cdr.markForCheck();
  }

  /** The param an encoder is turning right now, for the labels under the knobs. */
  paramFor(n: number): string {
    const s = this.state;
    if (!s) return '';
    if (s.swing_page) return 'swing';
    return s.enc_params[n - 1] ?? '';
  }

  /** The style names, for the readout. */
  get styleList(): string {
    return (this.state?.styles ?? []).join(' ');
  }

  /** The kit's note numbers, for the readout. */
  get kitNotes(): string {
    return (this.state?.voices ?? []).map((v) => v.note).join(' ');
  }

  /** A param as 0..100, for the readout. */
  percent(key: string): number {
    return Math.round((this.state?.params?.[key] ?? 0) * 100);
  }
}