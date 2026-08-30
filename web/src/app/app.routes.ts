import { Routes } from '@angular/router';
import { BrowseComponent } from './pages/browse/browse.component';
import { PresetDetailComponent } from './pages/preset-detail/preset-detail.component';

export const routes: Routes = [
  { path: '', redirectTo: 'h90', pathMatch: 'full' },
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
  { path: '**', redirectTo: 'h90' },
];
