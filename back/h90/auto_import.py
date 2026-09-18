#!/usr/bin/env python3
"""Auto-import a preset file into the H90 Slot A without the user manually
opening Eventide Control.

Behavior:
  - If Eventide Control / H90 Control is already running: reuse it and leave it
    open afterwards.
  - Otherwise: spawn the app, wait for the H90 device to appear (connected),
    run import_preset.import_preset(), then close the app and wait for the
    process to exit.

Usage:
  python auto_import.py <path-to-preset-file>
"""

import ctypes
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import h90_app
import import_preset

APP_PATH = r"C:\Program Files\Eventide\Eventide Control.exe"
WM_CLOSE = 0x0010
WAIT_APP_TIMEOUT = 60.0
WAIT_DEVICE_TIMEOUT = 60.0
WAIT_EXIT_TIMEOUT = 15.0


def _labeled_elements(win):
    """Return [(control_type, text, rect)] for visible labeled elements."""
    out = []
    try:
        for el in win.descendants():
            try:
                t = el.window_text() or ""
                r = el.rectangle()
                if t.strip() and r.width() > 0 and r.height() > 0:
                    out.append((el.element_info.control_type, t.strip(), r))
            except Exception:
                continue
    except Exception:
        pass
    return out


def _find(win, cc, text):
    for ctrl, t, r in _labeled_elements(win):
        if ctrl == cc and t == text:
            return r
    return None


def _mouse_click(r):
    from pywinauto.mouse import click
    click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))


def _has_device(win):
    """True once the real main UI shows the connected device button
    ('H90: XC-05987') plus the Disconnect button. Ignores the earlier
    'Checking for software updates ... H90 ...' splash."""
    labels = _labeled_elements(win)
    has_device_btn = any(t.startswith("H90:") and cc == "Button" for cc, t, _r in labels)
    has_disconnect = any(t == "Disconnect" for _c, t, _r in labels)
    return has_device_btn and has_disconnect


def _dismiss_modified_modal(win):
    """If the 'program has been modified - save?' modal is up, click No."""
    for _ in range(5):
        hit = False
        for ctrl, t, r in _labeled_elements(win):
            if "has been modified" in t:
                hit = True
                no = _find(win, "Button", "No")
                if no:
                    _mouse_click(no)
                break
        if not hit:
            return True
        time.sleep(1.0)
    return False


def wait_for_manual_login():
    """Block until the user logs in to the account screen manually.

    Printing a clear prompt and waiting for 'done' + Enter. The connect-side
    timeout is suspended during this pause so the user can take their time.
    """
    print("Eventide account screen is up -- please log in manually,")
    print("then type 'done' and press Enter here.")
    while True:
        try:
            reply = input()
        except EOFError:
            return
        if reply.strip().lower() == "done":
            print("continuing...")
            return


def _try_auto_login():
    """Log in automatically from auth.json if the login screen is up.
    Returns True when the app left the login screen, False when no
    credentials are configured (caller falls back to a manual prompt)."""
    try:
        import login
        return login.ensure_auth()
    except Exception:
        return False


def connect_if_needed(timeout=WAIT_DEVICE_TIMEOUT):
    """Drive the cold-start connect/login screen if present, then wait for the
    H90 device to be shown. Returns True when the device is visible."""
    deadline = time.time() + timeout
    login_paused = False
    pinned = False
    while time.time() < deadline:
        try:
            win = h90_app.main_window()
        except Exception:
            win = None
        if win is not None:
            if not pinned:
                h90_app.pin_window()  # canonical rect: coords were measured on it
                pinned = True
            if _has_device(win):
                _dismiss_modified_modal(win)
                return True
            r = _find(win, "Button", "Log In")
            if r is not None and not login_paused:
                # Let the user handle auth manually, or log in automatically
                # when credentials are configured; block until resolved, then
                # keep polling without eating into the wait budget.
                login_paused = True
                if not _try_auto_login():
                    wait_for_manual_login()
                if _has_device(win) or _find(win, "Button", "Connect") is not None:
                    deadline = time.time() + timeout
            if r is not None:
                time.sleep(0.5)
                continue
            r = _find(win, "Button", "Connect")
            if r is not None:
                # invoke() fires JUCE's Connect on some screens where a raw
                # coordinate click misses; fall back to a real click if the
                # button has no usable invoke pattern.
                try:
                    for el in win.descendants():
                        if (el.element_info.control_type == "Button"
                                and (el.window_text() or "") == "Connect"):
                            el.invoke()
                            break
                except Exception:
                    try:
                        _mouse_click(r)
                    except Exception:
                        pass
        time.sleep(0.5)
    return False


def wait_connected(timeout=WAIT_DEVICE_TIMEOUT):
    """Alias keeping old callers working: wait for the H90 device in the app."""
    return connect_if_needed(timeout=timeout)


def _send_wm_close(pid):
    """Best-effort graceful close via WM_CLOSE on the app's main window."""
    try:
        from pywinauto import Desktop
        d = Desktop(backend="uia")
        for w in d.windows(process=pid):
            hwnd = w.handle
            if hwnd and w.rectangle().width() >= 800:
                ctypes.windll.user32.PostMessageW(hwnd, WM_CLOSE, 0, 0)
                return True
    except Exception:
        pass
    return False


def close_app(pid):
    """Close the app, waiting for process exit. Returns True when gone."""
    _send_wm_close(pid)
    deadline = time.time() + WAIT_EXIT_TIMEOUT
    while time.time() < deadline:
        if not h90_app.running_app():
            return True
        time.sleep(0.3)
    # fallback: force kill the specific PID we launched
    try:
        subprocess.run(["taskkill", "/PID", str(pid), "/F"],
                       capture_output=True, timeout=10)
    except Exception:
        pass
    deadline = time.time() + 5
    while time.time() < deadline:
        if not h90_app.running_app():
            return True
        time.sleep(0.3)
    return False


def main():
    if len(sys.argv) < 2:
        print("usage: python auto_import.py <path-to-preset-file>")
        return 2
    path = os.path.abspath(sys.argv[1])
    if not os.path.isfile(path):
        print("STATUS: no-file (%s)" % path)
        return 1

    hit = h90_app.running_app()
    launched = hit is None
    pid = hit[2] if hit else None

    if launched:
        if not os.path.isfile(APP_PATH):
            print("STATUS: app-missing (%s)" % APP_PATH)
            return 1
        print("launching", APP_PATH)
        subprocess.Popen([APP_PATH])
        deadline = time.time() + WAIT_APP_TIMEOUT
        while time.time() < deadline:
            hit = h90_app.running_app()
            if hit:
                pid = hit[2]
                break
            time.sleep(0.5)
        if not hit:
            print("STATUS: app-fail (no process within %ss)" % int(WAIT_APP_TIMEOUT))
            return 1
        print("app started (pid %d)" % pid)

    if not wait_connected():
        print("STATUS: no-device (H90 not shown within %ss)" % int(WAIT_DEVICE_TIMEOUT))
        if launched:
            close_app(pid)
        return 1

    try:
        _dismiss_modified_modal(h90_app.main_window())
    except Exception:
        pass

    status, info = import_preset.import_preset(path)
    print("STATUS: %s" % status)
    print("SLOT A: %s" % info)

    if launched:
        ok = close_app(pid)
        print("app closed: %s" % ok)
        if not ok:
            return 1

    return 0 if status == "imported" else 1


if __name__ == "__main__":
    sys.exit(main())