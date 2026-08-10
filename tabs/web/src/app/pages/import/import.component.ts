import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { ImportStatus } from '../../models';

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

  ngOnInit() {
    this.refreshStatus();
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

  onIndex() {
    this.indexing = true;
    this.indexMessage = '';
    this.errors = [];
    this.api.indexBatch().subscribe({
      next: (r) => {
        this.indexing = false;
        this.indexMessage = `Indexed ${r.ok}/${r.processed} files (${r.remaining} remaining)`;
        this.errors = r.errors;
        this.refreshStatus();
      },
      error: (e) => {
        this.indexing = false;
        this.indexMessage = 'Index failed: ' + (e.error?.error || e.message);
      },
    });
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
