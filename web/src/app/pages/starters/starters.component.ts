import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnDestroy, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { Subject, debounceTime, distinctUntilChanged, takeUntil } from 'rxjs';
import { ApiService, StarterEffect } from '../../services/api.service';

@Component({
  selector: 'app-starters',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterLink, RouterLinkActive],
  templateUrl: './starters.component.html',
  styleUrl: './starters.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StartersComponent implements OnInit, OnDestroy {
  families: string[] = [];
  effects: StarterEffect[] = [];
  total = 0;
  loading = false;

  type = new FormControl('all');
  search = new FormControl('');
  program = new FormControl<number>(2, [Validators.min(1), Validators.max(100)]);

  busy = false;
  log = '';

  private destroyed = new Subject<void>();

  constructor(private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    this.type.valueChanges.pipe(takeUntil(this.destroyed)).subscribe(() => this.load());
    this.search.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntil(this.destroyed))
      .subscribe(() => this.load());
    this.load();
  }

  load(): void {
    this.loading = true;
    this.api.getStarters(this.type.value ?? 'all', this.search.value ?? '').subscribe({
      next: (d) => {
        this.families = d.families;
        this.effects = d.effects;
        this.total = d.total;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  importItem(item: StarterEffect, slot: 'A' | 'B'): void {
    if (this.busy) return;
    const program = this.program.value;
    if (program === null || program === undefined) return;
    if (!confirm(`Import "${item.name}" into Slot ${slot} at program ${program}?`)) return;
    this.busy = true;
    this.log = `Import ${item.file} -> Slot ${slot} @${program}`;
    this.cdr.markForCheck();
    this.api
      .importStarter(item.file, slot, program)
      .pipe(takeUntil(this.destroyed))
      .subscribe({
        next: (e) => {
          if (e.line) this.log += '\n' + e.line;
          if (e.ok !== undefined) {
            this.log += '\n' + (e.ok ? 'DONE.' : 'FAILED: ' + (e.stderr || e.error || ''));
          }
          this.cdr.markForCheck();
        },
        error: (e) => {
          this.busy = false;
          this.log += '\nERROR: ' + (e?.message || e);
          this.cdr.markForCheck();
        },
        complete: () => {
          this.busy = false;
          this.cdr.markForCheck();
        },
      });
  }

  bankLabel(bank: string): string {
    return bank === 'm1' ? 'm1' : 'm2';
  }

  trackBy(_i: number, item: StarterEffect): string {
    return item.file;
  }

  ngOnDestroy(): void {
    this.destroyed.next();
    this.destroyed.complete();
  }
}