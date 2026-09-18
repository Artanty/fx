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

function sseStream<T>(url: string, init: RequestInit): Observable<T> {
  return new Observable<T>((subscriber) => {
    fetch(url, init)
      .then((resp) => {
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('no response body');
        const decoder = new TextDecoder();
        let buf = '';
        const pump = (): void => {
          reader.read().then(({ done, value }) => {
            if (done) {
              subscriber.complete();
              return;
            }
            buf += decoder.decode(value, { stream: true });
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const event = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const lines = event.split('\n');
              const dataLine = lines.find((l) => l.startsWith('data: '));
              const eventName = lines
                .filter((l) => l.startsWith('event: '))
                .map((l) => l.slice(7))
                .join(',');
              if (dataLine) {
                const parsed = JSON.parse(dataLine.slice(6)) as T;
                if (eventName.includes('done')) {
                  subscriber.next(parsed);
                  subscriber.complete();
                  return;
                }
                subscriber.next(parsed);
              }
            }
            pump();
          }).catch((e) => subscriber.error(e));
        };
        pump();
      })
      .catch((e) => subscriber.error(e));
  });
}

export interface H90KnobScanResponse {
  ok: boolean;
  knobs: string[];
  log: string;
}

export interface H90TurnRequest {
  preset?: string;
  dy?: number;
  above?: number;
  knobs: { name: string; turns: number }[];
}

export interface H90TurnResponse {
  ok: boolean;
  code: number;
  log: string;
  stderr?: string;
}

export interface H90SyncEvent {
  line?: string;
  ok?: boolean;
  code?: number;
  stderr?: string;
  error?: string;
}

export interface StarterEffect {
  file: string;
  path: string;
  bank: string;
  family: string;
  name: string;
}

export interface StartersResponse {
  effects: StarterEffect[];
  families: string[];
  total: number;
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

  scanH90Knobs(): Observable<H90KnobScanResponse> {
    return this.http.post<H90KnobScanResponse>('/api/h90/knob/scan', {});
  }

  turnH90Knobs(body: H90TurnRequest): Observable<H90TurnResponse> {
    return this.http.post<H90TurnResponse>('/api/h90/knob', body);
  }

  fetchH90File(fileId: number): Observable<{ ok: boolean; code: number; log: string; stderr?: string }> {
    return this.http.post<{ ok: boolean; code: number; log: string; stderr?: string }>('/api/h90/fetch', { fileId });
  }

  syncH90(): Observable<H90SyncEvent> {
    return sseStream('/api/h90/sync', { method: 'POST' });
  }

  getStarters(type: string, q: string): Observable<StartersResponse> {
    let p = new HttpParams();
    if (type && type !== 'all') p = p.set('type', type);
    if (q) p = p.set('q', q);
    return this.http.get<StartersResponse>('/api/h90/starters', { params: p });
  }

  importStarter(file: string, slot: 'A' | 'B', program: number): Observable<H90SyncEvent> {
    return sseStream('/api/h90/import', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file, slot, program }),
    });
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
