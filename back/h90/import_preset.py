#!/usr/bin/env python3
"""Import a preset from a file into the H90 Slot A via the Eventide Control
app's own "Import..." path.

Flow:
  1. Click the Slot-A header menu button -> popup with "Import..." item.
  2. Click "Import..." -> a NATIVE "Select a Preset file" dialog opens
     (real screen coordinates, unlike the virtual save-dialog canvas).
  3. Type the full path into the filename Edit, invoke Open (Открыть).
  4. Wait for the dialog to close; report what Slot A now shows.

The accepted file types are: *.preset9;*.preset90;*.h9z;*.tide

Usage:
  python import_preset.py <path-to-preset-file>
"""

import os
import sys
import time

sys.stdout.reconfigure(errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pywinauto import Desktop
from pywinauto.mouse import click

import h90_app
from export_m2_lib import literal_keys

# Slot header menu buttons and the "Import..." item offset for each slot
# (measured on the running Eventide Control 2.2.0 window at L1,T31,R1023,B1039).
# Slot A menuButton (297,194,321,218); slot B menuButton (660,194,684,218).
SLOT_MENUS = {"A": (309, 206), "B": (672, 206)}
ITEM_IMPORT = {"A": (439, 336), "B": (802, 336)}   # "Import..." row per popup

# Native dialog geometry (real screen coords while open).
FN_EDIT = (213, 501, 716, 516)    # 'Имя файла:' filename Edit
DIALOG_REGION_TOP = 470           # real dialog controls sit below this y

# Slot name-edit and algorithm-label horizontal bands (measured on the running
# app). Slot A name Edit (450,181,578,231); slot B name Edit (825,181,912,231).
SLOT_NAME_BAND = {"A": (440, 660, 175, 230), "B": (700, 1007, 175, 230)}
SLOT_ALGO_BAND = {"A": (360, 690, 175, 230), "B": (700, 1007, 175, 230)}


def _pipe(w):
    return h90_app.connect()


def _find_filename_edit():
    """Return the filename Edit element of the native import dialog, or None.
    Real geometry measured: (213,501,716,516) - left field of the dialog row."""
    app = _pipe(None)
    for w in app.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Edit":
                    continue
                r = el.rectangle()
            except Exception:
                continue
            if (r.top >= 485 and r.top < 530
                    and r.left >= 200 and r.left < 740
                    and r.height() <= 40):
                return el
    return None


def _find_dialog_button(text):
    """Find a Button whose label contains the given lower-cased substring in
    the native dialog's button row (bottom of the dialog)."""
    app = _pipe(None)
    for w in app.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Button":
                    continue
                r = el.rectangle()
                if not (r.top > 500 and r.top < 600 and r.left > 700):
                    continue
                t = (el.window_text() or "").strip().lower()
            except Exception:
                continue
            if text in t:
                return el
    return None


def open_button():
    return _find_dialog_button("откр")


def cancel_button():
    return _find_dialog_button("отмен")


def dialog_open():
    return _find_filename_edit() is not None


def wait_dialog_close(tries=30):
    for _ in range(tries):
        if not dialog_open():
            return True
        time.sleep(0.3)
    return False


def dismiss_stale_dialog():
    """Close any import dialog that may still be open. Returns True when clean."""
    if not dialog_open():
        return True
    c = cancel_button()
    if c is not None:
        try:
            c.invoke()
        except Exception:
            pass
    if wait_dialog_close(tries=20):
        return True
    from pywinauto.keyboard import send_keys
    send_keys("{ESC}")
    return wait_dialog_close(tries=10)


def slot_preset_name(slot="A"):
    """Return the current slot's program/preset name read from the app's own
    header edit (control_type Edit, in that slot's horizontal band)."""
    try:
        win = h90_app.main_window()
    except Exception:
        return None
    lo, hi, top, bottom = SLOT_NAME_BAND[slot]
    for el in win.descendants():
        try:
            if el.element_info.control_type != "Edit":
                continue
            r = el.rectangle()
            if lo <= r.left <= hi and top <= r.top <= bottom:
                return (el.get_value() or "").strip()
        except Exception:
            continue
    return None


def slot_algorithm(slot="A"):
    """Return the slot's algorithm label text (Text right of the slot letter)."""
    try:
        win = h90_app.main_window()
    except Exception:
        return None
    lo, hi, top, bottom = SLOT_ALGO_BAND[slot]
    for el in win.descendants():
        try:
            if el.element_info.control_type != "Text":
                continue
            t = el.window_text()
            r = el.rectangle()
            if (t.strip() and t.strip() not in ("A", "B")
                    and lo <= r.left <= hi and top <= r.top <= bottom):
                return t.strip()
        except Exception:
            continue
    return None


def open_slot_import_dialog(slot="A"):
    """Open the slot menu, click Import..., wait for the native dialog.
    Returns True when the filename Edit is present."""
    if dialog_open():
        return True
    try:
        h90_app.main_window().set_focus()
    except Exception:
        pass
    time.sleep(0.4)
    from pywinauto.keyboard import send_keys
    send_keys("{ESC}")
    time.sleep(0.4)

    click(coords=SLOT_MENUS[slot])
    time.sleep(1.2)
    # popup items live in a narrow secondary window of the app
    app = _pipe(None)
    item = None
    for w in app.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type == "MenuItem" and el.window_text().strip() == "Import...":
                    item = el
                    break
            except Exception:
                continue
        if item is not None:
            break
    if item is None:
        # fallback: fixed measured position of the Import... row
        click(coords=ITEM_IMPORT[slot])
    else:
        try:
            item.invoke()
        except Exception:
            r = item.rectangle()
            click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))
    time.sleep(1.5)
    return dialog_open()


