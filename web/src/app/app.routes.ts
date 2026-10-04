import { Routes } from '@angular/router';
import { HomeComponent } from './pages/home/home.component';
import { BrowseComponent } from './pages/browse/browse.component';
import { PresetDetailComponent } from './pages/preset-detail/preset-detail.component';
import { StartersComponent } from './pages/starters/starters.component';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  // h90 kept behind its own backend (:3000 + presets.db). Not the default for
  // now so a bare `npm start` only needs the la-lady backend (:3111).
  {
    path: 'h90',
    children: [
      { path: '', component: BrowseComponent },
      { path: 'preset/:slug', component: PresetDetailComponent },
      { path: 'starters', component: StartersComponent },
    ],
  },
  {
    path: 'la-lady',
    loadChildren: () => import('./la-lady/la-lady.routes').then((m) => m.laLadyRoutes),
  },
  {
    path: 'c4',
    loadChildren: () => import('./c4/c4.routes').then((m) => m.c4Routes),
  },
  {
    path: 'mc3',
    loadChildren: () => import('./mc3/mc3.routes').then((m) => m.mc3Routes),
  },
  { path: '**', redirectTo: '' },
];
