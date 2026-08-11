import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { ApiService } from '../../services/api.service';
import { Folder, SongDetail, TabItem } from '../../models';

@Component({
  selector: 'app-song',
  standalone: true,
  imports: [CommonModule, RouterLink, FormsModule],
  templateUrl: './song.component.html',
  styleUrl: './song.component.css',
})
export class SongComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  songId = 0;
  song: SongDetail | null = null;
  tabs: TabItem[] = [];
  folders: Folder[] = [];
  busy = false;

  folderPick: { [tabId: number]: number | 'new' | '' } = {};
  newFolderName: { [tabId: number]: string } = {};

  ngOnInit() {
    this.songId = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getSong(this.songId).subscribe((r) => {
      this.song = r.song;
      this.tabs = r.items;
    });
    this.api.getFolders().subscribe((r) => (this.folders = r.items));
  }

  formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }

  toggleSongFavorite() {
    if (!this.song) return;
    this.api.toggleFavorite('song', this.song.id).subscribe((r) => {
      if (this.song) this.song.favorited = r.active;
    });
  }

  toggleTabFavorite(tab: TabItem) {
    this.api.toggleFavorite('tab', tab.id, tab.kind).subscribe((r) => {
      tab.favorited = r.active;
    });
  }

  today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  onPick(tab: TabItem) {
    const pick = this.folderPick[tab.id];
    if (pick === 'new' && !this.newFolderName[tab.id]) {
      this.newFolderName[tab.id] = `imported ${this.today()}`;
    }
  }

  async addToFolder(tab: TabItem) {
    const pick = this.folderPick[tab.id];
    if (!pick) return;
    if (this.busy) return;
    this.busy = true;
    try {
      let folderId: number;
      if (pick === 'new') {
        const name = (this.newFolderName[tab.id] || '').trim();
        if (!name) {
          this.busy = false;
          return;
        }
        const existing = this.folders.find((f) => f.name === name);
        if (existing) {
          folderId = existing.id;
        } else {
          const created = await this.api.createFolder(name).toPromise();
          if (!created) return;
          folderId = created.id;
        }
        this.api.getFolders().subscribe((r) => (this.folders = r.items));
      } else {
        folderId = Number(pick);
      }
      await this.api.addTabToFolder(folderId, tab.kind, tab.id).toPromise();
      const folder = this.folders.find((f) => f.id === folderId);
      const folders = tab.folders || (tab.folders = []);
      if (folder && !folders.some((f) => f.id === folderId)) {
        folders.push({ id: folder.id, name: folder.name });
      }
      this.folderPick[tab.id] = '';
    } finally {
      this.busy = false;
    }
  }
}
