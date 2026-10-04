import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LaladyApiService } from './lalady-api.service';
import { LaladyMidiService } from './lalady-midi.service';
import { LaladyPresets, LaladySlot, LaladyStatus, LiveControls, RandomizeGroup, RandomizePreset, RestoreResult, SlotParam, SlotParams, WriteResult, ControlSpec, EepromData, OsbfData } from './lalady.models';

type RowState =
  | { kind: 'idle' }
  | { kind: 'busy'; label: string }
  | { kind: 'ok'; label: string }
  | { kind: 'err'; label: string };

interface RowModel {
  slot: LaladySlot;
  state: RowState;
  hasFile: boolean;
}

@Component({
  selector: 'app-lalady',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './lalady.component.html',
  styleUrl: './lalady.component.scss',
})
export class LaladyComponent implements OnInit, OnDestroy {
  @ViewChild('restoreFileInput') restoreFileInput!: ElementRef<HTMLInputElement>;
  @ViewChild('importFileInput') importFileInput!: ElementRef<HTMLInputElement>;

  activeTab: 'slots' | 'workbench' | 'observe' | 'inspect' = 'workbench';
  private pendingImportRow: RowModel | null = null;

  rows: RowModel[] = [];
  deviceFound = false;
  deviceError: string | null = null;
  loading = true;

  // Realtime read-only monitor: polls GET /api/controls and displays the pedal's
  // current live knob values, reflecting external changes (e.g. made in the
  // Neuro editor) without writing anything back. Used by the merged Observe tab.
  monitor: LiveControls | null = null;
  monitorOn = false;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MONITOR_POLL_MS = 5000;

  // Workbench live mirror: an OPT-IN low-rate poll of /api/controls that
  // reconciles workbench knob positions to the pedal's CURRENT live control
  // table, so external changes (MIDI board sends a CC, physical knob turned,
  // Neuro edit) move the on-screen knobs. Only fields that have a 1:1 live
  // control (spec.liveIndex) can be mirrored; the rest keep their last-known
  // value. On by Start/Stop button only — not automatic, so opening/editing the
  // workbench never surprises the user with spurious knob movement.
  mirrorOn = false;
  private mirrorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MIRROR_POLL_MS = 2000;

  // Workbench control map (GET /api/control-map): how each preset-body byte
  // decomposes into Neuro-style UI controls. This is the 53-byte BODY layout
  // (body index 26+ differs from the live control table), so these specs drive
  // what workbench edits — labels, kinds and bit-fields.
  controlMap: ControlSpec[] = [];
  private controlSpecsByIndex = new Map<number, ControlSpec[]>();

  // Offline workbench (no Neuro): select one of 6 slots, edit any param, then
  // persist the whole state to the active slot. Params are read from the slot's
  // flash body (what's actually saved/recalled), independent of the live table.
  readonly SLOT_LABELS = ['1', '2', '3', '4', '5', '6'];
  // Map picker button position -> physical raw slot index, so physical slots
  // 4,5,6 display as 1,2,3 and physical 1,2,3 display as 4,5,6 (same mapping the
  // main slots table uses).
  readonly SLOT_DISPLAY_ORDER = [3, 4, 5, 0, 1, 2];
  selectedSlotIdx: number | null = null;
  slotParams: SlotParams | null = null;
  slotBusy = false;
  slotError: string | null = null;
  slotsDirty = false;
  private paramsSnapshot: SlotParam[] = [];
  private editedOverrides: Record<number, number> = {};

  // Operator-facing action log: every SET/LIVE/FLASH/SAVE/observe the workbench
  // performs lands here (rendered as a collapsible panel + exposed to E2E via
  // window.__laladyActions). The packed-byte watchdog re-checks the load-time
  // baseline for bytes 26/30/32/38 on every write and observe poll and emits a
  // CLOBBER line if any changed WITHOUT a user edit on that byte — this is the
  // literal "treble cut filter changed by another knob" alarm the operator asked
  // for, and the E2E specs assert it never fires from other controls.
  actionLog: string[] = [];
  actionLogOpen = false;

  get hasClobber(): boolean {
    return this.actionLog.some((l) => l.includes('CLOBBER'));
  }
  private readonly ACTION_LOG_MAX = 500;
  // All activity is kept in memory (workbench pane) AND mirrored to a file on
  // the backend (runtime-actions/lalady-ui.log) so the save-"sound changed"
  // bug can be traced after the fact (SET/LIVE/FLASH + backend SAVE-BEFORE/
  // SAVE-AFTER stamps with a byte diff).
  private logTimer: ReturnType<typeof setTimeout> | null = null;
  private logBatch: string[] = [];

  // Per-control "was this change applied?" indicator. Flash commits lag the knob
  // edit (300ms debounce + a ~2s flash/recall cycle), so a knob that "didn't do
  // anything yet" is confusing. Every control shows a small badge tracking its
  // apply lifecycle: 'pending' (queued) → 'writing' (flash in progress) → 'applied'
  // (readback confirmed, fades after APPLIED_KEEP_MS). The global commit strip
  // mirrors pending count + the most recently applied control.
  //
  // Keyed by FIELD (index:shift), NOT body byte: packed bytes like 30/32/38 hold
  // several controls, and if the badge were byte-scoped every sibling would light
  // up when one of them is touched.
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

