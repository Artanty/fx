import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import { ApiService } from '../../services/api.service';
import {
  Artist,
  Folder,
  LibraryTabItem,
  SearchHit,
} from '../../models';

interface FavoriteSong {
  id: number;
  title: string;
  artist: string;
  artist_id: number;
  folders?: string[];
}

@Component({
  selector: 'app-browse',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, FormsModule],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.css',
})
export class BrowseComponent implements OnInit {
  private api = inject(ApiService);

  artists: Artist[] = [];
  results: SearchHit[] = [];
  searching = false;
  searchControl = new FormControl('');

  active: string = 'all';
  folders: Folder[] = [];
  favorites: {
    artists: Artist[];
    songs: FavoriteSong[];
    tabs: LibraryTabItem[];
  } = { artists: [], songs: [], tabs: [] };
  folderItems: LibraryTabItem[] = [];

  creating = false;
  newFolderName = '';
  renamingFolderId: number | null = null;
  renameName = '';
  busy = false;

  addTerm = '';
  allTabs: LibraryTabItem[] = [];
  addMatches: LibraryTabItem[] = [];

  ngOnInit() {
    this.loadFolders();
    this.loadArtists();
    this.searchControl.valueChanges
      .pipe(
        debounceTime(250),
        distinctUntilChanged(),
        switchMap((q) => {
          const term = (q || '').trim();
          this.searching = !!term;
          if (!term) return [];
          return this.api.search(term);
        })
      )
      .subscribe((r) => {
        if (Array.isArray(r)) {
          this.searching = false;
          this.results = [];
        } else {
          this.results = r.items;
        }
      });
  }

  loadArtists() {
    this.api.getArtists().subscribe((r) => (this.artists = r.items));
  }

  loadFolders() {
    this.api.getFolders().subscribe((r) => (this.folders = r.items));
  }

  select(key: string) {
    this.active = key;
    if (key === 'favorites') {
      this.loadFavorites();
    } else if (key.startsWith('f-')) {
      this.loadFolder(Number(key.slice(2)));
    }
  }

  loadFavorites() {
    this.api.getFavorites().subscribe((r) => (this.favorites = r));
  }

  loadFolder(id: number) {
    this.api.getFolder(id).subscribe((r) => (this.folderItems = r.items));
  }

  startCreate() {
    this.creating = true;
    this.newFolderName = '';
  }

  createFolder() {
    const name = this.newFolderName.trim();
    if (!name || this.busy) return;
    this.busy = true;
    this.api.createFolder(name).subscribe({
      next: () => {
        this.creating = false;
        this.busy = false;
        this.loadFolders();
      },
      error: (e) => {
        this.busy = false;
        window.alert('Create failed: ' + (e.error?.error || e.message));
      },
    });
  }

  startRename(folder: Folder) {
    this.renamingFolderId = folder.id;
    this.renameName = folder.name;
  }

  renameFolder() {
    if (this.renamingFolderId == null || this.busy) return;
    const name = this.renameName.trim();
    if (!name) return;
    const id = this.renamingFolderId;
    this.busy = true;
    this.api.renameFolder(id, name).subscribe({
      next: () => {
        this.renamingFolderId = null;
        this.busy = false;
        this.loadFolders();
        if (this.active === `f-${id}`) this.loadFolder(id);
      },
      error: (e) => {
        this.busy = false;
        window.alert('Rename failed: ' + (e.error?.error || e.message));
      },
    });
  }

  removeFolder(folder: Folder) {
    if (this.busy) return;
    if (!window.confirm(`Delete folder "${folder.name}"? Tabs stay in the library.`)) return;
    this.busy = true;
    this.api.deleteFolder(folder.id).subscribe({
      next: () => {
        this.busy = false;
        if (this.active === `f-${folder.id}`) this.active = 'all';
        this.loadFolders();
      },
      error: (e) => {
        this.busy = false;
        window.alert('Delete failed: ' + (e.error?.error || e.message));
      },
    });
  }

  onAddTermChange() {
    const q = this.addTerm.trim().toLowerCase();
    if (!q) {
      this.addMatches = [];
      return;
    }
    if (!this.allTabs.length) {
      this.api.getAllTabs().subscribe((r) => {
        this.allTabs = r.items;
        this.filterAddMatches(q);
      });
      return;
    }
    this.filterAddMatches(q);
  }

  private filterAddMatches(q: string) {
    const activeFolderId = Number(this.active.slice(2));
    this.addMatches = this.allTabs.filter((t) => {
      if (t.folders.some((f) => f.id === activeFolderId)) return false;
      return `${t.song_title} ${t.artist}`.toLowerCase().includes(q);
    });
  }

  addToFolder(tab: LibraryTabItem) {
    const folderId = Number(this.active.slice(2));
    this.api.addTabToFolder(folderId, tab.kind, tab.id).subscribe(() => {
      this.loadFolder(folderId);
      this.loadFolders();
      this.onAddTermChange();
    });
  }

  removeFromFolder(tab: LibraryTabItem) {
    const folderId = Number(this.active.slice(2));
    this.api.removeTabFromFolder(folderId, tab.kind, tab.id).subscribe(() => {
      this.loadFolder(folderId);
      this.loadFolders();
    });
  }

  toggleTabFavorite(tab: LibraryTabItem) {
    this.api.toggleFavorite('tab', tab.id, tab.kind).subscribe((r) => {
      tab.favorited = r.active;
      this.loadFolders();
    });
  }

  isFolderView(): boolean {
    return this.active.startsWith('f-');
  }

  isFavoriteView(): boolean {
    return this.active === 'favorites';
  }

  onClear() {
    this.searchControl.setValue('');
  }
}
