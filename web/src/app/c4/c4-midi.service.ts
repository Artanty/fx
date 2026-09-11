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

// Browser-native MIDI control for the Source Audio C4 Synth, using the Web MIDI
// API (no backend needed). Engage/bypass is bound to CC 102 on the configured
// channel (same One Series convention as the L.A. Lady).
@Injectable({ providedIn: 'root' })
export class C4MidiService {
  // Input channel (1-based). The backend config reports midiChannel 0-based;
  // callers pass channel + 1.
  channel = 1;
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
  // whichever port enumerates first — sending this pedal's engage to the wrong
  // port. CC 102 is channel-scoped, so the pedal whose configured channel we
  // send on is the only one that reacts.
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
      typeof (navigator as unknown as { requestMIDIAccess?: unknown }).requestMIDIAccess === 'function'
    );
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
  async send(value: number): Promise<boolean> {
    return this.sendCc(this.cc, value);
  }
}