import { Component, OnInit, OnDestroy, AfterViewInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../services/api.service';
import { Chord, Folder, TabDetail, TrackInfo, UgTabDetail } from '../../models';
import { ChordDiagramComponent } from '../../components/chord-diagram/chord-diagram.component';

declare var alphaTab: any;

@Component({
  selector: 'app-tab-viewer',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule, ChordDiagramComponent],
  templateUrl: './tab-viewer.component.html',
  styleUrl: './tab-viewer.component.css',
})
export class TabViewerComponent implements OnInit, AfterViewInit, OnDestroy {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  mode: 'gp' | 'ug' = 'gp';
  tab: TabDetail | null = null;
  ugTab: UgTabDetail | null = null;
  tabId = 0;

  private at: any = null;
  tracks: TrackInfo[] = [];
  scoreReady = false;
  currentTrack = 0;
  playing = false;
  speed = 1;
  loop = false;

  folders: Folder[] = [];
  folderPick: number | 'new' | '' = '';
  newFolderName = '';
  busy = false;

  allChords: Chord[] = [];
  chordQ = '';
  chordQuality = '';
  pickedChords: Chord[] = [];
  sidebarOpen = true;
  pickedOpen = true;

  ngOnInit() {
    this.tabId = Number(this.route.snapshot.paramMap.get('id'));
    this.mode = this.route.snapshot.queryParamMap.get('kind') === 'ug' ? 'ug' : 'gp';
    if (this.mode === 'ug') {
      this.api.getUgTab(this.tabId).subscribe((t) => {
        this.ugTab = t;
        this.detectChordsFromTab();
      });
    } else {
      this.api.getTab(this.tabId).subscribe((t) => {
        this.tab = t;
      });
    }
    this.api.getFolders().subscribe((r) => (this.folders = r.items));
    this.api.getChords().subscribe((chords) => {
      this.allChords = chords;
      this.detectChordsFromTab();
    });
  }

  ngAfterViewInit() {
    if (this.mode === 'gp') this.initAlphaTab();
  }

  ngOnDestroy() {
    if (this.at) this.at.destroy();
  }

  private initAlphaTab() {
    if (!alphaTab) return;
    const settings = new alphaTab.Settings();
    settings.core.scriptFile = new URL('assets/alphatab/alphaTab.min.js', document.baseURI).href;
    settings.core.fontDirectory = 'assets/alphatab/font/';
    settings.player.soundFont = 'assets/alphatab/soundfont/sonivox.sf2';
    settings.player.enablePlayer = true;
    settings.player.enableCursor = true;
    settings.player.enableUserInteraction = true;
    settings.display.scale = 0.9;

    this.at = new alphaTab.AlphaTabApi(document.getElementById('tab-host'), settings);
    this.at.soundFontLoad.on((args: any) => {});
    this.at.scoreLoaded.on((score: any) => {
      this.tracks = (score.tracks || []).map((t: any) => ({
        id: t.index,
        name: t.name,
      }));
      this.scoreReady = true;
    });
    this.at.playerStateChanged.on((args: any) => {
      this.playing = args.state === 1;
    });
    this.at.load(this.api.getTabFileUrl(this.tabId));
  }

  togglePlay() {
    this.at.playPause();
  }

  stop() {
    this.at.stop();
  }

  setLoop() {
    this.loop = !this.loop;
    this.at.isLooping = this.loop;
  }

  setSpeed(value: string) {
    this.speed = parseFloat(value);
    this.at.playbackSpeed = this.speed;
  }

  selectTrack(index: number) {
    if (!this.at || !this.scoreReady) return;
    const target = Number(index);
    const track = (this.at.score.tracks || []).find((t: any) => t.index === target);
    if (!track) return;
    this.currentTrack = target;
    this.at.renderTracks([track]);
  }

  formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  get favorited(): boolean {
    return this.mode === 'ug' ? !!this.ugTab?.favorited : !!this.tab?.favorited;
  }

