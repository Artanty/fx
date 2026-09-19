"""Toggle visibility of the running Eventide Control / H90 Control app.

Uses the shared h90_app window helpers (set_window_transparent / opaque on every
top-level window of the app), the same ones set_slot_a uses for headless mode.

Usage:
  python app_visibility.py hide      # make windows transparent-but-clickable
  python app_visibility.py show      # restore full opacity
  python app_visibility.py status    # print which app is running
Exit code 0 on success, 2 if the app is not running.
"""
import sys

import h90_app


def main():
    if len(sys.argv) < 2 or sys.argv[1] not in ("hide", "show", "status"):
        print("usage: app_visibility.py hide|show|status")
        return 1
    action = sys.argv[1]

    hit = h90_app.running_app()
    if hit is None:
        print("ERROR: Eventide Control / H90 Control app is not running", file=sys.stderr)
        return 2
    app, exe, pid = hit
    print(f"app: {app} (pid {pid})")

    if action == "status":
        return 0

    if action == "hide":
        ok = h90_app.hide_app_windows()
    else:
        ok = h90_app.show_app_windows()
    print(f"{action}: {'ok' if ok else 'FAILED'}")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())