import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { readLastRoute } from '../../last-route';

export interface HomeLink {
  path: string;
  label: string;
  title: string;
  about: string;
  backend: string;
  tag: string;
}

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent {
  readonly lastRoute: string | null = readLastRoute();

  readonly links: HomeLink[] = [
    {
      path: '/la-lady',
      label: 'la-lady',
      tag: 'Source Audio',
      title: 'L.A. Lady — Overdrive',
      about:
        'Inspector, live controls, preset write/upload and the Neuro-style ' +
        'randomizer for a connected pedal over HID.',
      backend: 'back/lalady :3111',
    },
    {
      path: '/h90',
      label: 'h90 presets',
      tag: 'Eventide',
      title: 'H90 — patch explorer',
      about:
        'Browse the 491 H90 presets from patchstorage.com, filter by family, ' +
        'algorithm, category or tag, and read the full description of any patch.',
      backend: 'back/h90 :3000',
    },
    {
      path: '/h90/starters',
      label: 'h90 starters',
      tag: 'Eventide',
      title: 'H90 — effect starters',
      about:
        'Factory single-algorithm presets, ready to import into a pedal slot ' +
        'through the H90 Control app.',
      backend: 'back/h90 :3000',
    },
    {
      path: '/c4',
      label: 'c4synth',
      tag: 'Source Audio',
      title: 'C4 Synth — workbench',
      about:
        'HID workbench for the C4: 128 user presets, live parameter control, ' +
        'preset slots and groups randomizer.',
      backend: 'back/c4 :3222',
    },
    {
      path: '/mc3',
      label: 'mc3',
      tag: 'Morningstar',
      title: 'MC3 — controller backup inspector',
      about:
        'Read-only view of the MC3 all-banks backup: every bank and preset, and ' +
        'which C4 effect each preset recalls (CC104 on MIDI channel 2).',
      backend: 'back/mc3 :3223',
    },
    {
      path: '/drumgen',
      label: 'drumgen',
      tag: 'norns',
      title: 'Drumgen — norns UI, off-device',
      about:
        'The norns drum machine with its Lua core running in the browser tab: ' +
        'real generated bars on a 128x64 screen you can judge without the ' +
        'hardware plugged in.',
      backend: 'none (lua runs in the tab)',
    },
  ];

  resumeLabel(): string {
    const last = this.lastRoute;
    if (!last) return '';
    return this.links.find((l) => l.path === last)?.label ?? last;
  }
}
