#!/usr/bin/env python3
"""Fully automated flow: recall H90 program slot N via MIDI, import a preset
file into Slot A, then Save so the change persists on the pedal.

Key facts (verified on Eventide Control 2.2.0 / H90 XC-05987):
  * The app holds the 'H90 Pedal' MIDI port ONLY while connected to the
    pedal. While disconnected (My Devices screen) the port is free, so MIDI
    Program Change can recall a slot without closing the app.
  * PC Offset is OFF (byte = slot, not slot-1): PC byte N recalls slot N.
  * MIDI receive channel is 11.

Flow:
  1. Attach to a running Eventide Control instance, or launch one (and pause
     for the manual account login if the login screen shows).
  2. Disconnect if connected (frees the MIDI port).
  3. MIDI Program Change channel 11 byte N via back/h90/recall.js.
  4. Connect the pedal, wait for the H90 device.
  5. Verify the header program number == N.
  6. Import the preset file into Slot A (import_preset.import_preset).
  7. Click the header Save button so the edit is written back to the pedal.
  8. Verify header number still == N and Slot A shows the preset.
  9. Disconnect and leave the app running (so the next run needs no login).

Usage:
  python set_slot_a.py <program-N> <path-to-preset-file>

The app stays visible on screen (no headless/hide mode).
"""

import os
import subprocess
import sys
import time
import traceback

sys.stdout.reconfigure(errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import h90_app
import import_preset
from auto_import import (
    APP_PATH,
    WAIT_APP_TIMEOUT,
    _dismiss_modified_modal,
    _find,
    _has_device,
    _labeled_elements,
    _mouse_click,
    connect_if_needed,
)

HERE = os.path.dirname(os.path.abspath(__file__))
RECALL_JS = os.path.join(HERE, "recall.js")
IMPORT_ERR_LOG = os.path.join(HERE, "import.err.log")
MIDI_CHANNEL = 11
SAVE_BUTTON = (911, 141, 975, 169)      # header Save button (right of name edit)
SETTLE_AFTER_RECALL = 3.0
SAVE_WAIT = 15.0
CONNECT_WAIT = 60.0


def ensure_app_running():
    """Attach to a running instance or launch one. Returns (pid, launched)."""
    hit = h90_app.running_app()
    if hit:
        return hit[2], False
    if not os.path.isfile(APP_PATH):
        print("STATUS: app-missing (%s)" % APP_PATH)
        return None, True
    print("launching", APP_PATH)
    subprocess.Popen([APP_PATH])
    deadline = time.time() + WAIT_APP_TIMEOUT
    while time.time() < deadline:
        hit = h90_app.running_app()
        if hit:
            return hit[2], True
        time.sleep(0.5)
    return None, True


def disconnect(win):
    """Click Disconnect if the app is connected, freeing the MIDI port."""
    for _ in range(10):
        for ctrl, t, r in _labeled_elements(win):
            if ctrl == "Button" and t == "Disconnect":
                _mouse_click(r)
                time.sleep(1.5)
                return True
            if ctrl == "Button" and t == "Connect":
                return True   # already disconnected
        time.sleep(0.5)
    # maybe main window changed; re-resolve
    return False


def recall_program(n):
    """MIDI recall of program slot n (byte = n, PC Offset off). Returns rc."""
    if not os.path.isfile(RECALL_JS):
        print("STATUS: no-recall-js (%s)" % RECALL_JS)
        return 1
    r = subprocess.run(
        ["node", RECALL_JS, "--program", str(n), "--channel", str(MIDI_CHANNEL)],
        capture_output=True, text=True, timeout=30, cwd=HERE,
    )
    print("RECALL: %s" % (r.stdout or "").strip())
    time.sleep(SETTLE_AFTER_RECALL)
    return r.returncode


def header_number(win):
    """Program slot number shown in the header Text element."""
    for ctrl, t, r in _labeled_elements(win):
        if ctrl == "Text" and 300 <= r.left <= 350 and 135 <= r.top <= 175:
            if (t or "").strip().isdigit():
                return (t or "").strip().lstrip("0") or "0"
    return None


def program_name(win):
    """Program name shown in the header Edit (not Slot A)."""
    for ctrl, t, r in _labeled_elements(win):
        if ctrl == "Edit" and r.left >= 340 and r.left <= 380 and 130 <= r.top <= 180:
            return (t or "").strip()
    return None


def set_program_name(win, name):
    """Rename the whole program so Save accepts it: click header edit, ^a, type.
    Returns the new name Edit text, or None."""
    from pywinauto.keyboard import send_keys
    from pywinauto.mouse import click
    for ctrl, t, r in _labeled_elements(win):
        if ctrl == "Edit" and r.left >= 340 and r.left <= 380 and 130 <= r.top <= 180:
            click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))
            time.sleep(0.3)
            send_keys("^a")
            time.sleep(0.15)
            from login import _literal
            send_keys(_literal(name), with_spaces=True)
            time.sleep(0.3)
            return name
    return None


