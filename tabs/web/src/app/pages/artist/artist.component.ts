import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { ApiService } from '../../services/api.service';
import { Artist, ArtistSong } from '../../models';

@Component({
  selector: 'app-artist',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './artist.component.html',
  styleUrl: './artist.component.css',
})
export class ArtistComponent implements OnInit {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);

  artist: Artist | null = null;
  songs: ArtistSong[] = [];

  ngOnInit() {
    const id = Number(this.route.snapshot.paramMap.get('id'));
    this.api.getArtistSongs(id).subscribe((r) => {
      this.artist = r.artist;
      this.songs = r.items;
    });
  }
}
