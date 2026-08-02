import { ChangeDetectionStrategy, ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiService } from '../../services/api.service';
import { PatchDetail } from '../../models';

@Component({
  selector: 'app-preset-detail',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './preset-detail.component.html',
  styleUrl: './preset-detail.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PresetDetailComponent implements OnInit {
  patch: PatchDetail | null = null;
  error: string | null = null;
  loading = true;

  constructor(private route: ActivatedRoute, private api: ApiService, private cdr: ChangeDetectorRef) {}

  ngOnInit(): void {
    const slug = this.route.snapshot.paramMap.get('slug');
    if (!slug) {
      this.error = 'No preset specified.';
      this.loading = false;
      return;
    }
    this.api.getPatch(slug).subscribe({
      next: (p) => {
        this.patch = p;
        this.loading = false;
        this.cdr.markForCheck();
      },
      error: () => {
        this.error = 'Preset not found.';
        this.loading = false;
        this.cdr.markForCheck();
      },
    });
  }

  downloadUrl(): string {
    return this.patch ? this.api.getFileDownloadUrl(this.patch.file_id) : '#';
  }

  formatDate(s: string | null): string {
    if (!s) return '—';
    return new Date(s).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  }

  formatNumber(n: number): string {
    return n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);
  }

  filesize(): string {
    if (!this.patch?.filesize) return '';
    const b = this.patch.filesize;
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / (1024 * 1024)).toFixed(2) + ' MB';
  }
}
