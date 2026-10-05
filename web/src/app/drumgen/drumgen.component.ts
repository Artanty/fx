import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  OnInit,
} from '@angular/core';

import { DrumgenLuaService } from './drumgen-lua.service';
import { DrumgenState } from './drumgen.models';

interface ServedFile {
  name: string;
  hash: string;
}

@Component({
  selector: 'app-drumgen',
  standalone: true,
  templateUrl: './drumgen.component.html',
  styleUrl: './drumgen.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DrumgenComponent implements OnInit {
  status = 'loading the lua vm…';
  luaVersion = '';
  files: ServedFile[] = [];
  state?: DrumgenState;
  grid = '';
  eventCount = 0;
  error = '';

  constructor(
    private readonly lua: DrumgenLuaService,
    private readonly cdr: ChangeDetectorRef,
  ) {}

  async ngOnInit(): Promise<void> {
    try {
      await this.lua.start();
      this.luaVersion = this.lua.luaVersion();
      const manifest = await this.lua.manifest();
      this.files = Object.entries(manifest.files).map(([name, hash]) => ({
        name,
        hash,
      }));
      const boot = await this.lua.boot({ gen: { style: 'four_on_floor', seed: 7 } });
      if (!boot.ok || !boot.state) throw new Error(boot.error ?? 'boot failed');
      this.status = 'real lua is running in this tab';
      this.play();
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.status = 'failed';
    }
    this.cdr.markForCheck();
  }

  /** One bar, straight out of gen.lua. */
  play(): void {
    const reply = this.lua.call('tick', {});
    if (!reply.ok || !reply.state) {
      this.error = reply.error ?? 'tick failed';
      this.cdr.markForCheck();
      return;
    }
    this.state = reply.state;
    this.eventCount = reply.state.events.length;
    this.grid = reply.state.bar_rows ?? reply.state.rows
      .map((row) =>
        row.map((vel) => (vel > 0 ? String(Math.min(9, Math.round(vel / 13))) : '.')).join(' '),
      )
      .join('\n');
    this.cdr.markForCheck();
  }
}