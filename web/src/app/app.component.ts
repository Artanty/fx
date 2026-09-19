import { ChangeDetectionStrategy, Component } from '@angular/core';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter } from 'rxjs';

const LAST_ROUTE_KEY = 'fx.lastRoute';

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
    this.rememberLastRoute();
    this.restoreLastRoute();
  }

  private rememberLastRoute(): void {
    this.router.events
      .pipe(filter((e) => e instanceof NavigationEnd))
      .subscribe((e) => {
        localStorage.setItem(LAST_ROUTE_KEY, e.urlAfterRedirects);
      });
  }

  private restoreLastRoute(): void {
    const last = localStorage.getItem(LAST_ROUTE_KEY);
    if (!last || last === this.router.url) return;
    this.router.navigateByUrl(last);
  }
}
