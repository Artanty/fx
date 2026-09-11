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
  private outputs: MidiOutput[] = [];
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
        this.pickOutputs();
        return this.outputs.length > 0;
      })
      .catch(() => false);
  }

  // Target EVERY Source Audio MIDI output, not just the first match: when two
  // One Series pedals are connected at once, outs.find() binds the button to
  // whichever port enumerates first — so the L.A. Lady engage could be sent to
  // the C4's port and never reach this pedal. CC 102 is channel-scoped, so the
  // pedal whose configured channel we send on is the only one that reacts.
  private pickOutputs(): void {
    if (!this.midi || !this.midi.outputs) return;
    const outs = Array.from(this.midi.outputs.values());
    if (!outs.length) return;
    this.outputs = outs.filter((o) => /source ?audio|one ?series/i.test(o.name || ''));
    if (!this.outputs.length) this.outputs = [outs[0]];
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
    if (!ok || !this.outputs.length) return false;
    const status = 0xb0 | ((this.channel - 1) & 0x0f);
    for (const out of this.outputs) {
      if (typeof out.send !== 'function') continue;
      out.send([status, cc & 0x7f, value & 0x7f]);
    }
    return true;
  }

  // Engage/bypass shortcut (CC 102 on the configured channel).
  // value: 0 = off (bypass), 127 = on (engage).
  async send(value: number): Promise<boolean> {
    return this.sendCc(this.cc, value);
  }
}
