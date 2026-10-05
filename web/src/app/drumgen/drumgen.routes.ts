import { Routes } from '@angular/router';

export const drumgenRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./drumgen.component').then((m) => m.DrumgenComponent),
  },
];