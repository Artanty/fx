import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';
import { writeLastRoute } from './last-route';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AppComponent {
  constructor(private router: Router) {
    // Remember where the user was, but do NOT jump there automatically: "/" is
    // the home page and typing the URL has to land on it. The home page offers
    // the saved route as a "continue" link instead.
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => writeLastRoute(e.urlAfterRedirects));
  }
}
