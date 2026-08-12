import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../services/api.service';
import { Chord } from '../../models';
import { ChordDiagramComponent } from '../../components/chord-diagram/chord-diagram.component';

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const QUALITY_LABELS: Record<string, string> = {
  major: 'Major',
  minor: 'Minor',
  '7': 'Dominant 7',
  maj7: 'Major 7',
  m7: 'Minor 7',
  sus2: 'Sus 2',
  sus4: 'Sus 4',
  dim: 'Diminished',
  aug: 'Augmented',
};

@Component({
  selector: 'app-chords',
  standalone: true,
  imports: [CommonModule, FormsModule, ChordDiagramComponent],
  templateUrl: './chords.component.html',
  styleUrl: './chords.component.css',
})
export class ChordsComponent implements OnInit {
  private api = inject(ApiService);

  chords: Chord[] = [];
  qualities: string[] = [];
  byRoot: Map<string, Chord[]> = new Map();

  q = '';
  quality = '';
  transpose = 0;
  capo = 0;

  expanded = new Set<string>();
  loaded = false;

  readonly roots = NOTES;
  readonly qualityLabels = QUALITY_LABELS;

  ngOnInit() {
    this.api.getChords().subscribe((chords) => {
      this.chords = chords;
      this.loaded = true;
      this.byRoot = new Map();
      for (const root of NOTES) this.byRoot.set(root, chords.filter((c) => c.root === root));
    });
    this.api.getChordQualities().subscribe((q) => (this.qualities = q));
  }

  toggle(root: string) {
    if (this.expanded.has(root)) this.expanded.delete(root);
    else this.expanded.add(root);
  }

  isExpanded(root: string): boolean {
    return this.expanded.has(root);
  }

  matchesFilters(c: Chord): boolean {
    if (this.quality && c.quality !== this.quality) return false;
    const term = this.q.trim().toLowerCase();
    if (!term) return true;
    return c.name.toLowerCase().includes(term) || c.notes.toLowerCase().includes(term);
  }

  visibleFor(root: string): Chord[] {
    return this.byRoot.get(root)?.filter((c) => this.matchesFilters(c)) ?? [];
  }

  countFor(root: string): number {
    return this.visibleFor(root).length;
  }

  shift(root: string, semitones: number): string {
    const idx = NOTES.indexOf(root);
    return NOTES[((idx + semitones) % 12 + 12) % 12];
  }

  transposed(c: Chord): Chord | undefined {
    return this.chords.find(
      (x) => x.root === this.shift(c.root, this.transpose) && x.quality === c.quality
    );
  }

  soundingName(c: Chord): string {
    const t = this.transposed(c);
    const root = t ? t.root : this.shift(c.root, this.transpose);
    return this.shift(root, this.capo) + this.qualityLabel(c.quality);
  }

  qualityLabel(quality: string): string {
    return quality === 'major' ? '' : (QUALITY_LABELS[quality] ?? quality);
  }

  diagramChord(c: Chord): Chord {
    return this.transposed(c) ?? c;
  }
}
