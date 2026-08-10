import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';

import {
  Artist,
  ArtistSong,
  SongDetail,
  TabDetail,
  TabItem,
  SearchHit,
  ImportStatus,
  UgSearchResult,
  UgTabDetail,
} from '../models';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private http = inject(HttpClient);

  getArtists(q?: string): Observable<{ items: Artist[] }> {
    return this.http.get<{ items: Artist[] }>('/api/artists', {
      params: q ? { q } : {},
    });
  }

  getArtistSongs(artistId: number): Observable<{ artist: Artist; items: ArtistSong[] }> {
    return this.http.get<{ artist: Artist; items: ArtistSong[] }>(
      `/api/artists/${artistId}/songs`
    );
  }

  getSong(songId: number): Observable<{ song: SongDetail; items: TabItem[] }> {
    return this.http.get<{ song: SongDetail; items: TabItem[] }>(`/api/songs/${songId}`);
  }

  getTab(tabId: number): Observable<TabDetail> {
    return this.http.get<TabDetail>(`/api/tabs/${tabId}`);
  }

  getTabFileUrl(tabId: number): string {
    return `/api/tabs/${tabId}/file`;
  }

  search(q: string): Observable<{ items: SearchHit[] }> {
    return this.http.get<{ items: SearchHit[] }>('/api/search', { params: { q } });
  }

  scanDir(dir: string): Observable<{ scanned: number; added: number; duplicates: number }> {
    return this.http.post<{ scanned: number; added: number; duplicates: number }>(
      '/api/import/scan',
      { dir }
    );
  }

  indexBatch(): Observable<{
    processed: number;
    ok: number;
    failed: number;
    remaining: number;
    errors: { filename: string; error: string }[];
  }> {
    return this.http.post<{
      processed: number;
      ok: number;
      failed: number;
      remaining: number;
      errors: { filename: string; error: string }[];
    }>('/api/import/index', {});
  }

  uploadFiles(files: File[]): Observable<{ uploaded: number; results: unknown[] }> {
    const form = new FormData();
    for (const f of files) form.append('files', f, f.name);
    return this.http.post<{ uploaded: number; results: unknown[] }>(
      '/api/import/upload',
      form
    );
  }

  importStatus(): Observable<ImportStatus> {
    return this.http.get<ImportStatus>('/api/import/status');
  }

  ugSearch(q: string, page = 1): Observable<{ items: UgSearchResult[]; page: number; totalPages: number }> {
    return this.http.get<{ items: UgSearchResult[]; page: number; totalPages: number }>('/api/ug/search', {
      params: { q, page: String(page) },
    });
  }

  ugImport(url: string): Observable<{ id: number; kind: string; duplicate: boolean; song_id: number }> {
    return this.http.post<{ id: number; kind: string; duplicate: boolean; song_id: number }>(
      '/api/ug/import',
      { url }
    );
  }

  getUgTab(tabId: number): Observable<UgTabDetail> {
    return this.http.get<UgTabDetail>(`/api/ug/tabs/${tabId}`);
  }

  getUgTabTextUrl(tabId: number): string {
    return `/api/ug/tabs/${tabId}/text`;
  }
}
