import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ApiService } from '../../services/api.service';
import { Filters, PatchItem, PatchesResponse } from '../../models';

interface Selection {
  families: Set<string>;
  algorithms: Set<string>;
  categories: Set<string>;
  tags: Set<string>;
  extensions: Set<string>;
}

@Component({
  selector: 'app-browse',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BrowseComponent implements OnInit, OnDestroy {
  filters: Filters = { families: [], algorithms: [], categories: [], tags: [], extensions: [] };
  sel: Selection = {
    families: new Set(),
    algorithms: new Set(),
    categories: new Set(),
    tags: new Set(),
    extensions: new Set(),
  };

  search = new FormControl('');
  sortControl = new FormControl('downloads');
  page = 1;
  perPage = 24;

  data: PatchesResponse = { total: 0, page: 1, per_page: 24, pages: 1, items: [] };
  loading = false;

  tagsLimit = 30;
  showAllTags = false;

  h90Ports: { index: number; name: string }[] = [];
  h90Port = new FormControl<number | null>(null);
  h90Program = new FormControl<number>(2, [Validators.min(1), Validators.max(100)]);
  h90Channel = new FormControl<number>(11, [Validators.min(1), Validators.max(16)]);
  h90Busy = false;
  h90Status: string | null = null;

  private destroyed = new Subject<void>();

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.api.getFilters().subscribe((f) => {
      this.filters = f;
      this.cdr.markForCheck();
    });

    this.api.getH90Ports().subscribe((r) => {
      this.h90Ports = r.outputs || [];
      if (this.h90Ports.length) {
        const idx = this.h90Ports.findIndex((p) => /XC-05987|Eventide|H90/i.test(p.name));
        this.h90Port.setValue(idx >= 0 ? this.h90Ports[idx].index : this.h90Ports[0].index);
      }
      this.cdr.markForCheck();
    });

    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroyed))
      .subscribe(() => this.reload());

    this.sortControl.valueChanges
      .pipe(takeUntil(this.destroyed))
      .subscribe(() => this.reload());
  }

  sendToH90(): void {
    if (this.h90Busy) return;
    const program = this.h90Program.value;
    const channel = this.h90Channel.value;
    if (program === null || program === undefined || channel === null || channel === undefined) return;
    this.h90Busy = true;
    this.h90Status = 'Sending…';
    this.api.sendToH90(program, channel, this.h90Port.value).subscribe({
      next: (r) => {
        this.h90Busy = false;
        const hex = (r.bytes || []).map((b) => '0x' + b.toString(16).padStart(2, '0')).join(' ');
        this.h90Status = `Sent to "${r.port?.name}" → ${hex} (PC ${r.program}, ch ${r.channel})`;
        this.cdr.markForCheck();
      },
      error: (e) => {
        this.h90Busy = false;
        this.h90Status = 'Error: ' + (e.error?.error || e.message || 'failed');
        this.cdr.markForCheck();
      },
    });
  }

  reload(): void {
    this.page = 1;
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api
      .getPatches({
        families: [...this.sel.families],
        algorithms: [...this.sel.algorithms],
        categories: [...this.sel.categories],
        tags: [...this.sel.tags],
        extensions: [...this.sel.extensions],
        q: this.search.value ?? undefined,
        sort: this.sortControl.value ?? 'downloads',
        page: this.page,
        per_page: this.perPage,
      })
      .subscribe({
        next: (d) => {
          this.data = d;
          this.loading = false;
          this.cdr.markForCheck();
        },
        error: () => {
          this.loading = false;
          this.cdr.markForCheck();
        },
      });
  }

  toggle<K extends keyof Selection>(group: K, value: string): void {
    const set = this.sel[group] as Set<string>;
    set.has(value) ? set.delete(value) : set.add(value);
    this.reload();
  }

  isSelected<K extends keyof Selection>(group: K, value: string): boolean {
    return (this.sel[group] as Set<string>).has(value);
  }

  clearFilters(): void {
    Object.values(this.sel).forEach((s) => (s as Set<string>).clear());
    this.search.setValue('', { emitEvent: false });
    this.reload();
  }

  activeFilterCount(): number {
    return Object.values(this.sel).reduce((n, s) => n + (s as Set<string>).size, 0);
  }

  changePage(page: number): void {
    if (page < 1 || page > this.data.pages || page === this.page) return;
    this.page = page;
    this.load();
  }

  pageNumbers(): number[] {
    const total = this.data.pages;
    const current = this.page;
    const out: number[] = [];
    for (let i = 1; i <= total; i++) {
      if (i === 1 || i === total || Math.abs(i - current) <= 1) out.push(i);
    }
    return out;
  }

  toggleTags(): void {
    this.showAllTags = !this.showAllTags;
    this.tagsLimit = this.showAllTags ? 100000 : 30;
  }

  visibleTags(): number {
    return this.showAllTags ? this.filters.tags.length : this.tagsLimit;
  }

  formatNumber(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  trackBy(_i: number, item: PatchItem): number {
    return item.file_id;
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }
}
