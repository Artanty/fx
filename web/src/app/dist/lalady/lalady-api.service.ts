import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActivateResult,
  ControlRequest,
  ControlResult,
  EraseResult,
  LaladyDevice,
  LaladyPresets,
  LaladyStatus,
  LiveControls,
  RestoreResult,
  SlotParams,
  SlotSaveRequest,
  SlotSaveResult,
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

  status(): Observable<LaladyStatus> {
    return this.http.get<LaladyStatus>(`${BASE}/api/status`);
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

  activateSlot(idx: number): Observable<ActivateResult> {
    return this.http.post<ActivateResult>(`${BASE}/api/activate`, { idx });
  }

  erase(slot: string): Observable<EraseResult> {
    return this.http.post<EraseResult>(`${BASE}/api/erase`, { slot });
  }

  control(req: ControlRequest): Observable<ControlResult> {
    return this.http.post<ControlResult>(`${BASE}/api/control`, req);
  }

  controlLive(req: ControlRequest): Observable<ControlResult> {
    return this.http.post<ControlResult>(`${BASE}/api/control/live`, req);
  }

  controls(): Observable<LiveControls> {
    return this.http.get<LiveControls>(`${BASE}/api/controls`);
  }

  slotParams(idx: number): Observable<SlotParams> {
    return this.http.get<SlotParams>(`${BASE}/api/slot-params?idx=${idx}`);
  }

  slotSave(req: SlotSaveRequest): Observable<SlotSaveResult> {
    return this.http.post<SlotSaveResult>(`${BASE}/api/slots/save`, req);
  }

  restore(osbfText: string): Observable<RestoreResult> {
    return this.http.post<RestoreResult>(`${BASE}/api/restore`, { text: osbfText });
  }

  exportAllUrl(): string {
    return `${BASE}/api/export-all`;
  }
}