  // phase for a control; 'applied' auto-fades after APPLIED_KEEP_MS.
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
  private packedBaseline: Partial<Record<number, number>> = {};
  private packedUserTouched = new Set<number>();
  private observePollCount = 0;

  // Live-control indices the pedal provably does NOT honor: CTRL_SET writes to
  // 16..39 are ignored and the live table there reads back stale 0/255 garbage,
  // so the observer must never mirror those onto the workbench (it would fight
  // fresh knob edits and flash wrong values). 6/19 are empty map entries. Only
  // 0..15 are verified writable and reliably readable on the L.A. Lady.
  private static readonly OBSERVE_UNTRUSTED_LIVE = new Set<number>([
    6, 19, ...Array.from({ length: 24 }, (_, i) => 16 + i),
  ]);

  // Workbench param grouping. Each group lists body indices rendered in that
  // section; every control-map spec whose byte index is in a group is shown
  // there (so packed bytes like 26/30/32/38/39 split into their own controls).
  private readonly CONTROL_GROUPS = [
    { title: 'Dist 1', indices: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] },
    { title: 'Dist 2', indices: [13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25] },
    { title: 'Parametric EQ', indices: [27, 28, 29, 30, 31, 32, 33, 34, 35, 36] },
    { title: 'Noise gate & filters', indices: [26, 37] },
    { title: 'Routing & assign', indices: [38, 39] },
  ];

  // Rows of groups (each row rendered on its own line).
  readonly KNOB_ROWS = [
    [0, 1],
    [2],
    [3, 4],
  ];

  // knobRows/observeGroups are structural layout (static per control-map/slot),
  // so they are cached and only rebuilt when the data they depend on changes.
  // Building them from scratch on every change detection would make the ngFor
  // destroy+recreate every knob node on each CD tick (default trackBy = item
  // identity) — killing pointer-drag state and any external automation.
  private _knobRowsCache: { title: string; controls: { spec: ControlSpec; p: SlotParam }[] }[][] | null = null;
  private _knobRowsKey: readonly unknown[] | null = null;
  private _observeGroupsCache: { title: string; controls: ControlSpec[] }[] | null = null;
  private _observeGroupsKey: unknown = null;

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
        // Engine selects (full-width) go to the top of their block.
        .sort(
          (a, b) => Number(this.isEngineSpec(b.spec)) - Number(this.isEngineSpec(a.spec)) || a.spec.index - b.spec.index
        ),
    }));
    this._knobRowsKey = key;
    this._knobRowsCache = this.KNOB_ROWS.map((rowIdx) => rowIdx.map((gi) => groups[gi]));
    return this._knobRowsCache;
  }

  // Read-only "Observe" tab: reuse the workbench group layout, but render each
  // control's CURRENT live value (polled via /api/controls -> this.monitor,
  // keyed by spec.liveIndex) as plain text labels. No editing controls.
  get observeGroups(): { title: string; controls: ControlSpec[] }[] {
    const key = this.controlSpecsByIndex;
    if (this._observeGroupsCache && this._observeGroupsKey === key) return this._observeGroupsCache;
    this._observeGroupsKey = key;
    this._observeGroupsCache = this.CONTROL_GROUPS.map((g) => ({
      title: g.title,
      controls: g.indices
        .flatMap((i) => this.controlSpecsByIndex.get(i) || [])
        .sort(
          (a, b) =>
            Number(this.isEngineSpec(b)) - Number(this.isEngineSpec(a)) ||
            a.index - b.index
        ),
    }));
    return this._observeGroupsCache;
  }

  // The live value (native 0..255) for a spec from the latest /api/controls poll,
  // or null when the spec has no 1:1 live control (packed 30/32/38) or no data.
  observeNative(spec: ControlSpec): number | null {
    if (spec.liveIndex == null || !this.monitor?.controls) return null;
    const c = this.monitor.controls.find((x) => x.index === spec.liveIndex);
    return typeof c?.value === 'number' ? c.value : null;
  }

  // Label shown in the Observe tab for a control's live value, rendered by type.
  observeLabel(spec: ControlSpec): string {
    const native = this.observeNative(spec);
    if (native == null) return '—';
    switch (spec.type) {
      case 'toggle':
        return native === 1 ? 'ON' : 'OFF';
      case 'select':
      case 'segmented': {
        const opt = (spec.options || []).find((o) => o.value === native);
        return opt ? opt.text : `?? ${native} (unknown)`;
      }
      case 'knob':
      default:
        return String(native);
    }
  }

  restoreResult: RestoreResult | null = null;

  // Pedal hardware config (MIDI channel etc.) from GET /api/status.
  deviceInfo: LaladyStatus | null = null;

  // Browser-native MIDI engage/bypass (CC 102 on the pedal's MIDI channel):
  // midiBypassed = pedal is currently bypassed (off); clicking toggles it.
  midiEngageSupported = false;
  midiBypassed = true;
  midiEngageMsg: string | null = null;

  // Inspect tab diagnostic data.
  inspectData: EepromData | null = null;
  inspectOsbf: OsbfData | null = null;
  inspectBusy = false;
  inspectError: string | null = null;

  constructor(private api: LaladyApiService, private midi: LaladyMidiService) {}

  ngOnInit(): void {
    if (typeof window !== 'undefined') {
      (window as unknown as { __laladyActions?: string[] }).__laladyActions = this.actionLog;
    }
    this.refresh();
    this.refreshDeviceInfo();
    this.refreshRand();
    this.autoSelectActive();
    this.midiEngageSupported = this.midi.isSupported();
    this.api.logReset().subscribe();
    this.logAction('session start');
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

  // On a fresh session nothing is selected, so Save / all-0 are all
  // disabled. Read the pedal's currently-active slot and load its params for
  // display so the workbench is immediately usable. READ-ONLY: a page refresh
  // must never issue ACTIVE_SET — re-selecting here would silently switch the
  // active effect. activeIndex is the true physical slot (0..5), resolved by the
  // backend from the live control block.
  private autoSelectActive(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (m && typeof m.activeIndex === 'number' && this.selectedSlotIdx === null) {
          const idx = m.activeIndex;
          if (Number.isInteger(idx) && idx >= 0 && idx <= 5) {
            this.loadSlotParams(idx);
          }
        }
      },
      error: () => {
        /* device offline; leave buttons disabled, user can click a slot */
      },
    });
  }

  refreshDeviceInfo(): void {
    this.api.status().subscribe({
      next: (s) => {
        this.deviceInfo = s;
        this.midi.channel = s.config.midiChannel + 1;
      },
      error: () => (this.deviceInfo = null),
    });
  }

  ngOnDestroy(): void {
    this.flushLogBatch();
    this.stopMonitor();
    this.stopMirror();
    this.stopRandTimer();
    this.clearFlashPhases();
  }

  // Toggle the pedal's engage/bypass via Web MIDI (CC 102 on the configured
  // channel): sends 127 (on/engage) when bypassed, 0 (off) otherwise.
  async toggleMidiEngage(): Promise<void> {
    this.midi.channel = this.deviceInfo ? this.deviceInfo.config.midiChannel + 1 : 3;
    const value = this.midiBypassed ? 127 : 0;
    const ok = await this.midi.send(value);
    if (ok) {
      this.midiBypassed = value === 0;
      this.midiEngageMsg = null;
    } else {
      this.midiEngageMsg = 'Web MIDI unavailable — open in Chrome/Edge on http://localhost';
    }
  }

  refresh(): void {
    this.loading = true;
    this.api.device().subscribe({
      next: (d) => {
        this.deviceFound = d.found;
        this.deviceError = d.found ? null : 'L.A. Lady not connected';
        if (d.found) this.loadSlots();
        else this.loading = false;
      },
      error: (e) => {
        this.deviceFound = false;
        this.deviceError = 'Cannot reach la-lady backend: ' + (e.message ?? e);
        this.loading = false;
      },
    });
  }

  private loadSlots(): void {
    this.api.presets().subscribe({
      next: (p: LaladyPresets) => {
        // Physical page order from the backend is [0x3c000, 0x3d000, 0x3e000,
        // 0x3f000, 0x40000, 0x41000] (physical slots 1..6). The UI presents them
        // in display order 1..6 mapping to physical 4,5,6,1,2,3.
        const displayOrder = [3, 4, 5, 0, 1, 2];
        this.rows = displayOrder.map((i) => {
          const slot = p.slots[i];
          return {
            slot,
            state: { kind: 'idle' },
            hasFile: false,
          };
        });
        this.loading = false;
      },
      error: (e) => {
        this.deviceError = 'Failed to load presets: ' + (e.message ?? e);
        this.loading = false;
      },
    });
  }

  importSlot(row: RowModel): void {
    this.pendingImportRow = row;
    const input = this.importFileInput.nativeElement;
    input.value = '';
    input.click();
  }

  onImportFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    const row = this.pendingImportRow;
    if (!file || !row) return;
    this.pendingImportRow = null;
    row.state = { kind: 'busy', label: 'writing…' };
    file.text().then((text) => {
      this.api
        .write({ slot: row.slot.page.toString(16), preText: text })
        .subscribe({
          next: (r: WriteResult) => {
            if (!r.ok || r.error) {
              row.state = { kind: 'err', label: r.error || 'write failed' };
            } else {
              row.state = { kind: 'ok', label: 'written ✓' };
              this.afterChange(row);
            }
          },
          error: (e) => {
            row.state = { kind: 'err', label: e.message ?? 'write error' };
          },
        });
    });
  }

  activateSlot(row: RowModel): void {
    row.state = { kind: 'busy', label: 'activating…' };
    this.api.activate(row.slot.page.toString(16)).subscribe({
      next: (r) => {
        row.state = { kind: 'ok', label: 'active ✓' };
        this.afterChange(row);
      },
      error: (e) => {
        row.state = { kind: 'err', label: e.message ?? 'activate error' };
      },
    });
  }

  eraseSlot(row: RowModel): void {
    row.state = { kind: 'busy', label: 'erasing…' };
    this.api.erase(row.slot.page.toString(16)).subscribe({
      next: (r) => {
        if (!r.ok || r.error) {
          row.state = { kind: 'err', label: r.error || 'erase failed' };
        } else {
          row.state = { kind: 'ok', label: 'erased ✓' };
          this.afterChange(row);
        }
      },
      error: (e) => {
        row.state = { kind: 'err', label: e.message ?? 'erase error' };
      },
    });
  }

  exportSlot(row: RowModel): void {
    window.open(this.api.exportUrl(row.slot.page.toString(16)), '_blank');
  }

  toggleMonitor(): void {
    if (this.monitorOn) {
      this.stopMonitor();
    } else {
      this.startMonitor();
    }
  }

  openWorkbench(): void {
    this.activeTab = 'workbench';
    this.refreshRand();
  }

  openObserve(): void {
    this.activeTab = 'observe';
    if (!this.monitorOn) this.startMonitor();
  }

  private startMonitor(): void {
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

  toggleMirror(): void {
    if (this.mirrorOn) this.stopMirror();
    else this.startMirror();
  }

  // Reconcile workbench fields from the pedal's live control table. Each spec
  // with spec.liveIndex reads the live table's value for that index (values are
  // identical body<->live, no scaling) and, when it differs from what the UI
  // shows, updates the field's bits inside the UI body byte AND the snapshot
  // baseline. Live/pedal-side movement (physical knobs, MIDI) is reflected on
  // screen but is NOT flagged as a user edit: it never adds to editedOverrides
  // or sets slotsDirty, so the yellow "modified" highlight only appears for
  // controls the user actually changed in this session. A knob currently being
  // dragged is skipped so the mirror never fights the user's hand; the poll rate
  // (2s) just lags wrist turns slightly.
  private mirrorControls(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (!m || !Array.isArray(m.controls)) return;
        this.observePollCount++;
        const byIndex = new Map<number, number>();
        for (const c of m.controls) {
          if (typeof c.value === 'number') byIndex.set(c.index, c.value);
        }
        if (!byIndex.size || !this.slotParams) return;
        this.logAction(`OBSERVE poll #${this.observePollCount} live table of ${byIndex.size} entries`);
        for (const s of this.controlMap) {
          if (s.liveIndex == null) continue;
          const live = byIndex.get(s.liveIndex);
          if (typeof live !== 'number') continue;
          if (this.activeKnob && this.activeKnob.spec === s) continue;
          const p = this.paramFor(s.index);
          if (!p) continue;
          if (LaladyComponent.OBSERVE_UNTRUSTED_LIVE.has(s.liveIndex)) {
            // Pedal ignores CTRL_SET in 16..39 (+6/19) and reads 0/255 stale
            // there; 0xff placeholders carry no value — never surface those.
            if (live !== 0xff) {
              this.logAction(`OBSERVE skip live#${s.liveIndex} (${s.name}): untrusted window value=${live}`);
            }
            continue;
          }
          const nativeField = Math.max(0, Math.min(s.max, live));
          if (this.fieldValue(s, p) === nativeField) continue;
          this.logAction(`OBSERVE ${s.name} live#${s.liveIndex}: field ${this.fieldValue(s, p)}->${nativeField}`);
          p.value = (p.value & ~s.mask) | ((nativeField << s.shift) & s.mask);
          const snap = this.paramsSnapshot.find((sp) => sp.index === p.index);
          if (snap) snap.value = p.value;
        }
        this.logPackedHealth();
      },
      error: () => {
        /* device offline; workbench keeps last-known values */
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

  // Activate slot `idx` on the pedal, then load its params from the flash body.
  selectSlot(idx: number): void {
    this.slotBusy = true;
    this.slotError = null;
    this.api.activateSlot(idx).subscribe({
      next: () => this.loadSlotParams(idx),
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Activate failed: ' + (e.message ?? e);
      },
    });
  }

  // Display number (1..6) for a raw physical slot index (inverse of SLOT_DISPLAY_ORDER).
  displaySlotNum(rawIdx: number): number {
    return this.SLOT_DISPLAY_ORDER.indexOf(rawIdx) + 1;
  }

  private loadSlotParams(idx: number): void {
    this.api.slotParams(idx).subscribe({
      next: (s) => {
        this.slotBusy = false;
        this.selectedSlotIdx = idx;
        this.slotParams = s;
        this.paramsSnapshot = s.params.map((p) => ({ ...p }));
        this.slotsDirty = false;
        this.editedOverrides = {};
        this.packedBaseline = {};
        this.packedUserTouched = new Set<number>();
        this.clearFlashPhases();
        for (const p of s.params) {
          if ([26, 30, 32, 38].includes(p.index)) this.packedBaseline[p.index] = p.value;
        }
        const b30 = s.params.find((p) => p.index === 30);
        this.logAction(`LOAD slot ${idx} byte30=0x${b30?.value.toString(16) ?? '??'} (baseline)`);
      },
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Load params failed: ' + (e.message ?? e);
      },
    });
  }

  private logAction(msg: string): void {
    this.actionLog.push(`${new Date().toISOString().slice(11, 19)} ${msg}`);
    if (this.actionLog.length > this.ACTION_LOG_MAX) this.actionLog.shift();
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

  lastActionLines(n: number): string[] {
    return this.actionLog.slice(-n);
  }

  private logPackedHealth(): void {
    if (!this.slotParams) return;
    for (const idx of [26, 30, 32, 38]) {
      const base = this.packedBaseline[idx];
      if (base === undefined || this.packedUserTouched.has(idx)) continue;
      const pr = this.paramFor(idx);
      const now = pr ? pr.value : 0;
      if (now !== base) {
        this.logAction(
          `CLOBBER byte ${idx} changed 0x${base.toString(16)}->0x${now.toString(16)} with no user edit on that byte`
        );
        this.packedBaseline[idx] = now;
      }
    }
  }

  // Realtime: writes a field's value into the pedal's LIVE control table via
  // CTRL_SET (0x70) at the control's LIVE index (spec.liveIndex), so you HEAR
  // the change immediately without waiting for a flash commit. Not persisted;
  // Save does that. Throttled lightly (~40ms) to avoid flooding the USB pipe
  // during a fast drag; pending sends coalesce per live index (last wins).
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

  // --- Body-layout field helpers (control-map specs) -------------------------
  paramFor(index: number): SlotParam | null {
    if (!this.slotParams) return null;
    return this.slotParams.params.find((p) => p.index === index) ?? null;
  }

  // The value a spec's field holds within its packed byte (whole-byte specs with
  // shift 0/mask 0xff return the raw byte). Knobs use the full 0..255 native
  // byte range — no scaling, value identity between UI and pedal.
  fieldValue(spec: ControlSpec, p: SlotParam): number {
    return (p.value & spec.mask) >>> spec.shift;
  }

  // Knob UI domain is the full native 0..255 byte — 256 points of resolution.
  // No halving/doubling/scaling: what you see is what the pedal stores.
  private toUIMax(spec: ControlSpec): number {
    return spec.max;
  }

  // Debounced flash commit for packed/bit-field controls: writes the FULL byte
  // (composed from the sibling bits already in p.value) via /api/control — the
  // lossless in-place patch + re-activate. Live CTRL_SET index numbering differs
  // from the body layout at 26+, so packed items must NOT go through controlLive
  // (it would write a whole body byte, clobbering sibling fields). One commit at
  // a time; later edits during the ~2s flash are coalesced and re-sent.
  private discreteTimer: ReturnType<typeof setTimeout> | null = null;
  private discretePending: { p: SlotParam; byte: number; spec: ControlSpec } | null = null;
  private discreteInFlight = false;

  // Record a changed field and route the write: fields with a TRUSTED 1:1 live
  // control (spec.liveIndex in 0..15, e.g. Left Drive -> live 2) go realtime via
  // CTRL_SET at the LIVE index. The L.A. Lady ignores CTRL_SET for live indices
  // 16..39 (reads stale 0/255 garbage there — see OBSERVE_UNTRUSTED_LIVE), so
  // everything else (mid EQ 33/34/35/36 -> live 32..35, gate/treble/bass ->
  // live 26..30/36, packed 30/32/38, I/O routing) goes to the flash-commit queue
  // via the proven lossless patch, so the edit is HEARD and Save is a no-op.
  private setField(spec: ControlSpec, p: SlotParam, uiValue: number): void {
    const native = Math.max(0, Math.min(spec.max, uiValue));
    const prevField = this.fieldValue(spec, p);
    const prevByte = p.value;
    const byte = (p.value & ~spec.mask) | ((native << spec.shift) & spec.mask);
    const useLive =
      spec.liveIndex != null && !LaladyComponent.OBSERVE_UNTRUSTED_LIVE.has(spec.liveIndex);
    p.value = byte;
    if ([26, 30, 32, 38].includes(spec.index)) {
      this.packedBaseline[spec.index] = byte;
      this.packedUserTouched.add(spec.index);
    }
    this.slotsDirty = true;
    this.editedOverrides[p.index] = byte;
    this.logAction(
      `SET ${spec.name} (${spec.index}:${spec.shift}) field ${prevField}->${native} byte 0x${prevByte
        .toString(16)
        .padStart(2, '0')}->0x${byte.toString(16).padStart(2, '0')} ${
        useLive ? 'LIVE#' + spec.liveIndex : 'FLASH'
      }`
    );
    if (useLive) {
      this.setFlashPhase(spec, 'applied');
      this.queueLive(spec, native);
      return;
    }
    this.logPackedHealth();
    // A superseded sibling edit on the same packed byte (another field of the
    // same body byte queued since) is folded into the composed byte this write
    // will commit — its badge must not stay stuck half-lit.
    const thisKey = this.fieldKey(spec);
    for (const k of Array.from(this.flashPhase.keys())) {
      if (k !== thisKey && k.startsWith(spec.index + ':')) this.flashPhase.delete(k);
    }
    this.setFlashPhase(spec, 'pending');
    this.discretePending = { p, byte, spec };
    if (this.discreteTimer) return;
    this.discreteTimer = setTimeout(() => {
      this.discreteTimer = null;
      this.flushDiscrete();
    }, 300);
  }

  private flushDiscrete(): void {
    const v = this.discretePending;
    if (!v || this.discreteInFlight) return;
    this.discreteInFlight = true;
    this.discretePending = null;
    this.setFlashPhase(v.spec, 'writing');
    this.api.control({ index: v.p.index, value: v.byte }).subscribe({
      next: (r) => {
        this.discreteInFlight = false;
        if ([26, 30, 32, 38].includes(v.p.index)) this.packedBaseline[v.p.index] = v.byte;
        if (r && typeof r.readback === 'number') {
          this.setFlashPhase(v.spec, 'applied');
          if (!this.discretePending || this.discretePending.p.index !== v.p.index) {
            const pr = this.paramFor(v.p.index);
            if (pr) pr.value = r.readback;
          }
          if ([26, 30, 32, 38].includes(v.p.index)) this.packedBaseline[v.p.index] = r.readback;
          this.logAction(
            `FLASH idx=${v.p.index} byte=0x${v.byte.toString(16).padStart(2, '0')} readback=0x${r.readback
              .toString(16)
              .padStart(2, '0')}`
          );
        }
        this.logPackedHealth();
        this.flushDiscrete();
      },
      error: (e) => {
        this.discreteInFlight = false;
        this.flashPhase.delete(this.fieldKey(v.spec));
        this.slotError = 'Commit failed: ' + (e.message ?? e);
      },
    });
  }

  // Native <select> changes (no ngModel — see engine-select v3 lesson).
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

  onSegmentChange(spec: ControlSpec, p: SlotParam, field: number): void {
    if (field < 0 || field > spec.max || this.fieldValue(spec, p) === field) return;
    this.setField(spec, p, field);
  }

  selectOptionSelected(spec: ControlSpec, p: SlotParam, opt: { value: number }): boolean {
    return this.fieldValue(spec, p) === opt.value;
  }

  // Out-of-range/unknown field values render as a marked "?? N (unknown)" option.
  selectValueKnown(spec: ControlSpec, p: SlotParam): boolean {
    return !!spec.options?.some((o) => o.value === this.fieldValue(spec, p));
  }

  // Distortion-engine selects (body bytes 4/17) render full-width of their group
  // so the long engine names are legible instead of cramped into a 66px column.
  isEngineSpec(spec: ControlSpec): boolean {
    return spec.type === 'select' && (spec.index === 4 || spec.index === 17);
  }

  // Dynamic knob titles for the Mid A/B band LEVEL controls (body 11/12/24/25):
  // the "Left Mid A 126 Hz" style label should track the current value of the
  // corresponding Mid Frequency knob (body 33 = Mid A Frequency, body 36 = Mid B
  // Frequency), so turning the frequency is reflected in the whole band's title.
  // No Hz scaling exists — the raw 0..255 native byte value is shown.
  controlLabel(spec: ControlSpec): string {
    if (spec.index === 11 || spec.index === 24) {
      const prefix = spec.index === 24 ? 'Right' : 'Left';
      return `${prefix} Mid A ${this.paramFor(33)?.value ?? 0} Hz`;
    }
    if (spec.index === 12 || spec.index === 25) {
      const prefix = spec.index === 25 ? 'Right' : 'Left';
      return `${prefix} Mid B ${this.paramFor(36)?.value ?? 0} Hz`;
    }
    return spec.name;
  }

  // Field-scoped "modified" highlight: only the field the user actually changed
  // lights up, even inside packed bytes — editing Treble Shelf Slope must not
  // mark Treble Cut Filter / Boost Max / Rolloff as changed just because they
  // share body byte 30. Written bytes/overrides stay byte-level; this is purely
  // presentational, so a sibling edit can never mask a genuinely dirty field.
  fieldChanged(spec: ControlSpec, p: SlotParam): boolean {
    const snap = this.paramsSnapshot.find((s) => s.index === p.index);
    return !!snap && this.fieldValue(spec, snap) !== this.fieldValue(spec, p);
  }

  // Circular dial geometry: a spec's field value maps to a 270° sweep starting
  // at the lower-left (135° in screen coords, where Y is down and clockwise is
  // positive) and sweeping clockwise through the bottom to the lower-right at
  // the field's max (packed fields sweep their own range, not 0..255).
  private knobAngle(spec: ControlSpec, p: SlotParam): number {
    return 135 + (this.fieldValue(spec, p) / this.toUIMax(spec)) * 270;
  }

  pointerX(spec: ControlSpec, p: SlotParam): number {
    return 20 + 13 * Math.cos((this.knobAngle(spec, p) * Math.PI) / 180);
  }

  pointerY(spec: ControlSpec, p: SlotParam): number {
    return 20 + 13 * Math.sin((this.knobAngle(spec, p) * Math.PI) / 180);
  }

  // Arc length: 0..100% of the track circumference (circumference = 2*pi*16).
  arcDash(spec: ControlSpec, p: SlotParam): string {
    const frac = this.fieldValue(spec, p) / this.toUIMax(spec);
    const C = 2 * Math.PI * 16;
    return `${(C * frac).toFixed(2)} ${C.toFixed(2)}`;
  }

  // Rotation that places the SVG arc's start at the lower-left (135°), matching
  // the value-0 pointer. The arc then sweeps clockwise as value rises.
  arcRotate(): number {
    return 135;
  }

  // --- Knob interaction -------------------------------------------------------
  // A circular knob drags vertically: drag up = increase, down = decrease. The
  // sensitivity (~4 px per value step) makes a full range reachable in a much
  // shorter movement than the old 255px slider. Wheel also works.
  //
  // Scroll/drag mode is only "armed" while the pointer is inside the knob:
  // entering the knob shows the scroll cursor and enables dragging; leaving it
  // (or releasing) ends the drag so the knob never stays in a captured state.
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
    // Only start a drag if the pointer is inside the knob (armed via enter).
    if (this.hoveredParam !== p) return;
    this.activeKnob = { spec, p, lastY: e.clientY };
    e.preventDefault();
  }

  knobMove(e: PointerEvent, spec: ControlSpec, p: SlotParam): void {
    // No pointer capture: pointermove only fires while the cursor is over the
    // knob, so leaving the knob naturally stops the drag.
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

  // Persist the current state to the SELECTED slot, then recall it (via the
  // backend's import-path writePreset) so you hear the saved changes. The backend
  // uses the pedal's LIVE control table (physical-knob + realtime edits) overlaid
  // with the UI edits, then re-activates the slot.
  saveSlot(): void {
    if (!this.slotParams || this.selectedSlotIdx === null) return;
    this.slotBusy = true;
    this.slotError = null;
    const keys = Object.keys(this.editedOverrides);
    const b30ov = this.editedOverrides[30];
    this.logAction(
      `SAVE idx=${this.selectedSlotIdx} overrides=${keys.length} byte30Override=${b30ov !== undefined ? '0x' + b30ov.toString(16).padStart(2, '0') : 'none'}`
    );
    this.api.slotSave({ overrides: this.editedOverrides, idx: this.selectedSlotIdx }).subscribe({
      next: (r) => {
        this.slotBusy = false;
        if (!r.ok || r.error) {
          this.slotError = r.error || 'Save failed';
          return;
        }
        // Reload the slot body so the workbench reflects what was actually saved.
        this.loadSlotParams(this.selectedSlotIdx!);
      },
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Save failed: ' + (e.message ?? e);
      },
    });
  }

  revertSlot(): void {
    if (!this.slotParams) return;
    this.slotParams.params = this.paramsSnapshot.map((p) => ({ ...p }));
    this.slotsDirty = false;
    this.editedOverrides = {};
    for (const p of this.paramsSnapshot) {
      if ([26, 30, 32, 38].includes(p.index)) this.packedBaseline[p.index] = p.value;
    }
    this.packedUserTouched = new Set<number>();
    this.logAction('REVERT: workbench returned to snapshot');
  }

  // Set every knob of the selected slot to 0: update the workbench values, send
  // each zeroed live via CTRL_SET (realtime), and mark edited so Save persists it.
  // Live writes go through the control-map spec liveIndex (body<->live numbering
  // diverges at 26+, and packed bytes 26/30/32/38 have no 1:1 live byte), so a
  // body index is never poked at wrong live control; packed bytes are zeroed
  // whole via the byte overrides on Save.
  allParamsZero(): void {
    if (!this.slotParams) return;
    this.slotError = null;
    const sentLive = new Set<number>();
    for (const p of this.slotParams.params) {
      p.value = 0;
      this.editedOverrides[p.index] = 0;
      if ([26, 30, 32, 38].includes(p.index)) this.packedUserTouched.add(p.index);
      this.slotsDirty = true;
      const specs = this.controlSpecsByIndex.get(p.index) || [];
      for (const s of specs) {
        if (s.liveIndex != null && !sentLive.has(s.liveIndex)) {
          sentLive.add(s.liveIndex);
          this.queueLive(s, 0);
        }
      }
    }
    for (const b of [26, 30, 32, 38]) this.packedBaseline[b] = 0;
    this.logAction('ZERO all 53 bytes (packed 26/30/32/38 -> 0 intended) live=' + sentLive.size);
  }

  // Restore all 6 preset slots from a user-selected .osbf backup file.
  // Opens a file picker first; on selection, sends the file content to the
  // backend which writes all 6 slots and recalls the previously-active preset.
  restoreBackup(): void {
    const input = this.restoreFileInput.nativeElement;
    input.value = '';
    input.click();
  }

  onRestoreFileSelected(event: Event): void {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!confirm('Restore all 6 preset slots from this backup file?\nThis overwrites every slot on the pedal.')) return;

    const reader = new FileReader();
    reader.onload = () => {
      const text = reader.result as string;
      this.slotBusy = true;
      this.slotError = null;
      this.restoreResult = null;
      this.api.restore(text).subscribe({
        next: (r) => {
          this.slotBusy = false;
          this.restoreResult = r;
          if (!r.ok || r.error) {
            this.slotError = r.error || 'Restore failed';
          }
          if (this.selectedSlotIdx !== null) this.loadSlotParams(this.selectedSlotIdx);
        },
        error: (e) => {
          this.slotBusy = false;
          this.slotError = 'Restore failed: ' + (e.error?.error || e.message || e);
        },
      });
    };
    reader.readAsText(file, 'latin1');
  }

  exportAll(): void {
    window.open(this.api.exportAllUrl(), '_blank');
  }

  openInspect(): void {
    this.activeTab = 'inspect';
    if (!this.inspectData) this.loadInspect();
  }

  loadInspect(): void {
    this.inspectBusy = true;
    this.inspectError = null;
    let done = 0;
    const check = () => { if (++done === 2) this.inspectBusy = false; };
    this.api.eeprom().subscribe({
      next: (d) => { this.inspectData = d; check(); },
      error: (e) => { this.inspectError = 'EEPROM load failed: ' + (e.message ?? e); this.inspectBusy = false; },
    });
    this.api.osbf().subscribe({
      next: (d) => { this.inspectOsbf = d; check(); },
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

  get midiMapBound(): { cc: number; ctrl: number }[] {
    if (!this.inspectData) return [];
    const result: { cc: number; ctrl: number }[] = [];
    for (let i = 0; i < this.inspectData.midiMap.ccToControl.length; i++) {
      if (this.inspectData.midiMap.ccToControl[i] !== 0xff) {
        result.push({ cc: i, ctrl: this.inspectData.midiMap.ccToControl[i] });
      }
    }
    return result;
  }

  exportRefUrl(id: string): string {
    return this.api.exportRefUrl(id);
  }

  // --- Randomizer ----------------------------------------------------------
  // Generates random scenes from the control map (all controls, or per-group
  // selections), applies them LIVE (realtime CTRL_SET for 1:1 live specs,
  // in-place packed bytes otherwise), and offers play/pause auto mode, scene
  // history (back/forward), and full CRUD over control groups + saved presets.
  // Groups and presets persist to backend JSON files via /api/randomize/*.
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
        this.randPresetSlots = this.randPresets.map((p) => p.slot ?? 3);
      },
      error: () => (this.randPresets = []),
    });
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

  // Current 53-byte body from the loaded slot params (source of truth for scene
  // generation/saving — the workbench state is what you hear and see).
  private bodyValues(): number[] {
    const out = new Array<number>(53).fill(0);
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
  // (so Save persists it) and send each changed spec with a 1:1 live control via
  // CTRL_SET. Multi-spec packed bytes (26/30/32/38) fire per-spec sub-fields,
  // never the whole byte, so sibling bits are never clobbered.
  private applyScene(body: number[]): void {
    if (!this.slotParams) return;
    this.slotError = null;
    const changed = this.slotParams.params.filter((p, i) => p.value !== body[i]);
    for (const p of changed) {
      p.value = body[p.index];
      this.editedOverrides[p.index] = body[p.index];
      this.slotsDirty = true;
    }
    for (const spec of this.controlMap) {
      if (spec.liveIndex == null) continue;
      const p = this.paramFor(spec.index);
      if (!p || changed.indexOf(p) === -1) continue;
      this.queueLive(spec, this.fieldValue(spec, p));
    }
  }

  generateScene(): void {
    if (!this.slotParams) {
      this.randError = 'Load a slot first (Workbench tab) — randomizing needs a base sound.';
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

  savePreset(): void {
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
    if (body.length !== 53 || !this.slotParams) {
      this.randError = 'Cannot load preset — bad body or no slot loaded.';
      return;
    }
    this.randError = null;
    this.pushScene(body);
    this.applyScene(body);
  }

  savePresetToSlot(p: RandomizePreset, slotIdx: number): void {
    this.randBusy = true;
    this.randError = null;
    this.api.randomizePresetUpdate(p.id, { saveToSlot: slotIdx, name: p.name }).subscribe({
      next: () => {
        this.randBusy = false;
        this.refreshRand();
        this.loadSlots();
        this.loadSlotParams(slotIdx);
      },
      error: (e) => {
        this.randBusy = false;
        this.randError = 'Preset → slot save failed: ' + ((e as { message?: string }).message ?? e);
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

  private afterChange(row: RowModel): void {
    this.api.presets().subscribe({
      next: (p: LaladyPresets) => {
        const upd = p.slots.find((s) => s.page === row.slot.page);
        if (upd) row.slot = upd;
      },
      error: () => {
        /* ignore refresh errors */
      },
    });
  }

  stateLabel(row: RowModel): string {
    const s = row.state;
    if (s.kind === 'busy') return s.label;
    if (s.kind === 'ok') return s.label;
    if (s.kind === 'err') return s.label;
    return '';
  }

  isBusy(row: RowModel): boolean {
    return row.state.kind === 'busy';
  }

  stateClass(row: RowModel): string {
    const s = row.state;
    if (s.kind === 'busy') return 'busy';
    if (s.kind === 'ok') return 'ok';
    if (s.kind === 'err') return 'err';
    return 'idle';
  }
}
