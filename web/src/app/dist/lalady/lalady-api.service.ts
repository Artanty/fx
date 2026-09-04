import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActivateResult,
  ControlMap,
  ControlRequest,
  ControlResult,
  EepromData,
  EngineList,
  EraseResult,
  LaladyDevice,
  LaladyPresets,
  LaladyStatus,
  LiveControls,
  OsbfData,
  RandomizeGroup,
  RandomizePreset,
  RandomizePresetCreate,
  RestoreResult,
  SlotParams,
  SlotSaveRequest,
  SlotSaveResult,
  WriteRequest,
  WriteResult,
} from './lalady.models';

export interface MidiMap {
  ok: boolean;
  ccToControl: number[];
  controlToCc: Record<string, number>;
  bound: { controlIndex: number; cc: number; name: string }[];
  boundCount: number;
  error?: string;
}

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

  engines(): Observable<EngineList> {
    return this.http.get<EngineList>(`${BASE}/api/engines`);
  }

  controlMap(): Observable<ControlMap> {
    return this.http.get<ControlMap>(`${BASE}/api/control-map`);
  }

  midimap(): Observable<MidiMap> {
    return this.http.get<MidiMap>(`${BASE}/api/midimap`);
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

  eeprom(): Observable<EepromData> {
    return this.http.get<EepromData>(`${BASE}/api/eeprom`);
  }

  osbf(): Observable<OsbfData> {
    return this.http.get<OsbfData>(`${BASE}/api/osbf`);
  }

  exportRefUrl(id: string): string {
    return `${BASE}/api/export-ref?id=${encodeURIComponent(id)}`;
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

  randomizeGroups(): Observable<{ ok: boolean; count: number; groups: RandomizeGroup[] }> {
    return this.http.get<{ ok: boolean; count: number; groups: RandomizeGroup[] }>(`${BASE}/api/randomize/groups`);
  }

  randomizeGroupCreate(body: Partial<RandomizeGroup>): Observable<{ ok: boolean; group: RandomizeGroup }> {
    return this.http.post<{ ok: boolean; group: RandomizeGroup }>(`${BASE}/api/randomize/groups`, body);
  }

  randomizeGroupUpdate(id: string, body: Partial<RandomizeGroup>): Observable<{ ok: boolean; group: RandomizeGroup }> {
    return this.http.put<{ ok: boolean; group: RandomizeGroup }>(`${BASE}/api/randomize/groups/${id}`, body);
  }

  randomizeGroupDelete(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/api/randomize/groups/${id}`);
  }

  randomizePresets(): Observable<{ ok: boolean; count: number; presets: RandomizePreset[] }> {
    return this.http.get<{ ok: boolean; count: number; presets: RandomizePreset[] }>(`${BASE}/api/randomize/presets`);
  }

  randomizePresetCreate(body: RandomizePresetCreate): Observable<{ ok: boolean; preset: RandomizePreset }> {
    return this.http.post<{ ok: boolean; preset: RandomizePreset }>(`${BASE}/api/randomize/presets`, body);
  }

  randomizePresetUpdate(
    id: string,
    body: Partial<RandomizePreset> & { saveToSlot?: number | null }
  ): Observable<{ ok: boolean; preset: RandomizePreset }> {
    return this.http.put<{ ok: boolean; preset: RandomizePreset }>(`${BASE}/api/randomize/presets/${id}`, body);
  }

  randomizePresetDelete(id: string): Observable<{ ok: boolean }> {
    return this.http.delete<{ ok: boolean }>(`${BASE}/api/randomize/presets/${id}`);
  }
}
