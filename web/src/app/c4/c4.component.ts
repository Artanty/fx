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
  RandomizeGroup,
  RandomizePreset,
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

  // Per-control "was this change applied?" indicator (same as L.A. Lady). Flash
  // commits lag the knob edit (300ms debounce + a ~2s flash/recall cycle), so a
  // knob that "didn't do anything yet" is confusing. Every control shows a small
  // badge tracking its apply lifecycle: 'pending' (queued) → 'writing' (flash in
  // progress) → 'applied' (readback confirmed, fades after APPLIED_KEEP_MS). The
  // global commit strip mirrors pending count + the most recently applied control.
  //
  // Keyed by FIELD (index:shift), NOT body byte: packed bytes hold several
  // controls, so a byte-scoped badge would light every sibling at once.
  private flashPhase = new Map<string, 'pending' | 'writing' | 'applied'>();
  private flashPhaseTimers = new Map<string, ReturnType<typeof setTimeout>>();
  lastAppliedName: string | null = null;
  private readonly APPLIED_KEEP_MS = 2800;

  get flashPendingCount(): number {
    let n = 0;
    for (const ph of this.flashPhase.values()) if (ph !== 'applied') n++;
    return n;
  }

  flashPhaseFor(spec: ControlSpec): string {
    return this.flashPhase.get(this.fieldKey(spec)) ?? '';
  }

  private fieldKey(spec: ControlSpec): string {
    return `${spec.index}:${spec.shift}`;
  }

  // Set the apply phase for a control; 'applied' auto-fades after APPLIED_KEEP_MS.
  private setFlashPhase(spec: ControlSpec, phase: 'pending' | 'writing' | 'applied'): void {
    const key = this.fieldKey(spec);
    const t = this.flashPhaseTimers.get(key);
    if (t) {
      clearTimeout(t);
      this.flashPhaseTimers.delete(key);
    }
    if (phase === 'applied') {
      this.flashPhase.set(key, 'applied');
      this.lastAppliedName = spec.name;
      this.flashPhaseTimers.set(
        key,
        setTimeout(() => {
          this.flashPhase.delete(key);
          if (this.lastAppliedName === spec.name) this.lastAppliedName = null;
          this.flashPhaseTimers.delete(key);
        }, this.APPLIED_KEEP_MS)
      );
    } else {
      this.flashPhase.set(key, phase);
    }
  }

  private clearFlashPhases(): void {
    for (const t of this.flashPhaseTimers.values()) clearTimeout(t);
    this.flashPhaseTimers.clear();
    this.flashPhase.clear();
    this.lastAppliedName = null;
  }

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
    { id: 'seq1', title: 'Seq 1', head: '#b5792f', indices: this.range(75, 92) },
    { id: 'seq2', title: 'Seq 2', head: '#b5792f', indices: this.range(92, 109) },
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
    this.refreshRand();
  }

  ngOnDestroy(): void {
    this.stopMonitor();
    this.stopMirror();
    this.stopRandTimer();
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
    if (tab === 'workbench') this.refreshRand();
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
        this.clearFlashPhases();
        this.syncRandPresetSlots();
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

  // Restore the workbench to the loaded snapshot AND re-persist that snapshot
  // to the slot.  On C4 every knob edit is auto-committed to flash at knob-time,
  // so a UI-only revert always loses to the already-flashed edits; we must write
  // the snapshot bytes back.  Serialize behind any in-flight flash commit so the
  // edited write can never land after our restore.  Mutates existing param
  // objects in place (the knob/seq cache is keyed on slotParams identity).
  revertPreset(): void {
    if (!this.slotParams) return;
    const overrides: Record<number, number> = {};
    for (const p of this.slotParams.params) {
      const snap = this.paramsSnapshot.find((sp) => sp.index === p.index);
      if (snap) {
        overrides[p.index] = snap.value;
        p.value = snap.value;
      }
    }
    this.slotsDirty = false;
    this.editedOverrides = {};
    this.clearFlashPhases();
    if (this.discreteTimer) {
      clearTimeout(this.discreteTimer);
      this.discreteTimer = null;
    }
    this.discreteDirty = false;
    if (this.discreteInFlight) {
      // A flash commit is mid-flight; queue the restore so it executes after
      // that commit settles (otherwise the edited write can override ours).
      this.pendingRevert = overrides;
      this.logAction('REVERT: view restored; flash restore queued behind in-flight commit');
      return;
    }
    this.pendingRevert = null;
    this.commitRevert(overrides);
  }

  private pendingRevert: Record<number, number> | null = null;

  private commitRevert(overrides: Record<number, number>): void {
    this.logAction(`REVERT: flashing ${Object.keys(overrides).length} byte(s) back to the saved preset`);
    this.api.slotSave({ idx: this.selectedPresetIdx!, overrides }).subscribe({
      next: () => this.logAction('REVERT: saved-preset flash restore committed'),
      error: (e) => (this.slotError = 'Revert flash restore failed: ' + (e.message ?? e)),
    });
  }

  // Visual-only zero: sets every workbench knob to 0 WITHOUT queueing any
  // commit (editedOverrides stays empty).  Sound is untouched here — turning a
  // knob afterwards commits ONLY that knob's byte, not the whole zeroed set.
  // Revert restores the snapshot.  Mutates existing param objects in place so
  // the knob/seq display (keyed on slotParams identity) actually updates.
  allParamsZero(): void {
    if (!this.slotParams) return;
    this.slotError = null;
    for (const p of this.slotParams.params) p.value = 0;
    this.slotsDirty = true;
    this.logAction('ZERO all workbench bytes (visual only, not committed)');
  }

  // --- Randomizer ----------------------------------------------------------
  // Generate random scenes over the workbench's current params and hear them
  // instantly (realtime). Scene history supports back/forward, and groups +
  // saved presets persist to backend JSON files via /api/randomize/*.
  randGroups: RandomizeGroup[] = [];
  randPresets: RandomizePreset[] = [];
  randBusy = false;
  randError: string | null = null;

  randAll = false;
  randIntervalSec = 5;
  randPlaying = false;
  randAlgo: 'uniform' | 'center' | 'extremes' | 'drift' = 'uniform';
  readonly RAND_ALGOS: { value: string; text: string }[] = [
    { value: 'uniform', text: 'Uniform' },
    { value: 'center', text: 'Center' },
    { value: 'extremes', text: 'Extremes' },
    { value: 'drift', text: 'Drift' },
  ];

  randScenes: number[][] = [];
  randSceneIdx = -1;
  private randTimer: ReturnType<typeof setInterval> | null = null;
  randCountdown = 0;

  // Group editor state.
  randEditingId: string | null = null;
  randNewName = '';
  randNewPriority = 10;
  randNewProps = 0;
  randNewMode: 'include' | 'exclude' = 'include';
  randKeysChecked: Record<string, boolean> = {};
  groupEditMode = false; // knobs turn into add/remove toggles while a group is open

  // Per-control group picker (workbench knob "grp" button).
  groupPickerSpec: ControlSpec | null = null;
  groupPickerNewName = '';

  // Preset save state.
  randSaveName = '';
  randPresetSlots: number[] = [];

  // Sorted by priority ascending (lower = first); stable tie-break by name.
  get randSortedGroups(): RandomizeGroup[] {
    return [...this.randGroups].sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  }

  get randCheckCount(): number {
    return Object.values(this.randKeysChecked).filter(Boolean).length;
  }

  refreshRand(): void {
    this.api.randomizeGroups().subscribe({
      next: (r) => (this.randGroups = r.groups || []),
      error: () => (this.randGroups = []),
    });
    this.api.randomizePresets().subscribe({
      next: (r) => {
        this.randPresets = r.presets || [];
        this.syncRandPresetSlots();
      },
      error: () => (this.randPresets = []),
    });
  }

  // Target-location defaults: a preset that has never been saved to a C4 slot
  // follows the workbench's currently selected preset; pinned rows keep theirs.
  private syncRandPresetSlots(): void {
    this.randPresetSlots = this.randPresets.map((p) => p.slot ?? this.selectedPresetIdx ?? 0);
  }

  specKey(spec: ControlSpec): string {
    return spec.index + ':' + spec.name;
  }

  randSpecTag(spec: ControlSpec): string {
    switch (spec.type) {
      case 'select':
        return 'sel';
      case 'toggle':
        return 'tog';
      case 'segmented':
        return 'seg';
      default:
        return 'knb';
    }
  }

  // Current 128-byte body from the loaded preset params (source of truth for
  // scene generation/saving — the workbench state is what you hear and see).
  private bodyValues(): number[] {
    const out = new Array<number>(this.BODY_LEN).fill(0);
    if (this.slotParams) {
      for (const p of this.slotParams.params) out[p.index] = p.value;
    }
    return out;
  }

  private randInt(min: number, maxExclusive: number): number {
    return Math.floor(Math.random() * (maxExclusive - min)) + min;
  }

  // Field value for a spec under the selected algorithm. Non-knobs (select,
  // segmented, toggle) always resolve to a legal option so an illegal field
  // value is impossible.
  private fieldFor(spec: ControlSpec, current: number): number {
    if (spec.type === 'select' || spec.type === 'segmented') {
      const opts = (spec.options || []).filter((o) => o.value <= spec.max);
      return opts.length ? opts[this.randInt(0, opts.length)].value : 0;
    }
    if (spec.type === 'toggle') return this.randInt(0, 2);
    switch (this.randAlgo) {
      case 'center': {
        const mid = Math.round(spec.max / 2);
        const band = Math.max(1, Math.round(spec.max / 6));
        return Math.max(0, Math.min(spec.max, mid + this.randInt(-band, band + 1)));
      }
      case 'extremes':
        return this.randInt(0, 2) === 0 ? 0 : spec.max;
      case 'drift': {
        const step = Math.max(1, Math.ceil(spec.max / 12));
        let v = current + this.randInt(-step, step + 1);
        if (v === current) v = Math.random() < 0.5 ? Math.max(0, current - step) : Math.min(spec.max, current + step);
        return Math.max(0, Math.min(spec.max, v));
      }
      case 'uniform':
      default:
        return this.randInt(0, spec.max + 1);
    }
  }

  // Which control-map specs this scene touches. Disabled groups are ignored.
  // Excluded groups lock their controls (never randomized, even with randAll).
  // Include groups contribute a definite number of random props per group (or
  // all their members).
  private randomTargets(): ControlSpec[] {
    const specByKey = new Map<string, ControlSpec>();
    for (const spec of this.controlMap) specByKey.set(this.specKey(spec), spec);
    const excluded = new Set<string>();
    for (const g of this.randSortedGroups) {
      if (g.enabled === false) continue;
      if (g.mode === 'exclude') for (const k of g.specKeys) excluded.add(k);
    }
    const avail = (spec: ControlSpec): boolean => !excluded.has(this.specKey(spec));
    if (this.randAll) return this.controlMap.filter(avail);
    const targets = new Map<string, ControlSpec>();
    for (const g of this.randSortedGroups) {
      if (g.enabled === false) continue;
      if (g.mode !== 'include') continue;
      const members = g.specKeys.map((k) => specByKey.get(k)).filter((s): s is ControlSpec => !!s && avail(s));
      if (!members.length) continue;
      const pick = g.props > 0 ? Math.min(g.props, members.length) : members.length;
      const pool = [...members];
      for (let i = 0; i < Math.min(pick, pool.length); i++) {
        const j = this.randInt(i, pool.length);
        [pool[i], pool[j]] = [pool[j], pool[i]];
      }
      for (let i = 0; i < Math.min(pick, pool.length); i++) targets.set(this.specKey(pool[i]), pool[i]);
    }
    return [...targets.values()];
  }

  private randomizeBody(base: number[], targets: ControlSpec[]): number[] {
    const body = base.slice();
    for (const spec of targets) {
      const p = this.paramFor(spec.index);
      const current = p ? this.fieldValue(spec, p) : 0;
      const field = this.fieldFor(spec, current);
      body[spec.index] = (body[spec.index] & ~spec.mask) | ((field << spec.shift) & spec.mask);
    }
    return body;
  }

  private pushScene(body: number[]): void {
    this.randScenes = this.randScenes.slice(0, this.randSceneIdx + 1);
    this.randScenes.push(body);
    this.randSceneIdx = this.randScenes.length - 1;
  }

  // Apply a scene body to the workbench: update the param bytes + editedOverrides
  // and commit the full body to flash (C4 ignores CTRL_SET, so the only way to
  // hear a change is via the ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET commit path).
  private applyScene(body: number[]): void {
    if (!this.slotParams) return;
    this.slotError = null;
    const overrides: Record<number, number> = {};
    for (const p of this.slotParams.params) {
      if (p.value !== body[p.index]) {
        p.value = body[p.index];
        this.editedOverrides[p.index] = body[p.index];
        this.slotsDirty = true;
        overrides[p.index] = body[p.index];
      }
    }
    if (!Object.keys(overrides).length) return;
    this.logAction(`SCENE commit ${Object.keys(overrides).length} bytes`);
    this.api.slotSave({ overrides }).subscribe({
      next: () => this.logAction(`SCENE committed`),
      error: (e) => (this.slotError = 'Scene commit failed: ' + (e.message ?? e)),
    });
  }

  generateScene(): void {
    if (!this.slotParams) {
      this.randError = 'Load a preset first (Workbench tab) — randomizing needs a base sound.';
      return;
    }
    const targets = this.randomTargets();
    if (!targets.length) {
      this.randError = this.randAll
        ? 'No controls loaded.'
        : 'No groups defined — add a group with controls, or tick "Randomize all controls".';
      return;
    }
    this.randError = null;
    const body = this.randomizeBody(this.bodyValues(), targets);
    this.pushScene(body);
    this.applyScene(body);
  }

  stepScene(dir: -1 | 1): void {
    const next = this.randSceneIdx + dir;
    if (next < 0 || next >= this.randScenes.length) return;
    this.randSceneIdx = next;
    this.applyScene(this.randScenes[next]);
  }

  togglePlay(): void {
    if (this.randPlaying) {
      this.stopRandTimer();
      this.randPlaying = false;
      this.randCountdown = 0;
      return;
    }
    this.randPlaying = true;
    this.generateScene();
    this.randCountdown = this.randIntervalSec;
    this.randTimer = setInterval(() => {
      if (!this.randPlaying) return;
      this.randCountdown--;
      if (this.randCountdown <= 0) {
        this.randCountdown = this.randIntervalSec;
        this.generateScene();
      }
    }, 1000);
  }

  private stopRandTimer(): void {
    if (this.randTimer) {
      clearInterval(this.randTimer);
      this.randTimer = null;
    }
  }

  // --- Group CRUD ----------------------------------------------------------
  startAddGroup(): void {
    this.randEditingId = null;
    this.randNewName = '';
    this.randNewPriority = 10;
    this.randNewProps = 0;
    this.randNewMode = 'include';
    this.randKeysChecked = {};
    this.groupPickerSpec = null;
    this.groupEditMode = true;
  }

  editGroup(g: RandomizeGroup): void {
    this.randEditingId = g.id;
    this.randNewName = g.name;
    this.randNewPriority = g.priority;
    this.randNewProps = g.props;
    this.randNewMode = g.mode === 'exclude' ? 'exclude' : 'include';
    this.randKeysChecked = {};
    for (const k of g.specKeys) this.randKeysChecked[k] = true;
    this.groupPickerSpec = null;
    this.groupEditMode = true;
  }

  cancelEditGroup(): void {
    this.randEditingId = null;
    this.randNewName = '';
    this.randKeysChecked = {};
    this.groupPickerSpec = null;
    this.groupEditMode = false;
  }

  saveGroup(): void {
    const specKeys = Object.keys(this.randKeysChecked).filter((k) => this.randKeysChecked[k]);
    if (!specKeys.length) {
      this.randError = 'Select at least one control for the group.';
      return;
    }
    this.randBusy = true;
    this.randError = null;
    const body = {
      name: this.randNewName.trim() || 'Group',
      priority: this.randNewPriority,
      props: this.randNewProps,
      mode: this.randNewMode,
      specKeys,
    };
    const done = () => {
      this.randBusy = false;
      this.cancelEditGroup();
      this.refreshRand();
    };
    const failed = (e: unknown) => {
      this.randBusy = false;
      this.randError = 'Group save failed: ' + ((e as { message?: string }).message ?? e);
    };
    if (this.randEditingId) {
      this.api.randomizeGroupUpdate(this.randEditingId, body).subscribe({ next: done, error: failed });
    } else {
      this.api.randomizeGroupCreate(body).subscribe({ next: done, error: failed });
    }
  }

  // In group-edit mode clicking a knob's grp button toggles that control in the
  // group being edited (green = add, red = already in -> remove). No popover,
  // no API call until Save.
  toggleSpecInEditGroup(spec: ControlSpec): void {
    const key = this.specKey(spec);
    this.randKeysChecked[key] = !this.randKeysChecked[key];
    this.groupPickerSpec = null;
  }

  editGroupHasSpec(spec: ControlSpec): boolean {
    return !!this.randKeysChecked[this.specKey(spec)];
  }

  // --- Per-control group picker (workbench knob "grp" button) -------------
  // Groups belong to the control map keyed by "index:name". The picker lets you
  // attach any single knob/control to an include or exclude group, or spin a new
  // group up from the picker itself.
  openGroupPicker(spec: ControlSpec): void {
    if (this.groupEditMode) return;
    const key = this.specKey(spec);
    const cur = this.groupPickerSpec ? this.specKey(this.groupPickerSpec) : null;
    this.groupPickerSpec = cur === key ? null : spec;
    this.groupPickerNewName = '';
  }

  grpPickerIs(spec: ControlSpec): boolean {
    return !!this.groupPickerSpec && this.specKey(this.groupPickerSpec) === this.specKey(spec);
  }

  specOfExclude(spec: ControlSpec): boolean {
    return this.randGroups.some(
      (g) => g.enabled !== false && g.mode === 'exclude' && g.specKeys.includes(this.specKey(spec))
    );
  }

  groupsOf(spec: ControlSpec): RandomizeGroup[] {
    const key = this.specKey(spec);
    return this.randGroups.filter((g) => g.specKeys.includes(key));
  }

  specInGroup(spec: ControlSpec, g: RandomizeGroup): boolean {
    return g.specKeys.includes(this.specKey(spec));
  }

  setSpecInGroup(spec: ControlSpec, g: RandomizeGroup, inGroup: boolean): void {
    const key = this.specKey(spec);
    const specKeys = inGroup
      ? [...g.specKeys, key]
      : g.specKeys.filter((k) => k !== key);
    this.randBusy = true;
    this.randError = null;
    this.api
      .randomizeGroupUpdate(g.id, { specKeys })
      .subscribe({
        next: () => {
          this.randBusy = false;
          this.refreshRand();
        },
        error: (e) => {
          this.randBusy = false;
          this.randError = 'Group update failed: ' + ((e as { message?: string }).message ?? e);
        },
      });
  }

  createGroupWithSpec(spec: ControlSpec, name: string, mode: 'include' | 'exclude'): void {
    if (!this.controlMap.length) return;
    this.randBusy = true;
    this.randError = null;
    const body = {
      name: (name.trim() || (mode === 'exclude' ? 'Excluded' : 'Group')),
      priority: 10,
      props: 0,
      mode,
      specKeys: [this.specKey(spec)],
    };
    this.api.randomizeGroupCreate(body).subscribe({
      next: () => {
        this.randBusy = false;
        this.groupPickerSpec = null;
        this.refreshRand();
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Group create failed: ' + ((e as { message?: string }).message ?? e);
      },
    });
  }

  toggleGroupEnabled(g: RandomizeGroup, on: boolean): void {
    this.randBusy = true;
    this.randError = null;
    this.api.randomizeGroupUpdate(g.id, { enabled: on }).subscribe({
      next: () => {
        this.randBusy = false;
        this.refreshRand();
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Group on/off update failed: ' + ((e as { message?: string }).message ?? e);
      },
    });
  }

  toggleGroupMode(g: RandomizeGroup): void {
    const mode: 'include' | 'exclude' = g.mode === 'exclude' ? 'include' : 'exclude';
    this.randBusy = true;
    this.randError = null;
    this.api.randomizeGroupUpdate(g.id, { mode }).subscribe({
      next: () => {
        this.randBusy = false;
        this.refreshRand();
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Group mode update failed: ' + ((e as { message?: string }).message ?? e);
      },
    });
  }

  deleteGroup(g: RandomizeGroup): void {
    if (!confirm(`Delete group "${g.name}"?`)) return;
    this.randBusy = true;
    this.randError = null;
    this.api.randomizeGroupDelete(g.id).subscribe({
      next: () => {
        this.randBusy = false;
        if (this.randEditingId === g.id) this.cancelEditGroup();
        this.refreshRand();
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Group delete failed: ' + ((e as { message?: string }).message ?? e);
      },
    });
  }

  // --- Preset CRUD ---------------------------------------------------------
  private hexOfBody(body: number[]): string {
    return body.map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  private bodyOfHex(hex: string): number[] {
    const out: number[] = [];
    for (let i = 0; i < hex.length; i += 2) out.push(parseInt(hex.slice(i, i + 2), 16));
    return out;
  }

  saveRandPreset(): void {
    if (!this.slotParams) return;
    const name = this.randSaveName.trim() || `rand-${this.randPresets.length + 1}`;
    this.randBusy = true;
    this.randError = null;
    this.api
      .randomizePresetCreate({ name, source: 'randomizer', bodyHex: this.hexOfBody(this.bodyValues()) })
      .subscribe({
        next: () => {
          this.randBusy = false;
          this.randSaveName = '';
          this.refreshRand();
        },
        error: (e) => {
          this.randBusy = false;
          this.randError = 'Preset save failed: ' + ((e as { message?: string }).message ?? e);
        },
      });
  }

  loadPreset(p: RandomizePreset): void {
    const body = this.bodyOfHex(p.bodyHex);
    if (body.length !== this.BODY_LEN || !this.slotParams) {
      this.randError = 'Cannot load preset — bad body or no preset loaded.';
      return;
    }
    this.randError = null;
    this.pushScene(body);
    this.applyScene(body);
  }

  savePresetToSlot(p: RandomizePreset, presetIdx: number): void {
    this.randBusy = true;
    this.randError = null;
    this.api.randomizePresetUpdate(p.id, { saveToSlot: presetIdx, name: p.name }).subscribe({
      next: () => {
        this.randBusy = false;
        const po = this.presetOptions.find((x) => x.idx === presetIdx);
        if (po) po.name = p.name;
        this.refreshRand();
        this.loadPresetParams(presetIdx);
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Preset → location save failed: ' + ((e as { message?: string }).message ?? e);
      },
    });
  }

  renamePreset(p: RandomizePreset): void {
    const name = prompt('Rename preset', p.name);
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed || trimmed === p.name) return;
    this.api.randomizePresetUpdate(p.id, { name: trimmed }).subscribe({
      next: () => this.refreshRand(),
      error: (e) => (this.randError = 'Preset rename failed: ' + ((e as { message?: string }).message ?? e)),
    });
  }

  deletePreset(p: RandomizePreset): void {
    if (!confirm(`Delete preset "${p.name}"?`)) return;
    this.api.randomizePresetDelete(p.id).subscribe({
      next: () => this.refreshRand(),
      error: (e) => (this.randError = 'Preset delete failed: ' + ((e as { message?: string }).message ?? e)),
    });
  }

  fmtTs(ts: number): string {
    if (!ts) return '—';
    const d = new Date(ts);
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
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

  // Record a changed field and route the write.
  // On the C4, CTRL_SET (0x70) is silently ignored by the firmware — every
  // change must go through the flash-commit path (ACTIVE_STORE + ACTIVE_WRITE
  // + setActivePreset).  ALL pending edited bytes are batched into a single
  // slotSave({overrides}) call so multiple knob turns within the debounce
  // window are committed together — avoiding lost edits and spurious preset
  // re-activations.
  private setField(spec: ControlSpec, p: SlotParam, uiValue: number): void {
    // A knob edit after Revert but before a queued flash restore cancels that
    // restore — the user is re-editing, we must not stomp it.
    this.pendingRevert = null;
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
        .padStart(2, '0')}->0x${byte.toString(16).padStart(2, '0')} FLASH`
    );
    // A superseded sibling edit on the same packed byte (another field of the
    // same body byte queued since) is folded into the composed byte this write
    // will commit — its badge must not stay stuck half-lit.
    const thisKey = this.fieldKey(spec);
    for (const k of Array.from(this.flashPhase.keys())) {
      if (k !== thisKey && k.startsWith(spec.index + ':')) this.flashPhase.delete(k);
    }
    this.setFlashPhase(spec, 'pending');
    this.discreteDirty = true;
    if (this.discreteTimer) return;
    this.discreteTimer = setTimeout(() => {
      this.discreteTimer = null;
      this.flushDiscrete();
    }, 300);
  }

  // Debounced flash commit: batches ALL pending editedOverrides bytes into a
  // single slotSave call, committing them all in one flash write + preset
  // re-activation.  This prevents lost edits when multiple knobs are turned
  // within the debounce window and avoids the audible "jumping" caused by
  // individual preset re-activations.
  private discreteTimer: ReturnType<typeof setTimeout> | null = null;
  private discreteDirty = false;
  private discreteInFlight = false;

  private flushDiscrete(): void {
    if (this.discreteInFlight || !this.discreteDirty) return;
    const keys = Object.keys(this.editedOverrides);
    if (!keys.length) return;
    this.discreteInFlight = true;
    this.discreteDirty = false;
    const overrides: Record<number, number> = {};
    const specsToMark: ControlSpec[] = [];
    for (const key of keys) {
      const idx = Number(key);
      overrides[idx] = this.editedOverrides[idx];
      for (const s of this.controlSpecsByIndex.get(idx) || []) {
        if (this.flashPhase.get(this.fieldKey(s)) === 'pending') specsToMark.push(s);
      }
    }
    for (const s of specsToMark) this.setFlashPhase(s, 'writing');
    this.logAction(`FLASH batch commit ${Object.keys(overrides).length} byte(s)`);
    this.api.slotSave({ overrides }).subscribe({
      next: () => {
        this.discreteInFlight = false;
        for (const s of specsToMark) this.setFlashPhase(s, 'applied');
        if (this.pendingRevert) {
          // A revert was requested while this commit was in flight; its
          // snapshot restore must land AFTER the edited write so the pedal
          // really returns to the saved preset.
          const r = this.pendingRevert;
          this.pendingRevert = null;
          this.commitRevert(r);
          return;
        }
        this.flushDiscrete();
      },
      error: (e) => {
        this.discreteInFlight = false;
        for (const s of specsToMark) this.flashPhase.delete(this.fieldKey(s));
        this.slotError = 'Commit failed: ' + (e.message ?? e);
        if (this.pendingRevert) {
          const r = this.pendingRevert;
          this.pendingRevert = null;
          this.commitRevert(r);
        }
      },
    });
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