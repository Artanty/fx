"""Shared H90 / Eventide Control app detection and window helpers.

The native control app changed names across versions:

  Eventide Control 2.2.0  (current)  exe "Eventide Control.exe"  title "Eventide Control"
  H90 Control (legacy)               exe "H90 Control.exe"       title "H90 Control"

All automation (uia_driver, assign_cc, save_to_library, load_effect,
test_assign_cc, export_m2_lib) attaches to whichever of the two is actually
running: detection prefers the new app and falls back to the legacy one.
"""

import ctypes
import sys
import time

sys.stdout.reconfigure(errors="replace")

import psutil
from pywinauto import Application, Desktop

APP_EXES = ("Eventide Control.exe", "H90 Control.exe")
APP_TITLES = ("Eventide Control", "H90 Control")

WS_EX_LAYERED = 0x00080000
LWA_ALPHA = 0x00000002
GWL_EXSTYLE = -20

# psutil may report the 8.3 short name for installed apps.
_EXE_ALIASES = {
    "eventide control.exe": "Eventide Control.exe",
    "eventi~1.exe": "Eventide Control.exe",
    "h90 control.exe": "H90 Control.exe",
}


def _norm_name(raw):
    return (raw or "").strip().lower()


def running_app():
    """Return the display name ('Eventide Control' or 'H90 Control') of the app
    that is running, or None. Prefers the current app over the legacy one."""
    for p in psutil.process_iter(["pid", "name", "exe"]):
        exe = p.info["exe"] or ""
        name = p.info["name"] or ""
        long = None
        for probe in (exe, name):
            base = probe.replace("/", "\\").split("\\")[-1] if probe else ""
            base = _norm_name(base)
            if base in _EXE_ALIASES:
                long = _EXE_ALIASES[base]
                break
        if long:
            app = "Eventide Control" if long == "Eventide Control.exe" else "H90 Control"
            return app, long, p.info["pid"]
    return None


def find_pid():
    """Return the PID of the running H90/Eventide Control app."""
    hit = running_app()
    if hit is None:
        raise RuntimeError("H90/Eventide Control app is not running")
    return hit[2]


def running_title():
    hit = running_app()
    return hit[0] if hit else None


def connect():
    """Return a pywinauto UIA Application handle for the running app."""
    return Application(backend="uia").connect(process=find_pid())


def is_main_title(text):
    return (text or "").strip() in APP_TITLES


def desktop():
    return Desktop(backend="uia")


def main_window(d=None):
    """Return the app's main (wide) window wrapper for the running app."""
    d = d or desktop()
    pid = find_pid()
    for w in d.windows(process=pid):
        r = w.rectangle()
        if r.width() >= 800 and r.height() >= 400:
            return w
    raise RuntimeError("main window not found")


PIN_RECT = (1, 31, 1023, 1039)   # canonical geometry all coords were measured on
SWP_NOZORDER = 0x0004
SWP_NOACTIVATE = 0x0010


def pin_window(max_tries=4):
    """Move/resize the app's main window to the canonical rect PIN_RECT
    (1,31,1023x1039) that every fixed coordinate was measured against, so the
    automation works regardless of which monitor the app opened on.

    Uses the caller's window wrapper for measurements but drives the move via
    SetWindowPos on the real hwnd. The Win10+ invisible-frame offsets are
    self-calibrated each call (GetWindowRect vs pywinauto rect), so the map
    holds regardless of monitor/DPI. Returns the pinned window rectangle."""
    from ctypes import wintypes
    user32 = ctypes.windll.user32
    for _ in range(max_tries):
        win = main_window()
        cur = win.rectangle()
        if (cur.left, cur.top, cur.right, cur.bottom) == PIN_RECT:
            return cur
        # frame deltas: GetWindowRect (physical window frame) vs pywinauto rect
        gr = wintypes.RECT()
        user32.GetWindowRect(win.handle, ctypes.byref(gr))
        dl = gr.left - cur.left
        dt = gr.top - cur.top
        dr = gr.right - cur.right
        db = gr.bottom - cur.bottom
        # SWP coords that land the pywinauto rect on PIN_RECT
        x = PIN_RECT[0] + dl
        y = PIN_RECT[1] + dt
        w = (PIN_RECT[2] - PIN_RECT[0]) + (dr - dl)
        h = (PIN_RECT[3] - PIN_RECT[1]) + (db - dt)
        user32.SetWindowPos(win.handle, 0, x, y, w, h,
                            SWP_NOZORDER | SWP_NOACTIVATE)
        time.sleep(0.7)
    return main_window().rectangle()


