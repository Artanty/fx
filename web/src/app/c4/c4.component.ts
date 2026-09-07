import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { C4ApiService } from './c4-api.service';
import { C4MidiService } from './c4-midi.service';
import {
  ControlSpec,
  EepromData,
  LiveControls,
  MidiMap,
  PresetSummary,
  SlotParam,
  SlotParams,
} from './c4.models';

@Component({
  selector: 'app-c4',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './c4.component.html',
  styleUrl: './c4.component.scss',
})
export class C4Component implements OnInit, OnDestroy {
  activeTab: 'workbench' | 'observe' | 'inspect' = 'workbench';

  deviceFound = false;
  deviceError: string | null = null;
  loading = true;

  // All 128 preset names (for the location picker).
  presetOptions: PresetSummary[] = [];
  selectedPresetIdx: number | null = null;

  // Workbench state for the selected preset (the 128-byte flash body).
  slotParams: SlotParams | null = null;
  slotBusy = false;
  slotError: string | null = null;
  slotsDirty = false;
  private paramsSnapshot: SlotParam[] = [];
  private editedOverrides: Record<number, number> = {};

  // Control map (GET /api/control-map): how each body byte decomposes into
  // UI controls. spec.index is the body byte; spec.liveIndex (when present)
  // is the live CTRL_SET write index for whole-byte controls.
  controlMap: ControlSpec[] = [];
  private controlSpecsByIndex = new Map<number, ControlSpec[]>();

  // Pedal config (MIDI channel etc.) from GET /api/status.
  config: { midiChannel: number; firmwareVersion?: number; activePreset?: number; raw?: string } | null = null;

  // Browser-native MIDI engage/bypass (CC 102 on the configured channel).
  midiEngageSupported = false;
  midiBypassed = true;
  midiEngageMsg: string | null = null;

  // Operator action log (same spirit as the L.A. Lady workbench).
  actionLog: string[] = [];
  actionLogOpen = false;

  // Observe tab: read-only live view (active preset's flash body).
  monitor: LiveControls | null = null;
  monitorOn = false;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MONITOR_POLL_MS = 5000;

  // Workbench live mirror: opt-in low-rate poll of /api/controls that moves the
  // workbench knobs to the pedal's current active preset. Only reconciled when
  // the pedal's active preset equals the selected one, and never over bytes the
  // user edited this session (so fresh edits never get stomped).
  mirrorOn = false;
  private mirrorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MIRROR_POLL_MS = 2000;

  // Inspect tab.
  inspectData: EepromData | null = null;
  inspectMidi: MidiMap | null = null;
  inspectBusy = false;
  inspectError: string | null = null;

  // Workbench param grouping by body-byte range (C4 128-byte body layout).
  // lfo_tempo (body 71..74, set-only 32-bit) has no live ctrl and is excluded.
  private readonly CONTROL_GROUPS = [
    { title: 'Input & level', indices: this.range(0, 10) },
    { title: 'Voice 1', indices: this.range(10, 17) },
    { title: 'Voice 2', indices: this.range(17, 24) },
    { title: 'Voice 3', indices: this.range(24, 31) },
    { title: 'Voice 4', indices: this.range(31, 38) },
    { title: 'Filters & mix', indices: this.range(38, 48) },
    { title: 'Envelopes', indices: this.range(48, 56) },
    { title: 'Distortion', indices: this.range(56, 60) },
    { title: 'FM', indices: this.range(60, 65) },
    { title: 'LFO', indices: this.range(65, 71) },
    { title: 'Sequencer 1', indices: this.range(75, 92) },
    { title: 'Sequencer 2', indices: this.range(92, 109) },
    { title: 'Harmony & pitch', indices: this.range(109, 114) },
    { title: 'Knobs & external', indices: this.range(114, 126) },
  ];
  private readonly KNOB_ROWS = [
    [0, 5],
    [1, 6],
    [2, 7],
    [3, 8],
    [4, 9],
    [10],
    [11],
    [12, 13],
  ];
  private readonly BODY_LEN = 128;

