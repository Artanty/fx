import { Routes } from '@angular/router';

export const c4Routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./c4.component').then((m) => m.C4Component),
  },
];