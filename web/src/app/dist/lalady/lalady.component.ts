import { CommonModule } from '@angular/common';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LaladyApiService } from './lalady-api.service';
import { LaladyPresets, LaladySlot, WriteResult } from './lalady.models';

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
export class LaladyComponent implements OnInit {
  rows: RowModel[] = [];
  deviceFound = false;
  deviceError: string | null = null;
  loading = true;

  constructor(private api: LaladyApiService) {}

  ngOnInit(): void {
    this.refresh();
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

  onFile(row: RowModel, file: File | null): void {
    row.hasFile = !!file;
    if (row.state.kind === 'err') row.state = { kind: 'idle' };
  }

  importSlot(row: RowModel, fileInput: HTMLInputElement): void {
    const file = fileInput.files && fileInput.files[0];
    if (!file) {
      row.state = { kind: 'err', label: 'choose a .pre file first' };
      return;
    }
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