  get tabFolders(): { id: number; name: string }[] {
    return (this.mode === 'ug' ? this.ugTab?.folders : this.tab?.folders) || [];
  }

  toggleFavorite() {
    this.api.toggleFavorite('tab', this.tabId, this.mode).subscribe((r) => {
      if (this.mode === 'ug' && this.ugTab) this.ugTab.favorited = r.active;
      else if (this.tab) this.tab.favorited = r.active;
    });
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  onPickNew() {
    if (this.folderPick === 'new' && !this.newFolderName.trim()) {
      this.newFolderName = `imported ${this.today()}`;
    }
  }

  async addToFolder() {
    if (!this.folderPick || this.busy) return;
    this.busy = true;
    try {
      let folderId: number;
      if (this.folderPick === 'new') {
        const name = this.newFolderName.trim();
        if (!name) return;
        const existing = this.folders.find((f) => f.name === name);
        if (existing) {
          folderId = existing.id;
        } else {
          const created = await this.api.createFolder(name).toPromise();
          if (!created) return;
          folderId = created.id;
          this.api.getFolders().subscribe((r) => (this.folders = r.items));
        }
      } else {
        folderId = Number(this.folderPick);
      }
      await this.api.addTabToFolder(folderId, this.mode, this.tabId).toPromise();
      const folder = this.folders.find((f) => f.id === folderId);
      if (folder && !this.tabFolders.some((f) => f.id === folderId)) {
        const target = this.mode === 'ug' ? this.ugTab : this.tab;
        if (target) target.folders = [...(target.folders || []), { id: folder.id, name: folder.name }];
      }
      this.folderPick = '';
    } finally {
      this.busy = false;
    }
  }

  get chordQualities(): string[] {
    return [...new Set(this.allChords.map((c) => c.quality))];
  }

  filteredChords(): Chord[] {
    const term = this.chordQ.trim().toLowerCase();
    return this.allChords.filter((c) => {
      if (this.chordQuality && c.quality !== this.chordQuality) return false;
      if (!term) return true;
      return c.name.toLowerCase().includes(term) || c.notes.toLowerCase().includes(term);
    });
  }

  isPicked(c: Chord): boolean {
    return this.pickedChords.some((p) => p.name === c.name);
  }

  togglePick(c: Chord) {
    const i = this.pickedChords.findIndex((p) => p.name === c.name);
    if (i >= 0) this.pickedChords.splice(i, 1);
    else this.pickedChords.push(c);
  }

  removePicked(c: Chord) {
    const i = this.pickedChords.findIndex((p) => p.name === c.name);
    if (i >= 0) this.pickedChords.splice(i, 1);
  }

  private detectChordsFromTab() {
    if (this.mode !== 'ug' || !this.ugTab || !this.allChords.length) return;
    const byName = new Map(this.allChords.map((c) => [c.name, c]));
    const found = new Map<string, Chord>();
    const pattern = /\b[A-G](?:#|b)?(?:maj7|m7|m|7|sus2|sus4|dim|aug)?\b/g;
    for (const m of this.ugTab.content.matchAll(pattern)) {
      const after = this.ugTab.content[m.index + m[0].length] ?? '';
      if (after === '|') continue;
      const name = this.normalizeChordName(m[0]);
      const ch = byName.get(name);
      if (ch) found.set(name, ch);
    }
    const current = new Set(this.pickedChords.map((p) => p.name));
    for (const ch of found.values()) {
      if (!current.has(ch.name)) this.pickedChords.push(ch);
    }
  }

  private normalizeChordName(name: string): string {
    if (name.length >= 2 && name[1] === 'b') {
      const sharp: Record<string, string> = { Bb: 'A#', Eb: 'D#', Ab: 'G#', Db: 'C#', Gb: 'F#' };
      return (sharp[name.slice(0, 2)] ?? name.slice(0, 2)) + name.slice(2);
    }
    return name;
  }
}