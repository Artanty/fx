import { Component, OnInit, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { debounceTime, distinctUntilChanged, switchMap } from 'rxjs';

import { ApiService } from '../../services/api.service';
import { Artist, SearchHit } from '../../models';

@Component({
  selector: 'app-browse',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule],
  templateUrl: './browse.component.html',
  styleUrl: './browse.component.css',
})
export class BrowseComponent implements OnInit {
  private api = inject(ApiService);

  artists: Artist[] = [];
  results: SearchHit[] = [];
  searching = false;
  searchControl = new FormControl('');

  ngOnInit() {
    this.api.getArtists().subscribe((r) => (this.artists = r.items));
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

  onClear() {
    this.searchControl.setValue('');
  }
}
