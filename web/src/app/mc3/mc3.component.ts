import { CommonModule } from '@angular/common';
import { HttpErrorResponse } from '@angular/common/http';
import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Mc3ApiService } from './mc3-api.service';
import {
  Mc3Bank,
  Mc3Channel,
  Mc3ChannelGroup,
  Mc3Preset,
  Mc3Summary,
} from './mc3.models';

/** One C4 CC104 recall, collapsed so the same preset fired twice reads once. */
export interface C4Hit {
  preset: number;
  name: string;
  via: 'cc' | 'notecc';
  notes: number[];
  count: number;
  toggleGroups: number[];
}

export interface TargetHit {
  channel: number;
  channelName: string;
  count: number;
}

export interface PresetRow {
  ref: Mc3Preset;
  c4: C4Hit[];
  others: TargetHit[];
  messageCount: number;
  label: string;
}

export interface BankRow {
  ref: Mc3Bank;
  presets: PresetRow[];
  c4Presets: number[];
  hits: number;
}

@Component({
  selector: 'app-mc3',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './mc3.component.html',
  styleUrl: './mc3.component.scss',
})
export class Mc3Component implements OnInit {
  loading = true;
  error: string | null = null;

  summary: Mc3Summary | null = null;
  channels: Mc3Channel[] = [];
  rows: BankRow[] = [];

  query = '';
  onlyC4 = false;
  hideEmpty = true;
  showMessages = false;

  selected: PresetRow | null = null;
  selectedBank: Mc3Bank | null = null;

  private banks: Mc3Bank[] = [];

  constructor(private api: Mc3ApiService) {}

  ngOnInit(): void {
    this.reload();
  }

  reload(): void {
    this.loading = true;
    this.error = null;
    this.api.summary().subscribe({
      next: (s) => (this.summary = s),
      error: (e: HttpErrorResponse) => this.fail(e),
    });
    this.api.channels().subscribe({
      next: (r) => (this.channels = r.channels),
      error: (e: HttpErrorResponse) => this.fail(e),
    });
    this.api.banks().subscribe({
      next: (r) => {
        this.banks = r.banks;
        this.rebuild();
        this.loading = false;
      },
      error: (e: HttpErrorResponse) => this.fail(e),
    });
  }

  private fail(e: HttpErrorResponse): void {
    this.loading = false;
    this.error = e.status
      ? `backend returned ${e.status} — is it running on :3223?`
      : `backend unreachable on :3223 — run \`npm --prefix back/mc3 start\``;
  }

  // --- derived view -----------------------------------------------------

  rebuild(): void {
    const q = this.query.trim().toLowerCase();
    this.rows = this.banks
      .map((bank) => this.bankRow(bank, q))
      .filter((r): r is BankRow => r !== null);
  }

  private bankRow(bank: Mc3Bank, q: string): BankRow | null {
    const bankHit = q !== '' && bank.bankName.toLowerCase().includes(q);
    const presets: PresetRow[] = [];

    for (const p of bank.presets) {
      if (p.empty && this.hideEmpty && !bankHit) continue;
      if (this.onlyC4 && !p.c4Presets.length) continue;
      if (q !== '' && !bankHit && !this.presetMatch(p, q)) continue;
      presets.push(this.presetRow(p));
    }

    if (!presets.length) return null;
    return {
      ref: bank,
      presets,
      c4Presets: [
        ...new Set(presets.flatMap((p) => p.c4.map((c) => c.preset))),
      ].sort((a, b) => a - b),
      hits: presets.reduce((n, p) => n + p.c4.length, 0),
    };
  }

  private presetMatch(p: Mc3Preset, q: string): boolean {
    const hay = [
      p.name,
      p.toggleName,
      p.longName,
      ...p.c4Presets.map((r) => `${r.preset} ${r.name}`),
      ...p.channels.map((c) => c.channelName),
      ...p.messages.map((m) => `${m.text} ${m.note}`),
    ]
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  }

  private presetRow(p: Mc3Preset): PresetRow {
    const hits = new Map<string, C4Hit>();
    for (const r of p.c4Presets) {
      const key = `${r.preset}|${r.via}`;
      let h = hits.get(key);
      if (!h) {
        h = {
          preset: r.preset,
          name: r.name,
          via: r.via,
          notes: [],
          count: 0,
          toggleGroups: [],
        };
        hits.set(key, h);
      }
      h.count += 1;
      if (r.note != null && !h.notes.includes(r.note)) h.notes.push(r.note);
      if (r.toggleGroup < 2 && !h.toggleGroups.includes(r.toggleGroup)) {
        h.toggleGroups.push(r.toggleGroup);
      }
    }

    const others: TargetHit[] = p.channels
      .filter((c) => c.channel !== this.c4ChannelNo())
      .map((c) => ({
        channel: c.channel,
        channelName: c.channelName,
        count: c.messages.length,
      }));

    return {
      ref: p,
      c4: [...hits.values()].sort((a, b) => a.preset - b.preset),
      others,
      messageCount: p.messages.length,
      label: p.name || '—',
    };
  }

  c4ChannelNo(): number {
    return this.summary?.c4Channel.channel ?? 2;
  }

  c4ChannelName(): string {
    return this.summary?.c4Channel.name || 'C4';
  }

  // --- helpers ----------------------------------------------------------

  channelsOf(p: PresetRow): Mc3ChannelGroup[] {
    return p.ref.channels;
  }

  isSelected(p: PresetRow): boolean {
    return this.selected === p;
  }

  toggle(p: PresetRow, bank: Mc3Bank): void {
    if (this.selected === p) {
      this.selected = null;
      return;
    }
    this.selected = p;
    this.selectedBank = bank;
  }

  trackRow(_i: number, p: PresetRow): string {
    return `${p.ref.kind}-${p.ref.presetNum}`;
  }

  emptyBankMessage(): string {
    return this.query
      ? `Nothing matches "${this.query}"`
      : this.onlyC4
        ? 'No preset recalls a C4 preset (CC104).'
        : 'No presets to show.';
  }

  totalRows(): number {
    return this.rows.reduce((n, b) => n + b.presets.length, 0);
  }

  totalHits(): number {
    return this.rows.reduce((n, b) => n + b.hits, 0);
  }
}
