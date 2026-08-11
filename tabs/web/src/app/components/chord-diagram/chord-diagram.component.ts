import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

import { Chord } from '../../models';

@Component({
  selector: 'app-chord-diagram',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './chord-diagram.component.html',
  styleUrl: './chord-diagram.component.css',
})
export class ChordDiagramComponent {
  @Input() chord!: Chord;
  @Input() capo = 0;
  @Input() compact = false;

  get strings(): number[] {
    return this.chord.frets.split(',').map((f) => parseInt(f, 10));
  }

  get baseFret(): number {
    const positive = this.strings.filter((f) => f > 0);
    return positive.length ? Math.min(...positive) : 1;
  }

  get rows(): number[] {
    return Array.from({ length: 5 }, (_, i) => this.baseFret + i);
  }

  get capoRow(): number | null {
    const c = this.capo;
    const b = this.baseFret;
    return c > 0 && c >= b && c < b + 5 ? c - b + 1 : null;
  }

  get capoTop(): number {
    if (this.capoRow === null) return 0;
    const markerH = this.compact ? 10 : 14;
    const cellH = this.compact ? 12 : 18;
    return markerH + (this.capoRow - 1) * cellH + cellH / 2;
  }
}
