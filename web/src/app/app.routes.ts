import { Routes } from '@angular/router';
import { BrowseComponent } from './pages/browse/browse.component';
import { PresetDetailComponent } from './pages/preset-detail/preset-detail.component';

export const routes: Routes = [
  { path: '', component: BrowseComponent },
  { path: 'preset/:slug', component: PresetDetailComponent },
  { path: '**', redirectTo: '' },
];
