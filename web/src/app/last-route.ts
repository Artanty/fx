// The app used to force a redirect back to the last visited route on every
// load, which made it impossible to reach "/" by typing the URL. The home page
// now owns that affordance: this key is written on every NavigationEnd and read
// back by HomeComponent to offer "continue where you left off".
export const LAST_ROUTE_KEY = 'fx.lastRoute';

export function readLastRoute(): string | null {
  try {
    const v = localStorage.getItem(LAST_ROUTE_KEY);
    return v && v !== '/' ? v : null;
  } catch {
    return null;
  }
}

export function writeLastRoute(url: string): void {
  try {
    if (url !== '/') localStorage.setItem(LAST_ROUTE_KEY, url);
  } catch {
    /* private mode / storage disabled */
  }
}
