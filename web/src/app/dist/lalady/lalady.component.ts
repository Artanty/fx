import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LaladyApiService } from './lalady-api.service';
import { LaladyMidiService } from './lalady-midi.service';
import { LaladyPresets, LaladySlot, LaladyStatus, LiveControls, RestoreResult, SlotParam, SlotParams, WriteResult, ControlSpec } from './lalady.models';

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

  activeTab: 'slots' | 'workbench' | 'monitor' = 'workbench';
  private pendingImportRow: RowModel | null = null;

  rows: RowModel[] = [];
  deviceFound = false;
  deviceError: string | null = null;
  loading = true;

  // Live Left Drive control (control index 2, 0..255). Moved while dragging to
  // drive the "Left Drive" parameter in the Neuro editor via a real-time
  // CTRL_SET write (frame [0x70, 0x02, 0x00, value]).
  leftDrive = 128;
  leftDriveReadback: number | null = null;

  /** Important: column specifier int, e.g. left_drive = 2 */
  readonly LEFT_DRIVE_CTRL = 2;

  // Realtime read-only monitor: polls GET /api/controls and displays the pedal's
  // current live knob values, reflecting external changes (e.g. made in the
  // Neuro editor) without writing anything back.
  monitor: LiveControls | null = null;
  monitorOn = false;
  private monitorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MONITOR_POLL_MS = 5000;

  // Workbench live mirror: a low-rate poll of /api/controls that reconciles
  // workbench knob positions to the pedal's CURRENT live control table, so
  // external changes (MIDI board sends a CC, physical knob turned, Neuro edit)
  // move the on-screen knobs. Only fields that have a 1:1 live control
  // (spec.liveIndex) can be mirrored; the rest keep their last-known value.
  private mirrorTimer: ReturnType<typeof setInterval> | null = null;
  private readonly MIRROR_POLL_MS = 2000;

  // Workbench control map (GET /api/control-map): how each preset-body byte
  // decomposes into Neuro-style UI controls. This is the 53-byte BODY layout
  // (body index 26+ differs from the live control table), so these specs drive
  // what workbench edits — labels, kinds and bit-fields.
  controlMap: ControlSpec[] = [];
  private controlSpecsByIndex = new Map<number, ControlSpec[]>();
  private controlToCc = new Map<number, number>();
  // liveIndex -> last time we sent a CC for it; the mirror skips any control CC'd
  // within the last CC_GRACE_MS so the pedal's quantized 7-bit value doesn't
  // immediately yank the full-resolution knob back right after a turn.
  private recentCc = new Map<number, number>();
  private static CC_GRACE_MS = 3000;

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

  get knobRows(): { title: string; controls: { spec: ControlSpec; p: SlotParam }[] }[][] {
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
    return this.KNOB_ROWS.map((rowIdx) => rowIdx.map((gi) => groups[gi]));
  }

  restoreResult: RestoreResult | null = null;

  // Pedal hardware config (MIDI channel etc.) from GET /api/status.
  deviceInfo: LaladyStatus | null = null;

  // Browser-native MIDI engage/bypass (CC 102 on the pedal's MIDI channel):
  // midiBypassed = pedal is currently bypassed (off); clicking toggles it.
  midiEngageSupported = false;
  midiBypassed = true;
  midiEngageMsg: string | null = null;

  constructor(private api: LaladyApiService, private midi: LaladyMidiService) {}

  ngOnInit(): void {
    this.refresh();
    this.refreshDeviceInfo();
    this.autoSelectActive();
    this.midiEngageSupported = this.midi.isSupported();
    this.api.controlMap().subscribe({
      next: (r) => {
        this.controlMap = r.controls || [];
        this.controlSpecsByIndex = new Map();
        for (const s of this.controlMap) {
          const list = this.controlSpecsByIndex.get(s.index) || [];
          list.push(s);
          this.controlSpecsByIndex.set(s.index, list);
        }
        this.fetchMidiMap();
      },
      error: () => (this.controlMap = []),
    });
    this.startMirror();
  }

  private fetchMidiMap(): void {
    this.api.midimap().subscribe({
      next: (r) => {
        if (!r || !r.ok) return;
        this.controlToCc = new Map(
          Object.entries(r.controlToCc).map(([k, v]) => [Number(k), v])
        );
        for (const s of this.controlMap) {
          s.cc = this.controlToCc.get(s.liveIndex!) ?? null;
        }
      },
      error: () => {
        /* device offline; no CC info, HID-only */
      },
    });
  }

  // On a fresh session nothing is selected, so Save / all-0 / Engage are all
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

  // Fetches hardware config (firmware, MIDI channel, bypass mode) so the MIDI
  // channel — needed to send CC messages like the engage/bypass bind — is shown
  // in the Workbench. MIDI channel is 0-based on the backend; display 1-based.
  refreshDeviceInfo(): void {
    this.api.status().subscribe({
      next: (s) => {
        this.deviceInfo = s;
        // Drive the browser MIDI service on the pedal's real channel.
        this.midi.channel = s.config.midiChannel + 1;
      },
      error: () => (this.deviceInfo = null),
    });
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

  ngOnDestroy(): void {
    this.stopMonitor();
    this.stopMirror();
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

  onLeftDrive(): void {
    this.commitLeftDrive(this.leftDrive);
  }

  // Commit the Left Drive value into the ACTIVE flash preset (single write on
  // slider release). This is a lossless in-place byte patch + re-activate, so the
  // pedal and Neuro load OUR persisted value instead of fighting over a live RAM
  // control table. Because it's a slow flash commit (~2s), only one runs at a
  // time and later releases are re-sent until the commit finishes.
  private leftDriveCommitPending = false;
  private leftDriveCommitValue: number | null = null;

  private commitLeftDrive(value: number): void {
    if (this.leftDriveCommitPending) {
      this.leftDriveCommitValue = value;
      return;
    }
    this.leftDriveCommitPending = true;
    this.api.control({ index: this.LEFT_DRIVE_CTRL, value }).subscribe({
      next: (r) => {
        this.leftDriveCommitPending = false;
        this.leftDriveReadback = r.readback ?? null;
        if (this.leftDriveCommitValue !== null) {
          const v = this.leftDriveCommitValue;
          this.leftDriveCommitValue = null;
          this.commitLeftDrive(v);
        }
      },
      error: (e) => {
        this.leftDriveCommitPending = false;
        this.leftDriveCommitValue = null;
        this.leftDriveReadback = null;
        this.deviceError = 'Left Drive commit failed: ' + (e.message ?? e);
      },
    });
  }

  toggleMonitor(): void {
    if (this.monitorOn) {
      this.stopMonitor();
    } else {
      this.startMonitor();
    }
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
    this.mirrorTimer = setInterval(() => this.mirrorControls(), this.MIRROR_POLL_MS);
  }

  private stopMirror(): void {
    if (this.mirrorTimer) {
      clearInterval(this.mirrorTimer);
      this.mirrorTimer = null;
    }
  }

  // Reconcile workbench fields from the pedal's live control table. Each spec
  // with spec.liveIndex reads the live table's value for that index (values are
  // identical body<->live, no scaling) and, when it differs from what the UI
  // shows, rewrites the field's bits inside the UI body byte and marks it as an
  // edit so Save persists it (overrides are applied after the backend's live
  // copy). A knob currently being dragged is skipped so the mirror never fights
  // the user's hand; the poll rate (2s) just lags wrist turns slightly.
  private mirrorControls(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (!m || !Array.isArray(m.controls)) return;
        const byIndex = new Map<number, number>();
        for (const c of m.controls) {
          if (typeof c.value === 'number') byIndex.set(c.index, c.value);
        }
        if (!byIndex.size || !this.slotParams) return;
        for (const s of this.controlMap) {
          if (s.liveIndex == null) continue;
          const live = byIndex.get(s.liveIndex);
          if (typeof live !== 'number') continue;
          if (this.activeKnob && this.activeKnob.spec === s) continue;
          // Skip knobs we just moved via CC so the 7-bit readback doesn't fight
          // the user's 0..255 knob position.
          const lastCc = this.recentCc.get(s.liveIndex) ?? 0;
          if (Date.now() - lastCc < LaladyComponent.CC_GRACE_MS) continue;
          const p = this.paramFor(s.index);
          if (!p) continue;
          const nativeField = Math.max(0, Math.min(s.max, live));
          const uiField = this.toUI(s, nativeField);
          if (this.fieldValue(s, p) === uiField) continue;
          p.value = (p.value & ~s.mask) | ((nativeField << s.shift) & s.mask);
          this.editedOverrides[p.index] = p.value;
          this.slotsDirty = true;
        }
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
      },
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Load params failed: ' + (e.message ?? e);
      },
    });
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
      for (const [liveIndex, { spec: s, value: v }] of this.livePending) {
        if (s.cc != null) {
          // CC is 7-bit; value here is the native 0..255, scaled to 0..127 for
          // knobs (selects/toggles pass their discrete value through unchanged).
          this.midi.sendCc(s.cc, this.toUI(s, v));
          this.recentCc.set(liveIndex, Date.now());
        } else {
          // HID path expects the native 0..255 value.
          this.api.controlLive({ index: liveIndex, value: v }).subscribe({
            error: (e) => (this.slotError = 'Realtime set failed: ' + (e.message ?? e)),
          });
        }
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
  // shift 0/mask 0xff return the raw byte). For continuous knobs this is the
  // 0..127 UI value (pedal's native 0..255 halved), so the workbench knob domain
  // maps 1:1 to 7-bit MIDI CC — friendly for external MIDI hardware sending CC.
  fieldValue(spec: ControlSpec, p: SlotParam): number {
    const raw = (p.value & spec.mask) >>> spec.shift;
    return this.toUI(spec, raw);
  }

  // Continuous knobs use a 0..127 UI/CC domain; everything else is its raw byte.
  private isKnob(spec: ControlSpec): boolean {
    return spec.type === 'knob';
  }
  private toUI(spec: ControlSpec, native: number): number {
    if (!this.isKnob(spec)) return native;
    return Math.min(127, Math.round(native / 2));
  }
  private toNative(spec: ControlSpec, ui: number): number {
    return this.isKnob(spec) ? Math.min(255, ui * 2) : ui;
  }
  private toUIMax(spec: ControlSpec): number {
    return this.isKnob(spec) ? 127 : spec.max;
  }

  // Debounced flash commit for packed/bit-field controls: writes the FULL byte
  // (composed from the sibling bits already in p.value) via /api/control — the
  // lossless in-place patch + re-activate. Live CTRL_SET index numbering differs
  // from the body layout at 26+, so packed items must NOT go through controlLive
  // (it would write a whole body byte, clobbering sibling fields). One commit at
  // a time; later edits during the ~2s flash are coalesced and re-sent.
  private discreteTimer: ReturnType<typeof setTimeout> | null = null;
  private discretePending: { p: SlotParam; byte: number } | null = null;
  private discreteInFlight = false;

  // Record a changed field and route the write: fields with a 1:1 live control
  // (spec.liveIndex, e.g. body 27 Gate Threshold -> live 26, body 26 Filter
  // Gate -> live 38) go realtime via CTRL_SET at the LIVE index; body-only
  // packed fields (30/32/38) go to the flash-commit queue.
  private setField(spec: ControlSpec, p: SlotParam, uiValue: number): void {
    // Continuous knobs accept the 0..127 UI value; double it for the native
    // 0..255 byte so Save/overrides and the pedal agree.
    const native = this.toNative(spec, uiValue);
    const byte = (p.value & ~spec.mask) | ((native << spec.shift) & spec.mask);
    p.value = byte;
    this.slotsDirty = true;
    this.editedOverrides[p.index] = byte;
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

  private flushDiscrete(): void {
    const v = this.discretePending;
    if (!v || this.discreteInFlight) return;
    this.discreteInFlight = true;
    this.discretePending = null;
    this.api.control({ index: v.p.index, value: v.byte }).subscribe({
      next: (r) => {
        this.discreteInFlight = false;
        if (r && typeof r.readback === 'number') {
          const pr = this.paramFor(v.p.index);
          if (pr) pr.value = r.readback;
        }
        this.flushDiscrete();
      },
      error: (e) => {
        this.discreteInFlight = false;
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

  // Original (snapshot) value for a param, used to highlight edited knobs.
  initialValue(index: number): number {
    const snap = this.paramsSnapshot.find((s) => s.index === index);
    return snap ? snap.value : 0;
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
  }

  // Set every knob of the selected slot to 0: update the workbench values, send
  // each live via CTRL_SET (realtime), and mark edited so Save persists it.
  allParamsZero(): void {
    if (!this.slotParams) return;
    this.slotError = null;
    for (const p of this.slotParams.params) {
      p.value = 0;
      this.editedOverrides[p.index] = 0;
      this.slotsDirty = true;
      this.api.controlLive({ index: p.index, value: 0 }).subscribe({
        error: (e) => (this.slotError = 'Realtime set failed: ' + (e.message ?? e)),
      });
    }
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
