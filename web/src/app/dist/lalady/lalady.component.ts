import { CommonModule } from '@angular/common';
import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LaladyApiService } from './lalady-api.service';
import { LaladyPresets, LaladySlot, LaladyStatus, LiveControls, RestoreResult, SlotParam, SlotParams, WriteResult } from './lalady.models';

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

  // Workbench param grouping for the knob panel. Each group is a titled,
  // bordered section; the first two groups share a row (Dist 1 | Dist 2), the
  // Param EQ shares a row, and Noise gate sits alone. Indices follow CONTROL_NAMES.
  private readonly KNOB_GROUPS = [
    { title: 'Dist 1', indices: [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12] },
    { title: 'Dist 2', indices: [13, 14, 15, 16, 17, 18, 20, 21, 22, 23, 24, 25] },
    { title: 'Parametric EQ', indices: [27, 28, 30, 32, 33, 34, 35, 36] },
    { title: 'Noise gate', indices: [26, 37, 38, 39] },
  ];

  // Rows of groups (each row rendered on its own line).
  readonly KNOB_ROWS = [
    [0, 1],
    [2],
    [3],
  ];

  get knobRows(): { title: string; params: SlotParam[] }[][] {
    const groups = this.KNOB_GROUPS.map((g) => ({
      title: g.title,
      params: this.slotParams
        ? g.indices
            .map((i) => this.slotParams!.params.find((p) => p.index === i))
            .filter((p): p is SlotParam => !!p)
        : [],
    }));
    return this.KNOB_ROWS.map((rowIdx) => rowIdx.map((gi) => groups[gi]));
  }

  restoreResult: RestoreResult | null = null;

  // Pedal hardware config (MIDI channel etc.) from GET /api/status.
  deviceInfo: LaladyStatus | null = null;

  constructor(private api: LaladyApiService) {}

  ngOnInit(): void {
    this.refresh();
    this.refreshDeviceInfo();
    this.autoSelectActive();
  }

  // On a fresh session nothing is selected, so Save / all-0 / Engage are all
  // disabled. Auto-select the pedal's currently-active slot so the workbench is
  // immediately usable (loads its params + enables the buttons).
  private autoSelectActive(): void {
    this.api.controls().subscribe({
      next: (m) => {
        if (m && typeof m.activeIndex === 'number' && this.selectedSlotIdx === null) {
          this.selectSlot(m.activeIndex);
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
      next: (s) => (this.deviceInfo = s),
      error: () => (this.deviceInfo = null),
    });
  }

  ngOnDestroy(): void {
    this.stopMonitor();
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

  // Engage the currently-selected slot on the pedal (recall it into the signal
  // chain via ACTIVE_SET) without reloading/editing params. Useful after live
  // knob tweaks to re-engage the preset.
  engageSlot(): void {
    if (this.selectedSlotIdx === null) return;
    this.slotBusy = true;
    this.slotError = null;
    this.api.activateSlot(this.selectedSlotIdx).subscribe({
      next: () => {
        this.slotBusy = false;
      },
      error: (e) => {
        this.slotBusy = false;
        this.slotError = 'Engage failed: ' + (e.message ?? e);
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

  // Called from the UI when a param value changes (slider release). Records the
  // edited index/value so Save can overlay it on the pedal's live control table.
  // Nothing is written until Save.
  onParamChange(p: SlotParam, value: number): void {
    p.value = value;
    this.onParamInput(p, value);
  }

  // Realtime: called on slider INPUT (while dragging) — writes the value into the
  // pedal's LIVE control table via CTRL_SET so you HEAR the change immediately,
  // without waiting for a flash commit. Not persisted; Save does that.
  // Throttled lightly to avoid flooding the USB pipe during a fast drag.
  private liveTimer: ReturnType<typeof setTimeout> | null = null;
  onParamInput(p: SlotParam, value: number): void {
    p.value = value;
    this.slotsDirty = true;
    this.editedOverrides[p.index] = value;
    if (this.liveTimer) return; // already queued; latest value is in p.value/overrides
    this.liveTimer = setTimeout(() => {
      this.liveTimer = null;
      this.api.controlLive({ index: p.index, value: this.editedOverrides[p.index] }).subscribe({
        error: (e) => (this.slotError = 'Realtime set failed: ' + (e.message ?? e)),
      });
    }, 40);
  }

  // Original (snapshot) value for a param, used to highlight edited knobs.
  initialValue(p: SlotParam): number {
    const snap = this.paramsSnapshot.find((s) => s.index === p.index);
    return snap ? snap.value : p.value;
  }

  // Circular dial geometry: value 0..255 maps to a 270° sweep starting at the
  // lower-left (135° in screen coords, where Y is down and clockwise is positive)
  // and sweeping clockwise through the bottom to the lower-right at 255.
  private knobAngle(v: number): number {
    return 135 + (v / 255) * 270;
  }

  pointerX(p: SlotParam): number {
    return 20 + 13 * Math.cos((this.knobAngle(p.value) * Math.PI) / 180);
  }

  pointerY(p: SlotParam): number {
    return 20 + 13 * Math.sin((this.knobAngle(p.value) * Math.PI) / 180);
  }

  // Arc length: 0..100% of the track circumference (circumference = 2*pi*16).
  arcDash(p: SlotParam): string {
    const frac = p.value / 255;
    const C = 2 * Math.PI * 16;
    return `${(C * frac).toFixed(2)} ${C.toFixed(2)}`;
  }

  // Rotation that places the SVG arc's start at the lower-left (135°), matching
  // the value-0 pointer. The arc then sweeps clockwise as value rises.
  arcRotate(p: SlotParam): number {
    return 135;
  }

  // --- Knob interaction -------------------------------------------------------
  // A circular knob drags vertically: drag up = increase, down = decrease. The
  // sensitivity (~4 px per value step) makes the full 0..255 range reachable in
  // a much shorter movement than the old 255px slider. Wheel also works.
  //
  // Scroll/drag mode is only "armed" while the pointer is inside the knob:
  // entering the knob shows the scroll cursor and enables dragging; leaving it
  // (or releasing) ends the drag so the knob never stays in a captured state.
  private activeKnob: { p: SlotParam; lastY: number } | null = null;
  hoveredParam: SlotParam | null = null;

  onKnobEnter(p: SlotParam): void {
    this.hoveredParam = p;
  }

  onKnobLeave(): void {
    this.hoveredParam = null;
    this.activeKnob = null;
  }

  knobDown(e: PointerEvent, p: SlotParam): void {
    this.hoveredParam = p;
    // Only start a drag if the pointer is inside the knob (armed via enter).
    if (this.hoveredParam !== p) return;
    this.activeKnob = { p, lastY: e.clientY };
    e.preventDefault();
  }

  knobMove(e: PointerEvent, p: SlotParam): void {
    // No pointer capture: pointermove only fires while the cursor is over the
    // knob, so leaving the knob naturally stops the drag.
    if (!this.activeKnob || this.activeKnob.p !== p) return;
    const dy = this.activeKnob.lastY - e.clientY;
    this.activeKnob.lastY = e.clientY;
    const v = Math.max(0, Math.min(255, Math.round(p.value + dy * 4)));
    this.onParamInput(p, v);
    e.preventDefault();
  }

  knobUp(e: PointerEvent, p: SlotParam): void {
    if (!this.activeKnob || this.activeKnob.p !== p) return;
    this.activeKnob = null;
    e.preventDefault();
  }

  knobWheel(e: WheelEvent, p: SlotParam): void {
    e.preventDefault();
    const v = Math.max(0, Math.min(255, Math.round(p.value + (e.deltaY < 0 ? 8 : -8))));
    this.onParamInput(p, v);
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
