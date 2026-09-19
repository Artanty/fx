import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Subject, takeUntil } from 'rxjs';
import { ApiService, H90TurnRequest } from '../../services/api.service';
import { PatchDetail, PatchSlot } from '../../models';
import { knobLabel } from '../../h90-labels';

const SLOT_META_KEYS = new Set(['algorithm_name', 'preset_name', 'product_id', 'version']);

interface SlotKnobRow {
  label: string;
  value: string;
}

export interface SlotViewModel {
  slot: 'A' | 'B' | null;
  index: number | null;
  algorithm: string | null;
  preset_name: string | null;
  rows: SlotKnobRow[];
}

@Component({
  selector: 'app-preset-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './preset-detail.component.html',
  styleUrl: './preset-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetDetailComponent implements OnInit, OnDestroy {
  patch: PatchDetail | null = null;
  error: string | null = null;
  loading = true;

  knobs: { name: string; turns: number }[] = [];
  presetAnchor = '';
  knobBusy = false;
  knobError: string | null = null;
  knobLog = '';

  downloading = false;
  downloadError: string | null = null;
  savedMessage: string | null = null;
  syncBusy = false;
  syncLog = '';

  // per-slot assignment state (keyed by slot list index)
  assignBusy: Record<number, boolean> = {};
  assignProgram: Record<number, number> = {};
  assignResult: Record<number, string> = {};

  private destroyed = new Subject<void>();

  constructor(private route: ActivatedRoute, private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error = 'No preset specified.';
      this.loading = false;
      return;
    }
    this.api.getPatch(slug).subscribe({
      next: (p) => {
        this.patch = p;
        this.loading = false;
        this.cdr.markForCheck();
        if (!p.saved_input) this.saveToInput();
      },
      error: () => {
        this.error = 'Preset not found.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }

  isLocal(): boolean {
    return !!this.patch?.path;
  }

  downloadUrl(): string {
    return this.patch ? this.api.getFileDownloadUrl(this.patch.file_id) : '#';
  }

  download(): void {
    if (!this.patch || this.downloading) return;
    if (this.isLocal()) {
      window.location.href = this.downloadUrl();
      return;
    }
    this.saveToInput();
  }

  saveToInput(): void {
    if (!this.patch || this.downloading) return;
    this.downloading = true;
    this.downloadError = null;
    this.savedMessage = null;
    this.cdr.markForCheck();
    this.api.saveH90FileToInput(this.patch.file_id).subscribe({
      next: (r) => {
        this.downloading = false;
        if (!r.ok) {
          this.downloadError = r.stderr || r.log || 'save failed';
          this.cdr.markForCheck();
          return;
        }
        this.savedMessage = `Saved to input/patchstorage (${r.preset_name || this.patch?.filename || 'file'}).`;
        this.api.getPatch(this.patch!.slug).subscribe((p) => {
          this.patch = p;
          this.cdr.markForCheck();
        });
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.downloading = false;
        this.downloadError = e?.error?.error || e?.message || 'request failed';
        this.cdr.markForCheck();
      },
    });
  }

  syncAll(): void {
    if (this.syncBusy) return;
    this.syncBusy = true;
    this.syncLog = 'Starting sync...';
    this.cdr.markForCheck();
    this.api
      .syncH90()
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (e) => {
          if (e.line) this.syncLog += '\n' + e.line;
          if (e.ok !== undefined) {
            this.syncLog += '\n' + (e.ok ? 'DONE.' : 'FAILED: ' + (e.stderr || ''));
          }
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.syncBusy = false;
          this.syncLog += '\nERROR: ' + (e?.message || e);
          this.cdr.markForCheck();
        },
        complete: () => {
          this.syncBusy = false;
          this.cdr.markForCheck();
        },
      });
  }

  formatDate(s: string | null): string {
    if (!s) return '—';
    return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatNumber(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  filesize(): string {
    if (!this.patch?.filesize) return '';
    const b = this.patch.filesize;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }

  slotViews(): SlotViewModel[] {
    if (!this.patch?.slots) return [];
    return this.patch.slots.map((s, i) => ({
      slot: s.slot,
      index: i,
      algorithm: s.algorithm,
      preset_name: s.preset_name,
      rows: this.slotRows(s),
    }));
  }

  slotBadge(sv: SlotViewModel): string {
    // labelled rows (<=2 blobs) keep "Slot A/B" (imported), list rows are "#N"
    if (sv.slot === 'A' || sv.slot === 'B') return 'Slot ' + sv.slot;
    return '#' + (sv.index! + 1);
  }

  canAssign(sv: SlotViewModel): boolean {
    if (!this.patch || this.patch.file_id == null || sv.index == null) return false;
    const slot = this.patch.slots?.[sv.index];
    return !!slot && slot.blob_index != null;
  }

  private slotBlobIndex(sv: SlotViewModel): number {
    return this.patch?.slots?.[sv.index!]?.blob_index as number;
  }

  assignProgramOf(sv: SlotViewModel): number {
    return this.assignProgram[sv.index!] ?? 1;
  }

  setAssignProgram(sv: SlotViewModel, value: string): void {
    const n = Number(value);
    if (sv.index == null || !Number.isInteger(n) || n < 1 || n > 100) return;
    this.assignProgram[sv.index] = n;
  }

  assignBusyOf(sv: SlotViewModel): boolean {
    return sv.index != null && !!this.assignBusy[sv.index];
  }

  assignResultOf(sv: SlotViewModel): string {
    return sv.index != null ? this.assignResult[sv.index] || '' : '';
  }

  assign(sv: SlotViewModel, slot: 'A' | 'B'): void {
    if (!this.canAssign(sv) || this.assignBusy[sv.index!]) return;
    const idx = sv.index!;
    this.assignBusy[idx] = true;
    this.assignResult[idx] = '';
    this.cdr.markForCheck();
    this.api.assignH90(this.patch!.file_id, this.slotBlobIndex(sv), this.assignProgramOf(sv), slot).subscribe({
      next: (r) => {
        if (r.sent && r.sent.length) r.log = r.sent.map((s) => `CC ${s.cc} ${s.control}=${s.value}`).join('\n');
        this.assignResult[idx] = r.error || 'Assigned slot ' + slot + '.';
        if (r.skipped && r.skipped.length) {
          this.assignResult[idx] += '\nSkipped:\n' + r.skipped.map((s) => `${s.control} — ${s.reason}`).join('\n');
        }
        if (r.log) this.assignResult[idx] += '\n' + r.log;
      },
      error: (e) => {
        this.assignResult[idx] = 'ERROR: ' + (e?.error?.error || e?.message || e);
      },
      complete: () => {
        this.assignBusy[idx] = false;
        this.cdr.markForCheck();
      },
    });
  }

  private slotRows(s: PatchSlot): SlotKnobRow[] {
    const out: SlotKnobRow[] = [];
    for (const [key, val] of Object.entries(s.knobs || {})) {
      if (SLOT_META_KEYS.has(key)) continue;
      out.push({ label: knobLabel(s.algorithm, key), value: this.formatKnobValue(s, key, val) });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }

  private formatKnobValue(s: PatchSlot, key: string, val: number | boolean | string): string {
    if (key === 'x_switch' || key === 'y_switch' || key === 'z_switch') {
      return typeof val === 'string' ? knobLabel(s.algorithm, val) : String(val);
    }
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return String(val);
      return String(Number(val.toFixed(3)));
    }
    if (typeof val === 'boolean') return val ? 'on' : 'off';
    return String(val);
  }

  scanKnobs(): void {
    this.knobBusy = true;
    this.knobError = null;
    this.knobLog = 'Scanning visible knobs...';
    this.api.scanH90Knobs().subscribe({
      next: (r) => {
        this.knobBusy = false;
        this.knobLog = r.log || '(no driver output)';
        this.knobs = r.knobs.map((name) => ({ name, turns: 1 }));
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.knobBusy = false;
        this.knobLog = '';
        this.knobError = e?.error?.error || e?.message || 'request failed';
        this.cdr.markForCheck();
      },
    });
  }

  incrTurns(k: { turns: number }): void {
    k.turns += 1;
  }

  decrTurns(k: { turns: number }): void {
    k.turns -= 1;
  }

  turnKnob(k: { name: string; turns: number }): void {
    const body: H90TurnRequest = { knobs: [{ name: k.name, turns: k.turns }] };
    if (this.presetAnchor.trim()) body.preset = this.presetAnchor.trim();
    this.runKnobDriver(body);
  }

  turnAllKnobs(): void {
    if (this.knobs.length === 0) return;
    const body: H90TurnRequest = { knobs: this.knobs.map((k) => ({ name: k.name, turns: k.turns })) };
    if (this.presetAnchor.trim()) body.preset = this.presetAnchor.trim();
    this.runKnobDriver(body);
  }

  private runKnobDriver(body: H90TurnRequest): void {
    this.knobBusy = true;
    this.knobError = null;
    this.knobLog = 'Running SikuliX driver...';
    this.api.turnH90Knobs(body).subscribe({
      next: (r) => {
        this.knobBusy = false;
        this.knobLog = r.log || '(no driver output)';
        if (r.stderr) this.knobLog += '\nstderr: ' + r.stderr;
        if (!r.ok) this.knobError = 'Driver exited with code ' + r.code;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.knobBusy = false;
        this.knobLog = '';
        this.knobError = e?.error?.error || e?.message || 'request failed';
        this.cdr.markForCheck();
      },
    });
  }
}
