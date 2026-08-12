import { Routes } from '@angular/router';
import { BrowseComponent } from './pages/browse/browse.component';
import { ArtistComponent } from './pages/artist/artist.component';
import { SongComponent } from './pages/song/song.component';
import { TabViewerComponent } from './pages/tab-viewer/tab-viewer.component';
import { ImportComponent } from './pages/import/import.component';
import { UgImportComponent } from './pages/ug-import/ug-import.component';
import { ChordsComponent } from './pages/chords/chords.component';

export const routes: Routes = [
  { path: '', component: BrowseComponent },
  { path: 'artist/:id', component: ArtistComponent },
  { path: 'song/:id', component: SongComponent },
  { path: 'tab/:id', component: TabViewerComponent },
  { path: 'import', component: ImportComponent },
  { path: 'import-ug', component: UgImportComponent },
  { path: 'chords', component: ChordsComponent },
  { path: '**', redirectTo: '' },
];