def set_filename(path):
    """Type the full file path into the filename Edit. Returns True if the
    dialog's edit now contains it."""
    edit = _find_filename_edit()
    if edit is None:
        return False
    try:
        edit.set_focus()
        time.sleep(0.2)
        from pywinauto.keyboard import send_keys
        send_keys("^a")
        time.sleep(0.15)
        send_keys(literal_keys(path), with_spaces=True)
        time.sleep(0.4)
        got = (edit.get_value() or "").strip()
        return got.lower() == path.lower()
    except Exception:
        return False


def import_preset(path, slot="A"):
    """Import a preset file into the given slot ('A' or 'B').
    Returns (status, slot_name)."""
    path = os.path.abspath(path)
    if not os.path.isfile(path):
        return ("no-file", slot_preset_name(slot))

    if not open_slot_import_dialog(slot):
        # maybe a stale dialog is already up
        if not dialog_open():
            return ("no-dialog", slot_preset_name(slot))

    if not set_filename(path):
        return ("type-fail", slot_preset_name(slot))

    ok = open_button()
    if ok is None:
        cancel = cancel_button()
        if cancel is not None:
            try:
                cancel.invoke()
            except Exception:
                pass
        return ("no-open", slot_preset_name(slot))

    try:
        ok.invoke()
    except Exception:
        click(coords=((ok.rectangle().left + ok.rectangle().right) // 2,
                      (ok.rectangle().top + ok.rectangle().bottom) // 2))

    for _ in range(40):
        time.sleep(0.3)
        if not dialog_open():
            break

    name = slot_preset_name(slot)
    algo = slot_algorithm(slot)
    if not dialog_open():
        return ("imported", "%s / %s" % (name or "?", algo or "?"))

    cancel = cancel_button()
    if cancel is not None:
        try:
            cancel.invoke()
        except Exception:
            pass
    return ("unconfirmed", "%s / %s" % (name or "?", algo or "?"))


def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument("path", help="path to preset file")
    parser.add_argument("--slot", choices=["A", "B"], default="A")
    args = parser.parse_args()
    status, info = import_preset(args.path, args.slot)
    print("STATUS: %s" % status)
    print("SLOT %s: %s" % (args.slot, info))
    return 0 if status == "imported" else 1


if __name__ == "__main__":
    sys.exit(main())