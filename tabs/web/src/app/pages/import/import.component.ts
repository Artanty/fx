import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { Folder, ImportStatus } from '../../models';

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './import.component.html',
  styleUrl: './import.component.css',
})
export class ImportComponent implements OnInit {
  private api = inject(ApiService);

  status: ImportStatus | null = null;
  scanDir = '';
  scanning = false;
  scanResult: { scanned: number; added: number; duplicates: number } | null = null;
  indexing = false;
  indexMessage = '';
  uploading = false;
  dragOver = false;
  uploadResult = '';
  errors: { filename: string; error: string }[] = [];

  folders: Folder[] = [];
  targetFolderId: number | 'new' | '' = '';
  newFolderName = '';

  ngOnInit() {
    this.refreshStatus();
    this.api.getFolders().subscribe((r) => (this.folders = r.items));
  }

  get today(): string {
    return new Date().toISOString().slice(0, 10);
  }

  get isNewFolder(): boolean {
    return this.targetFolderId === 'new';
  }

  onNewFolderMode() {
    if (!this.newFolderName.trim()) {
      this.newFolderName = `imported ${this.today}`;
    }
  }

  refreshStatus() {
    this.api.importStatus().subscribe((s) => (this.status = s));
  }

  onScan() {
    if (!this.scanDir.trim()) return;
    this.scanning = true;
    this.api.scanDir(this.scanDir.trim()).subscribe({
      next: (r) => {
        this.scanResult = r;
        this.scanning = false;
        this.refreshStatus();
      },
      error: (e) => {
        this.scanning = false;
        this.indexMessage = 'Scan failed: ' + (e.error?.error || e.message);
      },
    });
  }

  async onIndex() {
    this.indexing = true;
    this.indexMessage = '';
    this.errors = [];
    try {
      let folderId: number | undefined;
      if (this.targetFolderId === 'new') {
        const name = this.newFolderName.trim();
        if (!name) throw new Error('folder name is required');
        const existing = this.folders.find((f) => f.name === name);
        if (existing) {
          folderId = existing.id;
        } else {
          const created = await this.api.createFolder(name).toPromise();
          if (!created) return;
          folderId = created.id;
        }
        this.api.getFolders().subscribe((r) => (this.folders = r.items));
      } else if (this.targetFolderId !== '') {
        folderId = Number(this.targetFolderId);
      }
      this.api.indexBatch(folderId).subscribe({
        next: (r) => {
          this.indexing = false;
          this.indexMessage = `Indexed ${r.ok}/${r.processed} files (${r.remaining} remaining)${
            folderId ? ' into folder' : ''
          }`;
          this.errors = r.errors;
          this.refreshStatus();
        },
        error: (e) => {
          this.indexing = false;
          this.indexMessage = 'Index failed: ' + (e.error?.error || e.message);
        },
      });
    } catch (err: any) {
      this.indexing = false;
      this.indexMessage = 'Index failed: ' + (err?.message || err);
    }
  }

  onDrop(event: DragEvent) {
    event.preventDefault();
    this.dragOver = false;
    const files = Array.from(event.dataTransfer?.files || []);
    this.doUpload(files);
  }

  onFileChange(event: Event) {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files || []);
    this.doUpload(files);
  }

  private doUpload(files: File[]) {
    if (!files.length) return;
    this.uploading = true;
    this.uploadResult = '';
    this.api.uploadFiles(files).subscribe({
      next: (r) => {
        this.uploading = false;
        this.uploadResult = `Uploaded ${r.uploaded} file(s) — now index them.`;
        this.refreshStatus();
      },
      error: (e) => {
        this.uploading = false;
        this.uploadResult = 'Upload failed: ' + (e.error?.error || e.message);
      },
    });
  }
}
