#!/usr/bin/env python3
"""Automate Eventide Control login/logout.

Usage:
  python login.py login [email] [password]   # use auth.json by default
  python login.py logout
  python login.py check                        # report login/device state

Today's app cold-starts with a valid stored JWT (credentials.esm) and skips the
login screen, so login is only ever needed after a logout. When it is needed:
  * email Edit     (312,249,712,284)
  * password Edit  (312,300,712,335)
  * Log In button  (462,407,562,435)
  * app menu button top-left opens menu; Log Out at (137,167) when menu open.
"""

import json
import os
import sys
import time

sys.stdout.reconfigure(errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pywinauto.keyboard import send_keys
from pywinauto.mouse import click

import h90_app
from auto_import import _labeled_elements, _mouse_click, connect_if_needed  # noqa

AUTH_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "auth.json")

# Login screen geometry (measured on the running app at L1,T31,R1023,B1039).
EMAIL_EDIT = (312, 249, 712, 284)
PASS_EDIT = (312, 300, 712, 335)
LOGIN_BTN = (462, 407, 562, 435)
MENU_BTN = (25, 93)                 # app menu (top-left of list header)
LOG_OUT_ITEM = (137, 167)           # Log Out row in the open menu


def read_credentials(path=AUTH_PATH):
    """Return (email, password) from auth.json, or (None, None)."""
    if not os.path.isfile(path):
        return None, None
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        return (data.get("email") or "").strip(), (data.get("password") or "")
    except Exception:
        return None, None


def _has_login_btn(win):
    for c, t, _r in _labeled_elements(win):
        if c == "Button" and t == "Log In":
            return True
    return False


def _has_device(win):
    for c, t, _r in _labeled_elements(win):
        if c == "Button" and t.startswith("H90:"):
            return True
    return False


def state():
    """Return ('login', 'device', 'home', 'none') for the running app."""
    try:
        win = h90_app.main_window()
    except Exception:
        return "none"
    if _has_device(win):
        return "device"
    if _has_login_btn(win):
        return "login"
    # Home / My Devices / settings screens have neither
    return "home"


def is_logged_in():
    return state() != "login"


def ensure_auth(timeout=40.0):
    """Log in automatically if the app is at the login screen; no-op otherwise.
    Reads credentials from auth.json. Returns True when home/device is
    reached. Returns False when the login screen is up but no credentials are
    configured (caller may fall back to a manual prompt)."""
    st = state()
    if st != "login":
        return st in ("home", "device")
    email, password = read_credentials()
    if not email or not password:
        print("LOGIN: no credentials (auth.json missing)")
        return False
    ok = do_login(email, password, timeout=timeout)
    print("LOGIN: %s (%s)" % ("ok" if ok else "FAIL", state()))
    return ok


def logout(win=None):
    """Click the top-left app menu, then Log Out. Returns True on success."""
    win = win or h90_app.main_window()
    try:
        win.set_focus()
    except Exception:
        pass
    time.sleep(0.3)
    send_keys("{ESC}")
    time.sleep(0.4)
    click(coords=MENU_BTN)
    time.sleep(1.0)
    # Log Out row
    click(coords=LOG_OUT_ITEM)
    print("LOGIN: clicked Log Out")
    deadline = time.time() + 20
    while time.time() < deadline:
        if state() == "login":
            print("LOGIN: now at login screen")
            time.sleep(1.0)
            return True
        time.sleep(0.5)
    return False


def do_login(email, password, win=None, timeout=40.0, tries=3):
    """Fill email/password and press Log In. JUCE shows an app-modal 'Login
    Failed, Try Again' box on rejected attempts that blocks all input behind
    it, so we dismiss that modal (if present) and retry the submission.
    Returns True when logged in."""
    win = win or h90_app.main_window()
    try:
        win.set_focus()
    except Exception:
        pass
    time.sleep(0.5)

    for attempt in range(tries):
        _dismiss_login_failed(win)
        time.sleep(1.0)

        # email: click into the field (real cursor click) before typing, since
        # set_focus() does not reliably give JUCE keyboard focus.
        _fill_edit(EMAIL_EDIT, email)
        _fill_edit(PASS_EDIT, password)
        time.sleep(0.4)

        # click Log In
        click(coords=((LOGIN_BTN[0] + LOGIN_BTN[2]) // 2,
                      (LOGIN_BTN[1] + LOGIN_BTN[3]) // 2))
        print("LOGIN: submitted credentials (attempt %d)" % (attempt + 1))
        deadline = time.time() + timeout
        while time.time() < deadline:
            st = state()
            if st != "login":
                print("LOGIN: left login screen -> %s" % st)
                return True
            if _dismiss_login_failed(win):
                print("LOGIN: attempt %d rejected (Login Failed modal)" % (attempt + 1))
                break
            time.sleep(0.5)
    return False


def _dismiss_login_failed(win):
    """If a 'Login Failed, Try Again' modal is up, click its OK button.
    Returns True when a modal was dismissed."""
    for c, t, r in _labeled_elements(win):
        if c == "Text" and "Login Failed" in t:
            for c2, t2, r2 in _labeled_elements(win):
                if c2 == "Button" and t2 == "OK":
                    try:
                        _mouse_click(r2)
                    except Exception:
                        pass
                    time.sleep(1.0)
                    return True
    return False


def _fill_edit(rect, text):
    """Click a login field, select-all, type the value."""
    el = _edit_at(rect)
    if el is None:
        return False
    try:
        r = el.rectangle()
        click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))
    except Exception:
        return False
    time.sleep(0.3)
    send_keys("^a")
    time.sleep(0.15)
    send_keys(_literal(text), with_spaces=True)
    time.sleep(0.3)
    return True


def _edit_at(rect):
    """Find the visible Edit whose rect overlaps the given login-field rect."""
    try:
        win = h90_app.main_window()
    except Exception:
        return None
    for el in win.descendants():
        try:
            if el.element_info.control_type != "Edit":
                continue
            r = el.rectangle()
        except Exception:
            continue
        if (abs(r.left - rect[0]) < 8 and abs(r.top - rect[1]) < 8
                and abs(r.width() - (rect[2] - rect[0])) < 12):
            return el
    return None


def _literal(s):
    """Escape a string for pywinauto send_keys (backslashes/braces)."""
    return s.replace("\\", "\\\\")


def main():
    args = sys.argv[1:]
    if not args or args[0] == "check":
        hit = h90_app.running_app()
        if not hit:
            print("app: not running")
            return 0
        print("app: pid %d state=%s" % (hit[2], state()))
        return 0
    if args[0] == "logout":
        if h90_app.running_app():
            print("LOGOUT: %s" % ("ok" if logout() else "FAIL (no login screen)"))
            return 0
        print("app not running")
        return 1
    if args[0] == "login":
        email, password = read_credentials()
        if len(args) >= 3:
            email, password = args[1], args[2]
        if not email or not password:
            print("no credentials (auth.json missing) or args")
            return 1
        if not h90_app.running_app():
            print("app not running")
            return 1
        st = state()
        if st == "device":
            print("already logged in (device)")
            return 0
        if st != "login":
            print("unexpected screen: %s - expected login" % st)
            return 1
        ok = do_login(email, password)
        print("LOGIN: %s (%s)" % ("ok" if ok else "FAIL", state()))
        return 0 if ok else 1
    print("usage: python login.py login [email] [password] | logout | check")
    return 2


if __name__ == "__main__":
    sys.exit(main())