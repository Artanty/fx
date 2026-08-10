import { Component, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../services/api.service';
import { UgSearchResult } from '../../models';

@Component({
  selector: 'app-ug-import',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './ug-import.component.html',
  styleUrl: './ug-import.component.css',
})
export class UgImportComponent {
  private api = inject(ApiService);

  query = '';
  results: UgSearchResult[] = [];
  searching = false;
  searched = false;
  error = '';
  busyUrl = '';
  importedUrl = '';
  page = 1;
  totalPages = 1;
  loadingMore = false;

  songFilter = '';
  minRating: number | null = null;
  minVotes: number | null = null;

  get filteredResults(): UgSearchResult[] {
    const name = this.songFilter.trim().toLowerCase();
    return this.results.filter((r) => {
      if (name && !`${r.song} ${r.artist}`.toLowerCase().includes(name)) return false;
      if (this.minRating != null && this.minRating > 0 && r.rating < this.minRating) return false;
      if (this.minVotes != null && this.minVotes > 0 && r.votes < this.minVotes) return false;
      return true;
    });
  }

  async onSearch() {
    const q = this.query.trim();
    if (!q) return;
    this.searching = true;
    this.error = '';
    this.searched = false;
    try {
      const r = await this.api.ugSearch(q).toPromise();
      if (r) {
        this.results = r.items;
        this.page = r.page;
        this.totalPages = r.totalPages;
        this.searched = true;
      }
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Search failed';
      this.results = [];
    } finally {
      this.searching = false;
    }
  }

  async onLoadMore() {
    if (this.loadingMore || this.page >= this.totalPages) return;
    const q = this.query.trim();
    if (!q) return;
    this.loadingMore = true;
    this.error = '';
    try {
      const r = await this.api.ugSearch(q, this.page + 1).toPromise();
      if (r) {
        const seen = new Set(this.results.map((x) => x.id));
        this.results = this.results.concat(r.items.filter((x) => !seen.has(x.id)));
        this.page = r.page;
        this.totalPages = r.totalPages;
      }
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Load more failed';
    } finally {
      this.loadingMore = false;
    }
  }

  async onImport(item: UgSearchResult) {
    this.busyUrl = item.url;
    this.error = '';
    this.importedUrl = '';
    try {
      const r = await this.api.ugImport(item.url).toPromise();
      this.importedUrl = r ? `/song/${r.song_id}` : '';
    } catch (err: any) {
      this.error = err?.error?.error || err?.message || 'Import failed';
    } finally {
      this.busyUrl = '';
    }
  }

  onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') this.onSearch();
  }
}
