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

  artistId = 0;
  artist: Artist | null = null;
  songs: ArtistSong[] = [];

  ngOnInit() {
    this.artistId = Number(this.route.snapshot.paramMap.get('id'));
    this.load();
  }

  load() {
    this.api.getArtistSongs(this.artistId).subscribe((r) => {
      this.artist = r.artist;
      this.songs = r.items;
    });
  }

  toggleArtistFavorite() {
    if (!this.artist) return;
    this.api.toggleFavorite('artist', this.artist.id).subscribe((r) => {
      if (this.artist) this.artist.favorited = r.active;
    });
  }

  toggleSongFavorite(song: ArtistSong) {
    this.api.toggleFavorite('song', song.id).subscribe((r) => {
      song.favorited = r.active;
    });
  }
}
