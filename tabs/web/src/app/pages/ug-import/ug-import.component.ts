import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../services/api.service';
import { Folder, UgSearchResult } from '../../models';

type SortKey = 'votes' | 'rating' | 'artist' | 'song' | 'type';

@Component({
  selector: 'app-ug-import',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './ug-import.component.html',
  styleUrl: './ug-import.component.css',
})
export class UgImportComponent implements OnInit {
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

  folders: Folder[] = [];
  targetFolderId: number | 'new' | '' = '';
  newFolderName = '';
  importFolderError = '';

  sortKey: SortKey | null = null;
  sortDir: 'asc' | 'desc' = 'asc';

  ngOnInit() {
    this.loadFolders();
  }

  get today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  get isNewFolder(): boolean {
    return this.targetFolderId === 'new';
  }

  onNewFolderMode() {
    if (!this.newFolderName.trim()) {
      this.newFolderName = `imported ${this.today}`;
    }
  }

  loadFolders() {
    this.api.getFolders().subscribe((r) => (this.folders = r.items));
  }

  get sortedResults(): UgSearchResult[] {
    if (!this.sortKey) return this.results;
    const key = this.sortKey;
    const dir = this.sortDir === 'asc' ? 1 : -1;
    return [...this.results].sort((a, b) => {
      const av = (a as any)[key];
      const bv = (b as any)[key];
      if (av == null && bv == null) return 0;
      if (av == null) return 1 * dir;
      if (bv == null) return -1 * dir;
      if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }

  onSort(key: SortKey) {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
    } else {
      this.sortKey = key;
      this.sortDir = 'asc';
    }
  }

  sortArrow(key: SortKey): string {
    if (this.sortKey !== key) return '↕';
    return this.sortDir === 'asc' ? '↑' : '↓';
  }

  async onImport(item: UgSearchResult) {
    this.busyUrl = item.url;
    this.error = '';
    this.importedUrl = '';
    this.importFolderError = '';
    try {
      let folderId: number | null = null;
      if (this.targetFolderId === 'new') {
        const name = this.newFolderName.trim();
        if (!name) throw new Error('folder name is required');
        const existing = this.folders.find((f) => f.name === name);
        if (existing) {
          folderId = existing.id;
        } else {
          const created = await this.api.createFolder(name).toPromise();
          if (!created) return;
          folderId = created.id;
          this.loadFolders();
        }
      } else if (this.targetFolderId !== '') {
        folderId = Number(this.targetFolderId);
      }

      const r = await this.api.ugImport(item.url).toPromise();
      if (r && folderId != null) {
        await this.api
          .addTabToFolder(folderId, r.kind, r.id)
          .toPromise();
      }
      this.importedUrl = r ? `/song/${r.song_id}` : '';
    } catch (err: any) {
      this.importFolderError =
        (err?.error?.error || err?.message || '').toString() || 'Import failed';
      this.error = this.importFolderError;
    } finally {
      this.busyUrl = '';
    }
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

  onKey(event: KeyboardEvent) {
    if (event.key === 'Enter') this.onSearch();
  }
}