def _dismiss_program_name_error(win):
    """If a 'Program Name Error' modal is up (reserved 'INIT Program' name),
    click its OK button. Returns True when a modal was dismissed."""
    from auto_import import _labeled_elements as _le
    for c, t, r in _le(win):
        if c == "Text" and "Program Name Error" in t:
            for c2, t2, r2 in _le(win):
                if c2 == "Button" and t2 == "OK":
                    try:
                        _mouse_click(r2)
                    except Exception:
                        pass
                    return True
    return False


def prep_program_name(win, path):
    """Factory programs are named 'INIT Program'/'INIT q-plus', which the app
    REFUSES to save ('Programs cannot be named INIT Program'). Rename whole
    program from the preset filename before saving. Returns the new name, or
    None when the current name is already saveable."""
    pn = program_name(win) or ""
    if pn and not pn.lower().startswith("init"):
        return None
    base = os.path.splitext(os.path.basename(path))[0]
    new = base[:40] or "PROG"
    print("PROGRAM NAME: '%s' -> '%s' (INIT names cannot be saved)" % (pn, new))
    set_program_name(win, new)
    return new


def click_save(win):
    """Click the header Save button and wait until the program name loses its
    '*' (unsaved) marker. Returns True when saved."""
    from pywinauto.mouse import click
    click(coords=((SAVE_BUTTON[0] + SAVE_BUTTON[2]) // 2,
                  (SAVE_BUTTON[1] + SAVE_BUTTON[3]) // 2))
    _dismiss_program_name_error(win)
    deadline = time.time() + SAVE_WAIT
    while time.time() < deadline:
        time.sleep(0.5)
        pn = program_name(win)
        if pn is not None and not pn.endswith("*"):
            return True
    return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Recall program N and import a specified preset file into Slot A or B, then Save.")
    parser.add_argument("program", type=int, help="program slot number 1-100")
    parser.add_argument("path", help="path to preset file")
    parser.add_argument("--slot", choices=["A", "B"], default="A", help="target slot (default: A)")
    args = parser.parse_args()
    n = args.program
    slot = args.slot
    if not (1 <= n <= 100):
        print("STATUS: program-out-of-range (%d)" % n)
        return 2
    path = os.path.abspath(args.path)
    if not os.path.isfile(path):
        print("STATUS: no-file (%s)" % path)
        return 1

    # 1. app up (attach or launch + cold start login + connect)
    pid, launched = ensure_app_running()
    if pid is None:
        print("STATUS: app-fail")
        return 1
    print("app pid %d (launched=%s)" % (pid, launched))
    h90_app.pin_window()   # canonical rect: all fixed coords were measured on it

    try:
        win = h90_app.main_window()
    except Exception:
        print("STATUS: no-window")
        return 1
    # drive cold start: auto-login from auth.json + connect screen
    if not connect_if_needed(timeout=75.0):
        print("STATUS: no-device")
        return 1

    # 2. disconnect -> free MIDI port (recall cannot reach pedal while connected)
    disconnect(win)
    time.sleep(1.0)

    # 3. MIDI recall of program n
    if recall_program(n) != 0:
        print("STATUS: recall-fail")
        return 1

    # 4. connect
    connect_if_needed(timeout=CONNECT_WAIT)
    win = h90_app.main_window()
    _dismiss_modified_modal(win)

    # 5. confirm the recalled slot landed
    num = header_number(win)
    print("HEADER NUMBER NOW: %s" % num)
    if num is not None and num != str(n):
        print("STATUS: wrong-program (want %d got %s)" % (n, num))
        return 1

    # 5b. force the Parameters editor view (a reconnect can land on the
    # Programs/bank list where the slot-B menu button is a dead click)
    try:
        from pywinauto.mouse import click
        click(coords=(386, 97))       # 'Edit' radio (rel y 82..112)
        time.sleep(1.4)
        win = h90_app.main_window()
    except Exception:
        pass

    # 6. import into the target slot
    try:
        status, info = import_preset.import_preset(path, slot)
    except Exception as ex:
        tb = "".join(traceback.format_exception(type(ex), ex, ex.__traceback__))
        try:
            with open(IMPORT_ERR_LOG, "a", encoding="utf-8") as f:
                f.write("\n=== import_preset(%s, %s) crashed ==="
                        % (path, slot) + "\n" + tb)
            print("import crashed, see %s" % IMPORT_ERR_LOG)
        except OSError:
            print("import crashed: %s" % tb)
        print("STATUS: import-crashed")
        return 1
    print("STATUS: %s" % status)
    print("SLOT %s: %s" % (slot, info))
    if status != "imported":
        return 1

    # 7. Save so the change persists on the pedal
    prep_program_name(win, path)
    if not click_save(win):
        print("STATUS: save-fail")
        return 1
    print("SLOT %s SAVED to program %d" % (slot, n))

    # 8. re-verify after save
    num = header_number(win)
    print("HEADER NUMBER AFTER SAVE: %s" % num)
    name = import_preset.slot_preset_name(slot)
    print("SLOT %s AFTER SAVE: %s" % (slot, name))

    # 9. disconnect and leave the app open for the next run
    disconnect(win)
    return 0 if (num is None or num == str(n)) else 1


if __name__ == "__main__":
    sys.exit(main())