import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { SongDetail, TabItem } from '../../models';

@Component({
  selector: 'app-song',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './song.component.html',
  styleUrl: './song.component.css',
})
export class SongComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  song: SongDetail | null = null;
  tabs: TabItem[] = [];

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getSong(id).subscribe((r) => {
      this.song = r.song;
      this.tabs = r.items;
    });
  }

  formatSize(bytes: number): string {
    if (bytes > 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
    return Math.round(bytes / 1024) + ' KB';
  }
}
