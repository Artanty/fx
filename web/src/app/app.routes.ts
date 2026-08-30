import { Routes } from '@angular/router';
import { BrowseComponent } from './pages/browse/browse.component';
import { PresetDetailComponent } from './pages/preset-detail/preset-detail.component';

export const routes: Routes = [
  { path: '', redirectTo: 'dist', pathMatch: 'full' },
  // h90 kept behind its own backend (:3000 + presets.db). Not the default for
  // now so a bare `npm start` only needs the la-lady backend (:3111).
  {
    path: 'h90',
    children: [
      { path: '', component: BrowseComponent },
      { path: 'preset/:slug', component: PresetDetailComponent },
    ],
  },
  {
    path: 'dist',
    loadChildren: () => import('./dist/dist.routes').then((m) => m.distRoutes),
  },
  { path: '**', redirectTo: 'dist' },
];
