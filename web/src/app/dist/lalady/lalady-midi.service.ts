import { Injectable } from '@angular/core';

// Minimal structural types for the Web MIDI API (not part of the default DOM
// lib), so we don't need the @types/webmidi dependency.
interface MidiOutput {
  id?: string;
  name?: string;
  send?: (data: number[], timestamp?: number) => void;
}
interface MidiAccess {
  outputs?: Map<string, MidiOutput>;
}

// Browser-native MIDI control for the Source Audio L.A. Lady, using the Web MIDI
  // API (no backend / Python needed). The pedal listens on a configurable channel
  // (1-based). Engage/bypass is bound to CC 102 (configured in Neuro).
  @Injectable({ providedIn: 'root' })
  export class LaladyMidiService {
  // Input channel (1-based), defaulting to a Source Audio channel. The backend
  // config reports midiChannel 0-based; callers pass channel+1.
  channel = 3;
  cc = 102;

  private midi: MidiAccess | null = null;
  private output: MidiOutput | null = null;
  private ready: Promise<boolean> | null = null;

  private init(): Promise<boolean> {
    const nav = navigator as unknown as { requestMIDIAccess?: () => Promise<MidiAccess> };
    if (typeof nav.requestMIDIAccess !== 'function') {
      return Promise.resolve(false);
    }
    return nav
      .requestMIDIAccess()
      .then((midi: MidiAccess) => {
        this.midi = midi;
        this.pickOutput();
        return !!this.output;
      })
      .catch(() => false);
  }

  private pickOutput(): void {
    if (!this.midi || !this.midi.outputs) return;
    const outs = Array.from(this.midi.outputs.values());
    this.output =
      outs.find((o) => /source ?audio|one ?series/i.test(o.name || '')) ||
      outs[0] ||
      null;
  }

  private get readyPromise(): Promise<boolean> {
    if (!this.ready) this.ready = this.init();
    return this.ready;
  }

  isSupported(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess ===
        'function'
    );
  }

  async available(): Promise<boolean> {
    return this.readyPromise;
  }

  // Send a generic CC on the configured channel. value: 0..127.
  async sendCc(cc: number, value: number): Promise<boolean> {
    const ok = await this.readyPromise;
    if (!ok || !this.output || typeof this.output.send !== 'function') return false;
    const status = 0xb0 | ((this.channel - 1) & 0x0f);
    this.output.send([status, cc & 0x7f, value & 0x7f]);
    return true;
  }

  // Engage/bypass shortcut (CC 102 on the configured channel).
  // value: 0 = off (bypass), 127 = on (engage).
  async send(value: number): Promise<boolean> {
    return this.sendCc(this.cc, value);
  }
}
