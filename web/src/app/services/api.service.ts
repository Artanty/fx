import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import { Filters, PatchDetail, PatchParams, PatchesResponse } from '../models';

export interface SendH90Response {
  ok: boolean;
  port?: { index: number; name: string };
  channel: number;
  program: number;
  pc_offset: boolean;
  bytes: number[];
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  constructor(private http: HttpClient) {}

  getFilters(): Observable<Filters> {
    return this.http.get<Filters>('/api/filters');
  }

  getPatch(slug: string): Observable<PatchDetail> {
    return this.http.get<PatchDetail>(`/api/patches/${encodeURIComponent(slug)}`);
  }

  getFileDownloadUrl(fileId: number): string {
    return `/api/files/${fileId}/download`;
  }

  getH90Ports(): Observable<{ available: boolean; outputs: { index: number; name: string }[] }> {
    return this.http.get<{ available: boolean; outputs: { index: number; name: string }[] }>('/api/h90/ports');
  }

  sendToH90(program: number, channel: number, port?: number | null): Observable<SendH90Response> {
    return this.http.post<SendH90Response>('/api/h90/preset', { program, channel, port: port ?? null });
  }

  getPatches(params: PatchParams): Observable<PatchesResponse> {
    let p = new HttpParams();
    const setList = (key: string, value?: string[]) => {
      if (value && value.length) p = p.set(key, value.join(','));
    };
    setList('family', params.families);
    setList('algorithm', params.algorithms);
    setList('category', params.categories);
    setList('tag', params.tags);
    setList('ext', params.extensions);
    if (params.q) p = p.set('q', params.q);
    if (params.sort) p = p.set('sort', params.sort);
    p = p.set('page', String(params.page ?? 1));
    p = p.set('per_page', String(params.per_page ?? 24));
    return this.http.get<PatchesResponse>('/api/patches', { params: p });
  }
}