  private _knobRowsCache: { title: string; controls: { spec: ControlSpec; p: SlotParam }[] }[][] | null = null;
  private _knobRowsKey: readonly unknown[] | null = null;
  private _observeGroupsCache: { title: string; controls: ControlSpec[] }[] | null = null;
  private _observeGroupsKey: unknown = null;

  constructor(public api: C4ApiService, public midi: C4MidiService) {}

  private range(start: number, end: number): number[] {
    return Array.from({ length: end - start }, (_, i) => start + i);
  }

  get knobRows(): { title: string; controls: { spec: ControlSpec; p: SlotParam }[] }[][] {
    const key: readonly unknown[] = [this.slotParams, this.controlSpecsByIndex];
    if (this._knobRowsCache && this._knobRowsKey && this._knobRowsKey[0] === key[0] && this._knobRowsKey[1] === key[1])
      return this._knobRowsCache;
    const groups = this.CONTROL_GROUPS.map((g) => ({
      title: g.title,
      controls: g.indices
        .flatMap((i) => {
          const p = this.paramFor(i);
          if (!p) return [];
          return this.controlSpecsByIndex.get(i)?.map((spec) => ({ spec, p })) || [];
        })
        .sort((a, b) => Number(this.isEngineSpec(b.spec)) - Number(this.isEngineSpec(a.spec)) || a.spec.shift - b.spec.shift),
    }));
    this._knobRowsKey = key;
    this._knobRowsCache = this.KNOB_ROWS.map((rowIdx) => rowIdx.map((gi) => groups[gi]));
    return this._knobRowsCache;
  }

  get observeGroups(): { title: string; controls: ControlSpec[] }[] {
    const key = this.controlSpecsByIndex;
    if (this._observeGroupsCache && this._observeGroupsKey === key) return this._observeGroupsCache;
    this._observeGroupsKey = key;
    this._observeGroupsCache = this.CONTROL_GROUPS.map((g) => ({
      title: g.title,
      controls: g.indices
        .flatMap((i) => this.controlSpecsByIndex.get(i) || [])
        .sort((a, b) => a.shift - b.shift),
    }));
    return this._observeGroupsCache;
  }

  observeNative(spec: ControlSpec): number | null {
    if (!this.monitor?.params) return null;
    const p = this.monitor.params.find((x) => x.index === spec.index);
    if (!p) return null;
    return (p.value & spec.mask) >>> spec.shift;
  }

  observeLabel(spec: ControlSpec): string {
    const native = this.observeNative(spec);
    if (native == null) return '—';
    if (spec.type === 'toggle') return native === 1 ? 'ON' : 'OFF';
    return String(native);
  }

