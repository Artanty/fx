import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActivateResult,
  LaladyDevice,
  LaladyPresets,
  WriteRequest,
  WriteResult,
} from './lalady.models';

const BASE = 'http://localhost:3111';

@Injectable({ providedIn: 'root' })
export class LaladyApiService {
  constructor(private http: HttpClient) {}

  device(): Observable<LaladyDevice> {
    return this.http.get<LaladyDevice>(`${BASE}/api/device`);
  }

  presets(): Observable<LaladyPresets> {
    return this.http.get<LaladyPresets>(`${BASE}/api/presets`);
  }

  exportUrl(slot: string): string {
    return `${BASE}/api/export?slot=${encodeURIComponent(slot)}`;
  }

  write(req: WriteRequest): Observable<WriteResult> {
    return this.http.post<WriteResult>(`${BASE}/api/write`, req);
  }

  activate(slot: string): Observable<ActivateResult> {
    return this.http.post<ActivateResult>(`${BASE}/api/activate`, { slot });
  }
}
