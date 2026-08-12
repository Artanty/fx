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
  Folder,
  LibraryTabItem,
  FavoriteStatus,
  Chord,
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

  indexBatch(folderId?: number): Observable<{
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
    }>('/api/import/index', { folder_id: folderId });
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

  getAllTabs(): Observable<{ items: LibraryTabItem[] }> {
    return this.http.get<{ items: LibraryTabItem[] }>('/api/tabs/all');
  }

  getFolders(): Observable<{ items: Folder[] }> {
    return this.http.get<{ items: Folder[] }>('/api/folders');
  }

  createFolder(name: string): Observable<Folder> {
    return this.http.post<Folder>('/api/folders', { name });
  }

  renameFolder(id: number, name: string): Observable<Folder> {
    return this.http.patch<Folder>(`/api/folders/${id}`, { name });
  }

  deleteFolder(id: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/folders/${id}`);
  }

  getFolder(id: number): Observable<{ folder: Folder; items: LibraryTabItem[] }> {
    return this.http.get<{ folder: Folder; items: LibraryTabItem[] }>(`/api/folders/${id}`);
  }

  addTabToFolder(folderId: number, kind: string, tabId: number): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`/api/folders/${folderId}/items`, { kind, tab_id: tabId });
  }

  removeTabFromFolder(folderId: number, kind: string, tabId: number): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`/api/folders/${folderId}/items/${kind}/${tabId}`);
  }

  getFavorites(): Observable<{
    artists: Artist[];
    songs: (ArtistSong & { artist: string; artist_id: number })[];
    tabs: LibraryTabItem[];
  }> {
    return this.http.get<{
      artists: Artist[];
      songs: (ArtistSong & { artist: string; artist_id: number })[];
      tabs: LibraryTabItem[];
    }>('/api/favorites');
  }

  getFavoriteIds(): Observable<FavoriteStatus> {
    return this.http.get<FavoriteStatus>('/api/favorites/ids');
  }

  toggleFavorite(
    kind: 'artist' | 'song' | 'tab',
    refId: number,
    tabKind?: string
  ): Observable<{ active: boolean }> {
    return this.http.post<{ active: boolean }>('/api/favorites', {
      kind,
      ref_id: refId,
      tab_kind: tabKind,
    });
  }

  getChords(): Observable<Chord[]> {
    return this.http.get<Chord[]>('/api/chords');
  }

  getChordQualities(): Observable<string[]> {
    return this.http.get<string[]>('/api/chords/qualities');
  }
}