  observeActiveLabel(): string {
    const m = this.monitor;
    if (!m || typeof m.activeIndex !== 'number') return '';
    return `Active preset #${m.activeIndex}${m.presetName ? ' — ' + m.presetName : ''}`;
  }

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      (window as unknown as { __c4Actions?: string[] }).__c4Actions = this.actionLog;
    }
    this.midiEngageSupported = this.midi.isSupported();
    this.refresh();
    this.refreshDevice();
    this.api.controlMap().subscribe({
      next: (r) => {
        this.controlMap = r.controls || [];
        this.controlSpecsByIndex = new Map();
        for (const s of this.controlMap) {
          const list = this.controlSpecsByIndex.get(s.index) || [];
          list.push(s);
          this.controlSpecsByIndex.set(s.index, list);
        }
      },
      error: () => (this.controlMap = []),
    });
  }

  ngOnDestroy(): void {
    this.stopMonitor();
    this.stopMirror();
  }

  refresh(): void {
    this.loading = true;
    this.api.device().subscribe({
      next: (d) => {
        this.deviceFound = d.found;
        this.deviceError = d.found ? null : 'C4 Synth not connected';
        if (d.found) this.loadPresets();
        else this.loading = false;
      },
      error: (e) => {
        this.deviceFound = false;
        this.deviceError = 'Cannot reach c4 backend (http://localhost:3222): ' + (e.message ?? e);
        this.loading = false;
      },
    });
  }

  private loadPresets(): void {
    this.api.presets().subscribe({
      next: (r) => {
        this.presetOptions = r.presets || [];
        this.loading = false;
        this.autoSelectActive();
      },
      error: (e) => {
        this.deviceError = 'Failed to load preset list: ' + (e.message ?? e);
        this.loading = false;
      },
    });
  }

  refreshDevice(): void {
    this.api.status().subscribe({
      next: (s) => {
        this.config = s.config;
        this.midi.channel = (s.config.midiChannel ?? 0) + 1;
      },
      error: () => (this.config = null),
    });
  }

  // On a fresh session, load the pedal's currently-active preset (read-only:
  // never issues ACTIVE_SET on page load).
  private autoSelectActive(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (m && typeof m.activeIndex === 'number' && this.selectedPresetIdx === null) {
          const idx = m.activeIndex;
          if (Number.isInteger(idx) && idx >= 0 && idx < this.BODY_LEN) this.loadPresetParams(idx);
        }
      },
      error: () => {
        /* device offline */
      },
    });
  }

  presetName(idx: number): string {
    const p = this.presetOptions.find((x) => x.idx === idx);
    return p ? (p.name || '(unnamed)') : String(idx);
  }

  // Activate preset `idx` on the pedal, then load its params from its flash body.
  selectPreset(idx: number): void {
    if (this.selectedPresetIdx === idx && this.slotParams) return;
    this.slotBusy = true;
    this.slotError = null;
    this.api.activate(idx).subscribe({
      next: () => this.loadPresetParams(idx),
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Activate failed: ' + (e.message ?? e);
      },
    });
  }

  private loadPresetParams(idx: number): void {
    this.api.preset(idx).subscribe({
      next: (s) => {
        this.slotBusy = false;
        this.selectedPresetIdx = idx;
        this.slotParams = s;
        this.paramsSnapshot = s.params.map((p) => ({ ...p }));
        this.slotsDirty = false;
        this.editedOverrides = {};
        this.logAction(`LOAD preset ${idx} (${s.name || 'unnamed'})`);
      },
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Load params failed: ' + (e.message ?? e);
      },
    });
  }

  // Persist the current edited state to the selected preset, then recall it.
  savePreset(): void {
    if (!this.slotParams || this.selectedPresetIdx === null) return;
    this.slotBusy = true;
    this.slotError = null;
    const keys = Object.keys(this.editedOverrides);
    this.logAction(`SAVE preset ${this.selectedPresetIdx} overrides=${keys.length}`);
    this.api
      .slotSave({ idx: this.selectedPresetIdx, overrides: this.editedOverrides })
      .subscribe({
        next: (r) => {
          this.slotBusy = false;
          if (!r.ok || r.error) {
            this.slotError = r.error || 'Save failed';
            return;
          }
          this.loadPresetParams(this.selectedPresetIdx!);
        },
        error: (e) => {
          this.slotBusy = false;
          this.slotError = 'Save failed: ' + (e.message ?? e);
        },
      });
  }

  revertPreset(): void {
    if (!this.slotParams) return;
    this.slotParams.params = this.paramsSnapshot.map((p) => ({ ...p }));
    this.slotsDirty = false;
    this.editedOverrides = {};
    this.logAction('REVERT: workbench returned to snapshot');
  }

  allParamsZero(): void {
    if (!this.slotParams) return;
    this.slotError = null;
    const sentLive = new Set<number>();
    for (const p of this.slotParams.params) {
      p.value = 0;
      this.editedOverrides[p.index] = 0;
      this.slotsDirty = true;
      const specs = this.controlSpecsByIndex.get(p.index) || [];
      for (const s of specs) {
        if (s.liveIndex != null && !sentLive.has(s.liveIndex)) {
          sentLive.add(s.liveIndex);
          this.queueLive(s, 0);
        }
      }
    }
    this.logAction(`ZERO all ${this.BODY_LEN} bytes live=${sentLive.size}`);
  }

  // --- Live mirror / observe --------------------------------------------------
  toggleMirror(): void {
    if (this.mirrorOn) this.stopMirror();
    else this.startMirror();
  }

  private startMirror(): void {
    if (this.mirrorTimer) return;
    this.mirrorOn = true;
    this.mirrorControls();
    this.mirrorTimer = setInterval(() => this.mirrorControls(), this.MIRROR_POLL_MS);
  }

  private stopMirror(): void {
    if (this.mirrorTimer) {
      clearInterval(this.mirrorTimer);
      this.mirrorTimer = null;
    }
    this.mirrorOn = false;
  }

  // Reconcile workbench fields from the ACTIVE preset's flash body. Only when
  // the pedal's active preset equals the selected one, and only for bytes the
  // user has NOT edited this session (editedOverrides) or is currently dragging.
  private mirrorControls(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (!m || !Array.isArray(m.params) || !this.slotParams) return;
        if (m.activeIndex !== this.selectedPresetIdx) return;
        const body = new Map<number, number>();
        for (const p of m.params) body.set(p.index, p.value);
        for (const s of this.controlMap) {
          if (this.editedOverrides[s.index] !== undefined) continue;
          if (this.activeKnob && this.activeKnob.spec === s) continue;
          const live = body.get(s.index);
          if (typeof live !== 'number') continue;
          const p = this.paramFor(s.index);
          if (!p) continue;
          const nativeField = Math.max(0, Math.min(s.max, (live & s.mask) >>> s.shift));
          if (this.fieldValue(s, p) === nativeField) continue;
          this.logAction(`OBSERVE ${s.name} byte ${s.index}: field ${this.fieldValue(s, p)}->${nativeField}`);
          p.value = (p.value & ~s.mask) | ((nativeField << s.shift) & s.mask);
          const snap = this.paramsSnapshot.find((sp) => sp.index === p.index);
          if (snap) snap.value = p.value;
        }
      },
      error: () => {
        /* device offline; keep last-known values */
      },
    });
  }

  private pollControls(): void {
    this.api.controls().subscribe({
      next: (m) => (this.monitor = m),
      error: (e) => {
        this.monitor = null;
        this.deviceError = 'Monitor failed: ' + (e.message ?? e);
        this.stopMonitor();
      },
    });
  }

  toggleMonitor(): void {
    if (this.monitorOn) this.stopMonitor();
    else this.startMonitor();
  }

  startMonitor(): void {
    if (this.monitorTimer) return;
    this.monitorOn = true;
    this.pollControls();
    this.monitorTimer = setInterval(() => this.pollControls(), this.MONITOR_POLL_MS);
  }

  private stopMonitor(): void {
    if (this.monitorTimer) {
      clearInterval(this.monitorTimer);
      this.monitorTimer = null;
    }
    this.monitorOn = false;
  }

  // --- Action log ------------------------------------------------------------
  private logAction(msg: string): void {
    this.actionLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (this.actionLog.length > 500) this.actionLog.shift();
  }

  clearActionLog(): void {
    this.actionLog = [];
  }

  lastActionLines(n: number): string[] {
    return this.actionLog.slice(-n);
  }

  // --- Field helpers & write routing ------------------------------------------
  paramFor(index: number): SlotParam | null {
    if (!this.slotParams) return null;
    return this.slotParams.params.find((p) => p.index === index) ?? null;
  }

  fieldValue(spec: ControlSpec, p: SlotParam): number {
    return (p.value & spec.mask) >>> spec.shift;
  }

  private toUIMax(spec: ControlSpec): number {
    return spec.max;
  }

  // Record a changed field and route the write: fields with a 1:1 live control
  // (whole-byte, spec.liveIndex) go realtime via CTRL_SET; packed/body-only
  // fields (no live) go to a debounced flash commit of the FULL composed byte.
  private setField(spec: ControlSpec, p: SlotParam, uiValue: number): void {
    const native = Math.max(0, Math.min(spec.max, uiValue));
    const prevField = this.fieldValue(spec, p);
    const prevByte = p.value;
    const byte = (p.value & ~spec.mask) | ((native << spec.shift) & spec.mask);
    p.value = byte;
    this.slotsDirty = true;
    this.editedOverrides[p.index] = byte;
    this.logAction(
      `SET ${spec.name} (${spec.index}:${spec.shift}) field ${prevField}->${native} byte 0x${prevByte
        .toString(16)
        .padStart(2, '0')}->0x${byte.toString(16).padStart(2, '0')} ${spec.liveIndex != null ? 'LIVE#' + spec.liveIndex : 'FLASH'}`
    );
    if (spec.liveIndex != null) {
      this.queueLive(spec, native);
      return;
    }
    this.discretePending = { p, byte };
    if (this.discreteTimer) return;
    this.discreteTimer = setTimeout(() => {
      this.discreteTimer = null;
      this.flushDiscrete();
    }, 300);
  }

  // Realtime: CTRL_SET at the control's LIVE index (whole-byte fields).
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  private livePending = new Map<number, { spec: ControlSpec; value: number }>();
  private queueLive(spec: ControlSpec, value: number): void {
    this.livePending.set(spec.liveIndex!, { spec, value });
    if (this.liveTimer) return;
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      for (const [liveIndex, { value: v }] of this.livePending) {
        this.logAction(`LIVE idx=${liveIndex} val=${v}`);
        this.api.controlLive({ index: liveIndex, value: v }).subscribe({
          error: (e) => (this.slotError = 'Realtime set failed: ' + (e.message ?? e)),
        });
      }
      this.livePending.clear();
    }, 40);
  }

  // Debounced flash commit for packed/bit-field controls: writes the FULL byte
  // (composed from the sibling bits already in p.value) via /api/control.
  private discreteTimer: ReturnType<typeof setTimeout> | null = null;
  private discretePending: { p: SlotParam; byte: number } | null = null;
  private discreteInFlight = false;

  private flushDiscrete(): void {
    const v = this.discretePending;
    if (!v || this.discreteInFlight) return;
    this.discreteInFlight = true;
    this.discretePending = null;
    this.api.control({ index: v.p.index, value: v.byte }).subscribe({
      next: (r) => {
        this.discreteInFlight = false;
        if (r && typeof r.readback === 'number') {
          if (!this.discretePending || this.discretePending.p.index !== v.p.index) {
            const pr = this.paramFor(v.p.index);
            if (pr) pr.value = r.readback;
          }
          this.logAction(`FLASH byte ${v.p.index} 0x${v.byte.toString(16).padStart(2, '0')} readback=0x${r.readback.toString(16).padStart(2, '0')}`);
        }
        this.flushDiscrete();
      },
      error: (e) => {
        this.discreteInFlight = false;
        this.slotError = 'Commit failed: ' + (e.message ?? e);
      },
    });
  }

  onSelectChange(spec: ControlSpec, p: SlotParam, event: Event): void {
    const field = Number((event.target as HTMLSelectElement).value);
    if (!Number.isInteger(field) || this.fieldValue(spec, p) === field) return;
    this.setField(spec, p, field);
  }

  onToggleChange(spec: ControlSpec, p: SlotParam, event: Event): void {
    const on = (event.target as HTMLInputElement).checked ? 1 : 0;
    if (this.fieldValue(spec, p) === on) return;
    this.setField(spec, p, on);
  }

  selectOptionSelected(spec: ControlSpec, p: SlotParam, opt: { value: number }): boolean {
    return this.fieldValue(spec, p) === opt.value;
  }

  selectValueKnown(spec: ControlSpec, p: SlotParam): boolean {
    return !!spec.options?.some((o) => o.value === this.fieldValue(spec, p));
  }

  optionRange(spec: ControlSpec): number[] {
    return Array.from({ length: spec.max + 1 }, (_, i) => i);
  }

  // Discrete selects (2..6 bits) render full-width of their group so the
  // numeric range is legible.
  isEngineSpec(spec: ControlSpec): boolean {
    return spec.type === 'select' && spec.max >= 24;
  }

  fieldChanged(spec: ControlSpec, p: SlotParam): boolean {
    const snap = this.paramsSnapshot.find((s) => s.index === p.index);
    return !!snap && this.fieldValue(spec, snap) !== this.fieldValue(spec, p);
  }

  // --- Knob geometry + interaction -------------------------------------------
  private knobAngle(spec: ControlSpec, p: SlotParam): number {
    return 135 + (this.fieldValue(spec, p) / this.toUIMax(spec)) * 270;
  }

  pointerX(spec: ControlSpec, p: SlotParam): number {
    return 20 + 13 * Math.cos((this.knobAngle(spec, p) * Math.PI) / 180);
  }

  pointerY(spec: ControlSpec, p: SlotParam): number {
    return 20 + 13 * Math.sin((this.knobAngle(spec, p) * Math.PI) / 180);
  }

  arcDash(spec: ControlSpec, p: SlotParam): string {
    const frac = this.fieldValue(spec, p) / this.toUIMax(spec);
    const C = 2 * Math.PI * 16;
    return `${(C * frac).toFixed(2)} ${C.toFixed(2)}`;
  }

  arcRotate(): number {
    return 135;
  }

  private activeKnob: { spec: ControlSpec; p: SlotParam; lastY: number } | null = null;
  hoveredParam: SlotParam | null = null;

  onKnobEnter(spec: ControlSpec, p: SlotParam): void {
    if (this.hoveredParam === p && this.activeKnob === null) return;
    this.hoveredParam = p;
    this.activeKnob = null;
  }

  onKnobLeave(): void {
    this.hoveredParam = null;
    this.activeKnob = null;
  }

  knobDown(e: PointerEvent, spec: ControlSpec, p: SlotParam): void {
    this.hoveredParam = p;
    if (this.hoveredParam !== p) return;
    this.activeKnob = { spec, p, lastY: e.clientY };
    e.preventDefault();
  }

  knobMove(e: PointerEvent, spec: ControlSpec, p: SlotParam): void {
    if (!this.activeKnob || this.activeKnob.p !== p) return;
    const dy = this.activeKnob.lastY - e.clientY;
    this.activeKnob.lastY = e.clientY;
    const v = Math.max(0, Math.min(this.toUIMax(spec), Math.round(this.fieldValue(spec, p) + dy * 4)));
    this.setField(spec, p, v);
    e.preventDefault();
  }

  knobUp(e: PointerEvent, p: SlotParam): void {
    if (!this.activeKnob || this.activeKnob.p !== p) return;
    this.activeKnob = null;
    e.preventDefault();
  }

  knobWheel(e: WheelEvent, spec: ControlSpec, p: SlotParam): void {
    e.preventDefault();
    const v = Math.max(0, Math.min(this.toUIMax(spec), Math.round(this.fieldValue(spec, p) + (e.deltaY < 0 ? 8 : -8))));
    this.setField(spec, p, v);
  }

  // --- MIDI engage/bypass -----------------------------------------------------
  async toggleMidiEngage(): Promise<void> {
    this.midi.channel = this.config ? (this.config.midiChannel ?? 0) + 1 : 1;
    const value = this.midiBypassed ? 127 : 0;
    const ok = await this.midi.send(value);
    if (ok) {
      this.midiBypassed = value === 0;
      this.midiEngageMsg = null;
    } else {
      this.midiEngageMsg = 'Web MIDI unavailable — open in Chrome/Edge on http://localhost';
    }
  }

  // --- Inspect ----------------------------------------------------------------
  openInspect(): void {
    this.activeTab = 'inspect';
    if (!this.inspectData) this.loadInspect();
  }

  loadInspect(): void {
    this.inspectBusy = true;
    this.inspectError = null;
    let done = 0;
    const check = () => {
      if (++done === 2) this.inspectBusy = false;
    };
    this.api.eeprom().subscribe({
      next: (d) => {
        this.inspectData = d;
        check();
      },
      error: (e) => {
        this.inspectError = 'EEPROM load failed: ' + (e.message ?? e);
        this.inspectBusy = false;
      },
    });
    this.api.midimap().subscribe({
      next: (d) => {
        this.inspectMidi = d;
        check();
      },
      error: () => check(),
    });
  }

  formatHex(hex: string, bytesPerLine = 8): string {
    const lines: string[] = [];
    for (let i = 0; i < hex.length; i += bytesPerLine * 2) {
      const chunk = hex.substring(i, i + bytesPerLine * 2);
      const spaced = chunk.match(/.{1,2}/g)?.join(' ') || chunk;
      const offset = (i / 2).toString(16).padStart(2, '0');
      lines.push(offset + ': ' + spaced);
    }
    return lines.join('\n');
  }
}