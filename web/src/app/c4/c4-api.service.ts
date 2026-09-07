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
}