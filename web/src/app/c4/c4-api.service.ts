import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  ActivateResult,
  C4Config,
  C4Device,
  ControlMap,
  ControlRequest,
  ControlResult,
  EepromData,
  LiveControls,
  MidiMap,
  PresetList,
  RandomizeGroup,
  RandomizePreset,
  RandomizePresetCreate,
  SlotParams,
  SlotSaveRequest,
  SlotSaveResult,
} from './c4.models';

const BASE = 'http://localhost:3222';

@Injectable({ providedIn: 'root' })
export class C4ApiService {
  constructor(private http: HttpClient) {}

  device(): Observable<C4Device> {
    return this.http.get<C4Device>(`${BASE}/api/device`);
  }

  status(): Observable<{ config: C4Config; device?: C4Device['device'] }> {
    return this.http.get<{ config: C4Config; device?: C4Device['device'] }>(`${BASE}/api/status`);
  }

  presets(): Observable<PresetList> {
    return this.http.get<PresetList>(`${BASE}/api/presets`);
  }

  preset(idx: number): Observable<SlotParams> {
    return this.http.get<SlotParams>(`${BASE}/api/presets?idx=${idx}`);
  }

  controls(): Observable<LiveControls> {
    return this.http.get<LiveControls>(`${BASE}/api/controls`);
  }

  controlMap(): Observable<ControlMap> {
    return this.http.get<ControlMap>(`${BASE}/api/control-map`);
  }

  activate(idx: number): Observable<ActivateResult> {
    return this.http.post<ActivateResult>(`${BASE}/api/activate`, { idx });
  }

  control(req: ControlRequest): Observable<ControlResult> {
    return this.http.post<ControlResult>(`${BASE}/api/control`, req);
  }

  controlLive(req: ControlRequest): Observable<ControlResult> {
    return this.http.post<ControlResult>(`${BASE}/api/control/live`, req);
  }

  slotSave(req: SlotSaveRequest): Observable<SlotSaveResult> {
    return this.http.post<SlotSaveResult>(`${BASE}/api/presets/save`, req);
  }

  eeprom(): Observable<EepromData> {
    return this.http.get<EepromData>(`${BASE}/api/eeprom`);
  }

  midimap(): Observable<MidiMap> {
    return this.http.get<MidiMap>(`${BASE}/api/midimap`);
  }

  log(lines: string | string[]): Observable<{ ok: boolean; count?: number }> {
    const payload = Array.isArray(lines) ? { lines } : { line: lines };
    return this.http.post<{ ok: boolean; count?: number }>(`${BASE}/api/log`, payload);
  }

  logReset(): Observable<{ ok: boolean; file?: string }> {
    return this.http.post<{ ok: boolean; file?: string }>(`${BASE}/api/log/reset`, {});
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