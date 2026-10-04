import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Observable } from 'rxjs';
import {
  Mc3Bank,
  Mc3BanksResponse,
  Mc3C4PresetsResponse,
  Mc3ChannelsResponse,
  Mc3Summary,
} from './mc3.models';

const BASE = 'http://localhost:3223';

@Injectable({ providedIn: 'root' })
export class Mc3ApiService {
  constructor(private http: HttpClient) {}

  summary(): Observable<Mc3Summary> {
    return this.http.get<Mc3Summary>(`${BASE}/api/summary`);
  }

  banks(): Observable<Mc3BanksResponse> {
    return this.http.get<Mc3BanksResponse>(`${BASE}/api/banks`);
  }

  channels(): Observable<Mc3ChannelsResponse> {
    return this.http.get<Mc3ChannelsResponse>(`${BASE}/api/channels`);
  }

  c4Presets(): Observable<Mc3C4PresetsResponse> {
    return this.http.get<Mc3C4PresetsResponse>(`${BASE}/api/c4-presets`);
  }

  bank(bankNo: number): Observable<Mc3Bank> {
    return this.http.get<Mc3Bank>(`${BASE}/api/banks/${bankNo}`);
  }

  reload(): Observable<{ mc3Backup: string; c4Backup: string | null }> {
    return this.http.get<{ mc3Backup: string; c4Backup: string | null }>(`${BASE}/api/reload`);
  }
}