def popup_window(d=None):
    """Return the app's first narrow (popup/dialog) window, or None."""
    d = d or desktop()
    pid = find_pid()
    for w in d.windows(process=pid):
        if w.rectangle().width() < 800:
            return w
    return None


def collect_popup_windows(d=None):
    """Return a list of the app's narrow windows (popups/dialogs)."""
    d = d or desktop()
    pid = find_pid()
    return [w for w in d.windows(process=pid) if w.rectangle().width() < 800]


def set_window_transparent(hwnd, alpha=1):
    """Make a top-level window fully (or partially) transparent while keeping
    it hit-testable: WS_EX_LAYERED + SetLayeredWindowAttributes LWA_ALPHA.

    alpha must be >= 1: at alpha=0 the window also stops receiving mouse input
    (click-through), which breaks the coordinate-click automation. alpha=1 is
    1/255 opacity, imperceptible to the eye, while fully clickable.
    Returns True on success."""
    try:
        user32 = ctypes.windll.user32
        ex = user32.GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED
        user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex)
        ok = user32.SetLayeredWindowAttributes(hwnd, 0, alpha, LWA_ALPHA)
        return bool(ok)
    except Exception:
        return False


def set_window_opaque(hwnd):
    """Restore full opacity (LWA_ALPHA=255) on a layered window."""
    try:
        user32 = ctypes.windll.user32
        return bool(user32.SetLayeredWindowAttributes(hwnd, 0, 255, LWA_ALPHA))
    except Exception:
        return False


def transparent_supported(hwnd):
    """True when SetLayeredWindowAttributes reports success on this box."""
    ex = ctypes.windll.user32.GetWindowLongW(hwnd, GWL_EXSTYLE) | WS_EX_LAYERED
    ctypes.windll.user32.SetWindowLongW(hwnd, GWL_EXSTYLE, ex)
    ok = ctypes.windll.user32.SetLayeredWindowAttributes(hwnd, 0, 200, LWA_ALPHA)
    return bool(ok)


def _top_hwnds():
    """Screen handles of every top-level window belonging to the app PID."""
    pid = find_pid()
    out = []
    d = desktop()
    for w in d.windows(process=pid):
        try:
            out.append(w.handle)
        except Exception:
            continue
    return out


def hide_app_windows():
    """Make every app top-level window (main, popups, native dialogs) fully
    transparent but still hit-testable. Used by set_slot_a --headless."""
    ok = True
    for hwnd in _top_hwnds():
        ok = set_window_transparent(hwnd) and ok
    return ok


def show_app_windows():
    """Restore full opacity on every app top-level window."""
    ok = True
    for hwnd in _top_hwnds():
        ok = set_window_opaque(hwnd) and ok
    return ok


def lower_window():
    """Send every app top-level window to the BOTTOM of the z-order so it sits
    behind other windows (used when the automation has finished). The window
    stays where it is (no move/activate/size change)."""
    SWP_NOSIZE = 0x0001
    SWP_NOMOVE = 0x0002
    SWP_NOACTIVATE = 0x0010
    ok = True
    for hwnd in _top_hwnds():
        try:
            user32 = ctypes.windll.user32
            r = user32.SetWindowPos(hwnd, 1, 0, 0, 0, 0,
                                    SWP_NOSIZE | SWP_NOMOVE | SWP_NOACTIVATE)
            ok = bool(r) and ok
        except Exception:
            ok = False
    return ok


if __name__ == "__main__":
    hit = running_app()
    print("running_app:", hit)
    if hit:
        print("pid:", find_pid())
        app = connect()
        for w in app.windows():
            print("  WIN %r %s" % (w.window_text(), w.rectangle()))