import { Routes } from '@angular/router';

export const mc3Routes: Routes = [
  {
    path: '',
    loadComponent: () => import('./mc3.component').then((m) => m.Mc3Component),
  },
];
