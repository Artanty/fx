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

  // Workbench param grouping by body-byte range (C4 128-byte body layout),
  // organized into the same blocks as the official Source Audio Neuro editor.
  // `id` keys the per-block visibility toggle persisted in localStorage.
  // lfo_tempo (body 71..74, set-only 32-bit) has no live ctrl and is excluded.
  private readonly CONTROL_GROUPS: ReadonlyArray<{ id: string; title: string; indices: number[]; head: string }> = [
    { id: 'input', title: 'Input & level', head: '#3d7ea6', indices: this.range(0, 10) },
    { id: 'voice1', title: 'Voice 1', head: '#2e9e55', indices: this.range(10, 17) },
    { id: 'voice2', title: 'Voice 2', head: '#2e9e55', indices: this.range(17, 24) },
    { id: 'voice3', title: 'Voice 3', head: '#2e9e55', indices: this.range(24, 31) },
    { id: 'voice4', title: 'Voice 4', head: '#2e9e55', indices: this.range(31, 38) },
    { id: 'filter1', title: 'Filter 1 + Mix 1', head: '#2f8f8f', indices: this.range(38, 43) },
    { id: 'filter2', title: 'Filter 2 + Mix 2', head: '#6d8f2f', indices: this.range(43, 48) },
    { id: 'env1', title: 'Envelope 1', head: '#3d7ea6', indices: this.range(48, 52) },
    { id: 'env2', title: 'Envelope 2', head: '#3d7ea6', indices: this.range(52, 56) },
    { id: 'distortion', title: 'Distortion', head: '#a63d3d', indices: this.range(56, 60) },
    { id: 'fm', title: 'FM', head: '#2f8f8f', indices: this.range(60, 65) },
    { id: 'lfo', title: 'LFO', head: '#8a5fb5', indices: this.range(65, 71) },
    { id: 'seq1', title: 'Sequencer 1', head: '#b5792f', indices: this.range(75, 92) },
    { id: 'seq2', title: 'Sequencer 2', head: '#b5792f', indices: this.range(92, 109) },
    { id: 'harmony', title: 'Harmony', head: '#2e9e55', indices: this.range(109, 112) },
    { id: 'pitch', title: 'Pitch Detect', head: '#3d7ea6', indices: this.range(112, 114) },
    { id: 'knobs', title: 'Knobs', head: '#6d8f2f', indices: this.range(114, 116) },
    { id: 'routing', title: 'Routing & Misc', head: '#6d8f2f', indices: this.range(116, 117) },
    { id: 'external', title: 'External 1–3', head: '#6d8f2f', indices: this.range(117, 126) },
  ];
  private readonly BODY_LEN = 128;

  // Per-block visibility (true = shown), default all visible. Persisted in
  // localStorage so the user's chosen layout survives reloads.
  private readonly VIS_KEY = 'c4.blockVisibility.v1';
  private blockVisibility: Record<string, boolean> = {};
  logOpen = false;

  private _knobRowsCache: { id: string; title: string; head: string; controls: { spec: ControlSpec; p: SlotParam }[] }[] | null = null;
  private _knobRowsKey: readonly unknown[] | null = null;
  private _observeGroupsCache: { id: string; title: string; controls: ControlSpec[] }[] | null = null;
  private _observeGroupsKey: unknown = null;

  constructor(public api: C4ApiService, public midi: C4MidiService) {}

  private range(start: number, end: number): number[] {
    return Array.from({ length: end - start }, (_, i) => start + i);
  }

  private loadBlockVisibility(): void {
    this.blockVisibility = {};
    if (typeof window === 'undefined') return;
    let saved: Record<string, boolean> = {};
    try {
      saved = JSON.parse(localStorage.getItem(this.VIS_KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    for (const g of this.CONTROL_GROUPS) {
      this.blockVisibility[g.id] = saved[g.id] !== false;
    }
  }

  blockVisible(id: string): boolean {
    return this.blockVisibility[id] !== false;
  }

  get visibleGroupCount(): number {
    let n = 0;
    for (const g of this.knobGroups) {
      if (this.blockVisible(g.id)) n++;
    }
    return n;
  }

  // Row count for the 2-column block grid: fill the first column top-to-bottom,
  // then the second (column-major auto-placement needs a bounded row count).
  // block-bar spans row 1 of both columns, so add one row for it on top.
  get wgRows(): number {
    return 1 + Math.ceil(this.visibleGroupCount / 2);
  }

  toggleBlock(id: string): void {
    const title = this.CONTROL_GROUPS.find((g) => g.id === id)?.title ?? id;
    this.blockVisibility[id] = !this.blockVisible(id);
    this.logAction(`BLOCK ${title} ${this.blockVisibility[id] ? 'show' : 'hide'}`);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(this.VIS_KEY, JSON.stringify(this.blockVisibility));
      } catch {
        /* ignore storage errors */
      }
    }
  }

  get knobGroups(): { id: string; title: string; head: string; controls: { spec: ControlSpec; p: SlotParam }[] }[] {
    const key: readonly unknown[] = [this.slotParams, this.controlSpecsByIndex];
    if (this._knobRowsCache && this._knobRowsKey && this._knobRowsKey[0] === key[0] && this._knobRowsKey[1] === key[1])
      return this._knobRowsCache;
    this._knobRowsCache = this.CONTROL_GROUPS.map((g) => ({
      id: g.id,
      title: g.title,
      head: g.head,
      controls: g.indices
        .flatMap((i) => {
          const p = this.paramFor(i);
          if (!p) return [];
          return this.controlSpecsByIndex.get(i)?.map((spec) => ({ spec, p })) || [];
        })
        .sort((a, b) =>
          Number(this.isEngineSpec(b.spec)) - Number(this.isEngineSpec(a.spec)) ||
          // Filter + Mix blocks: keep the mix 'dest'/'out on' pair last (right).
          Number(this.isMixSpec(a.spec)) - Number(this.isMixSpec(b.spec)) ||
          a.spec.shift - b.spec.shift
        ),
    }));
    this._knobRowsKey = key;
    return this._knobRowsCache;
  }

  get observeGroups(): { id: string; title: string; controls: ControlSpec[] }[] {
    const key = this.controlSpecsByIndex;
    if (this._observeGroupsCache && this._observeGroupsKey === key) return this._observeGroupsCache;
    this._observeGroupsKey = key;
    this._observeGroupsCache = this.CONTROL_GROUPS.map((g) => ({
      id: g.id,
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
    this.loadBlockVisibility();
    // Fresh web session: reset the backend UI/operation log file (also reset on
    // backend boot). All subsequent logAction() lines land in this file.
    this.api.logReset().subscribe({
      next: () => this.logAction('session start'),
      error: () => {
        this.logAction('session start (log reset failed)');
      },
    });
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
    this.flushLogBatch();
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
    this.logAction(`ACTIVATE preset ${idx}`);
    this.api.activate(idx).subscribe({
      next: () => this.loadPresetParams(idx),
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Activate failed: ' + (e.message ?? e);
      },
    });
  }

  setTab(tab: 'workbench' | 'observe' | 'inspect'): void {
    if (this.activeTab === tab) return;
    this.activeTab = tab;
    this.logAction(`TAB ${tab}`);
    if (tab === 'observe') this.startMonitor();
    if (tab === 'inspect') this.openInspect();
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
    this.logAction(`MIRROR ${this.mirrorOn ? 'on' : 'off'}`);
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
    this.logAction(`OBSERVE-REFRESH ${this.monitorOn ? 'on' : 'off'}`);
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
  // All activity is kept in memory (right sidebar) AND mirrored to a file on the
  // backend (runtime-actions/c4-ui.log) so bugs can be traced after the fact.
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private logBatch: string[] = [];

  private logAction(msg: string): void {
    this.actionLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (this.actionLog.length > 500) this.actionLog.shift();
    this.logBatch.push(msg);
    if (!this.logTimer) {
      this.logTimer = setTimeout(() => this.flushLogBatch(), 250);
    }
  }

  private flushLogBatch(): void {
    this.logTimer = null;
    const batch = this.logBatch.splice(0);
    if (!batch.length) return;
    this.api.log(batch).subscribe({
      error: () => {
        if (batch.length) {
          this.logBatch.unshift(...batch);
          this.logTimer = setTimeout(() => this.flushLogBatch(), 1200);
        }
      },
    });
  }

  clearActionLog(): void {
    this.actionLog = [];
  }

  toggleLog(): void {
    this.logOpen = !this.logOpen;
    this.logAction(`LOG ${this.logOpen ? 'open' : 'closed'}`);
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
    // Sequencer steps hold signed semitone offsets: raw 0..48 = -24..+24
    // (two octaves each way). Cap editing there instead of the full byte.
    return this.isSeqStep(spec) ? 48 : spec.max;
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
        this.resendLiveOverrides();
      },
      error: (e) => {
        this.discreteInFlight = false;
        this.slotError = 'Commit failed: ' + (e.message ?? e);
      },
    });
  }

  // After a flash commit re-activates the preset the pedal reloads all live
  // controls from flash, which overwrites any transient CTRL_SET values the
  // user set via knobs but hasn't persisted yet.  Re-send every live control
  // that the user edited this session so their changes survive the re-activation.
  // Delayed 300ms to allow the firmware to finish loading the preset from flash
  // before we re-send CTRL_SET values, which could otherwise be overwritten.
  private resendLiveOverrides(): void {
    setTimeout(() => {
      const sent = new Set<number>();
      for (const key of Object.keys(this.editedOverrides)) {
        const bodyIdx = Number(key);
        const byteVal = this.editedOverrides[bodyIdx];
        const specs = this.controlSpecsByIndex.get(bodyIdx) || [];
        for (const s of specs) {
          if (s.liveIndex != null && !sent.has(s.liveIndex)) {
            sent.add(s.liveIndex);
            const fieldVal = (byteVal & s.mask) >>> s.shift;
            this.api.controlLive({ index: s.liveIndex, value: fieldVal }).subscribe({
              error: (e) => (this.slotError = 'Re-send failed: ' + (e.message ?? e)),
            });
          }
        }
      }
      if (sent.size) this.logAction(`RE-SEND ${sent.size} live controls after flash commit`);
    }, 300);
  }

  onSelectChange(spec: ControlSpec, p: SlotParam, field: number): void {
    const f = Number(field);
    if (!Number.isInteger(f) || this.fieldValue(spec, p) === f) return;
    this.setField(spec, p, f);
  }

  onSeqStepsChange(spec: ControlSpec, p: SlotParam, field: number): void {
    const f = Number(field);
    if (!Number.isInteger(f) || this.fieldValue(spec, p) === f) return;
    this.setField(spec, p, f);
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

  // Mix output controls (mixN_destination / mixN_enable) in the Filter X +
  // Mix X blocks render last, to the right of the filter controls.
  isMixSpec(spec: ControlSpec): boolean {
    return /^mix\d+_/.test(spec.name);
  }

  isSeqGroup(id: string): boolean {
    return id === 'seq1' || id === 'seq2';
  }

  seqLabel(spec: ControlSpec): string {
    const m = spec.name.match(/value(\d+)$/);
    return m ? 'step ' + (Number(m[1]) + 1) : spec.name.replace(/^sequencer\d_/, '');
  }

  // Compact knob/control labels. The block heading already conveys the family
  // (e.g. "Envelope 2", "Voice 1", "FM"), so strip that prefix and show the
  // differentiating word(s), with short abbreviations for long terms.
  private static readonly LABEL_EXACT: Readonly<Record<string, string>> = {
    // Input & level block
    input1_gain: 'gain 1',
    input2_gain: 'gain 2',
    master_depth: 'depth',
    output_balance: 'out bal',
    lo_retain: 'lo ret',
    // Voice blocks (suffix lookups, prefix stripped in ctlLabel)
    tremolo_source: 'trem src',
    pitch_track: 'pitch tr',
    // Filter + mix block toggles: distinguish the two 'on' switches
    filter1_enable: 'filter on',
    filter2_enable: 'filter on',
    mix1_enable: 'out on',
    mix2_enable: 'out on',
    // LFO block
    lfo_env_to_speed: 'env→speed',
    lfo_env_to_depth: 'env→depth',
    lfo_2_phase: '2φ',
    lfo_2_multiply: '2x',
    lfo_beat_division: 'beat /8',
    lfo_restart: 'retrig',
    // FM block
    fm_sine1_input: 'sine1 in',
    fm_sine2_input: 'sine2 in',
    mono_pitch_filter1: 'mono f1',
    mono_pitch_filter2: 'mono f2',
    // Harmony block
    harmony_tuning: 'tune',
    harmony_interval1: 'iv1',
    harmony_interval2: 'iv2',
    // Pitch detect block
    pitch_detect_low_note: 'low',
    pitch_detect_high_note: 'high',
    // Knob assigns block
    knob1_assign: 'knob 1',
    knob2_assign: 'knob 2',
    // Routing & misc block
    routing_option: 'routing',
    filter2_correction: 'corr',
    on_off_status: 'on/off',
    ext_control_enable: 'ext ctrl',
    lfo_midi_clock_sync: 'midi sync',
    // External 1-3 block
    ext1_destination: 'e1 dest',
    ext1_source: 'e1 src',
    ext2_destination: 'e2 dest',
    ext2_source: 'e2 src',
    ext3_destination: 'e3 dest',
    ext3_source: 'e3 src',
  };

  private static readonly LABEL_WORDS: Readonly<Record<string, string>> = {
    semitone: 'semi',
    frequency: 'freq',
    sensitivity: 'sens',
    envelope: 'env',
    destination: 'dest',
    modulate: 'mod',
    octave: 'oct',
    tremolo: 'trem',
    balance: 'bal',
    output: 'out',
    enable: 'on',
    invert: 'inv',
    source: 'src',
    gate: 'gate',
  };

  // human-readable prefix kept for controls whose numeric id must stay to
  // disambiguate them inside a shared block (ext1..3 -> e1..e3, distortion).
  private static readonly FAMILY: Readonly<Record<string, string>> = {
    distortion: 'dist',
    ext1: 'e1',
    ext2: 'e2',
    ext3: 'e3',
  };

  ctlLabel(spec: ControlSpec): string {
    const name = spec.name;
    const exact = C4Component.LABEL_EXACT[name];
    if (exact) return exact;

    // Strip a numeric block-family prefix (voice1_, filter2_, mix1_,
    // envelope2_) or a named one (distortion_, fm_, lfo_, harmony_,
    // pitch_detect_, extN_) — the block frame already says this family.
    let rest = name;
    let keepHead = '';
    const familyM = name.match(/^(?:voice|filter|mix|envelope)\d+_/);
    if (familyM) {
      rest = name.slice(familyM[0].length);
    } else {
      const fam = ['distortion_', 'pitch_detect_', 'harmony_', 'fm_', 'lfo_', 'ext1_', 'ext2_', 'ext3_'].find((f) => name.startsWith(f));
      if (fam) {
        keepHead = (C4Component.FAMILY[fam.slice(0, -1)] || '') + ' ';
        rest = name.slice(fam.length);
      }
    }

    const wordExact = C4Component.LABEL_EXACT[rest];
    if (wordExact) return (keepHead + wordExact).trim();

    // Abbreviate each remaining underscore-separated word.
    const words = rest
      .split('_')
      .map((w) => C4Component.LABEL_WORDS[w] || w)
      .filter(Boolean);
    const label = words.join(' ');
    return (keepHead + label).trim() || name;
  }

  seqCellBg(spec: ControlSpec, p: SlotParam): string {
    // Sequencer steps are semitone offsets from root: raw 0..48 maps to
    // -24..+24 (manual: up/down two octaves). Height = sharpness relative
    // to that range, so a step a twelfth above shows taller than root.
    const raw = this.fieldValue(spec, p);
    const frac = Math.max(0, Math.min(1, raw / 48));
    const a = 0.12 + 0.88 * frac;
    return `rgba(80, 190, 255, ${a.toFixed(3)})`;
  }

  // Steps raw value is one behind the count (2..16 stored as 0..14).
  // Returns the number of active steps for this sequencer group.
  seqStepCount(group: { controls: { spec: ControlSpec; p: SlotParam }[] }): number {
    const st = group.controls.find((c) => /_steps$/.test(c.spec.name));
    return st ? Math.min(16, this.fieldValue(st.spec, st.p) + 2) : 16;
  }

  // A step square is active if its index < active step count.
  seqStepActive(it: { spec: ControlSpec; p: SlotParam }, group: { controls: { spec: ControlSpec; p: SlotParam }[] }): boolean {
    const m = it.spec.name.match(/value(\d+)$/);
    if (!m) return true;
    return Number(m[1]) < this.seqStepCount(group);
  }

  // Display a sequencer step as a signed semitone offset (raw - 24).
  seqSemiText(spec: ControlSpec, p: SlotParam): string {
    const raw = this.fieldValue(spec, p);
    const s = raw - 24;
    if (s < -24 || s > 24) return raw === 255 ? '—' : String(raw);
    return s > 0 ? '+' + s : String(s);
  }

  // Mode (harmony/sequencer) is meaningless for unpitched input sources, so
  // the Neuro app disables it. source field indices for VOICE_SOURCES:
  // 0 Stereo Input Mix, 11 Mono Input 1, 12 Mono Input 2.
  private static readonly SIMPLE_SOURCES = new Set([0, 11, 12]);

  voiceModeDisabled(group: { controls: { spec: ControlSpec; p: SlotParam }[] }, spec: ControlSpec): boolean {
    const m = spec.name.match(/^(voice\d+)_mode$/);
    if (!m) return false;
    const src = group.controls.find((c) => c.spec.name === m[1] + '_source');
    return !!src && C4Component.SIMPLE_SOURCES.has(this.fieldValue(src.spec, src.p));
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
    const scale = this.isSeqStep(spec) ? 1 : 4;
    const v = Math.max(0, Math.min(this.toUIMax(spec), Math.round(this.fieldValue(spec, p) + dy * scale)));
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
    const step = this.isSeqStep(spec) ? 1 : 8;
    const v = Math.max(0, Math.min(this.toUIMax(spec), Math.round(this.fieldValue(spec, p) + (e.deltaY < 0 ? step : -step))));
    this.setField(spec, p, v);
  }

  // Sequencer step squares edit in whole semitones (one notch = 1 semi),
  // unlike the coarse 8-unit wheel/4-unit drag of normal knobs.
  private isSeqStep(spec: ControlSpec): boolean {
    return /^sequencer\d_value\d*$/.test(spec.name);
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