import { Routes } from '@angular/router';

export const distRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./lalady/lalady.component').then((m) => m.LaladyComponent),
  },
];
