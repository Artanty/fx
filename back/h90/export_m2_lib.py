#!/usr/bin/env python3
"""Remove duplicate m2 entries from the H90 Control in-app Preset Library and
export the 72 m2 presets into input/lib as .preset90 files (overwriting).

Modes:
  python export_m2_lib.py dedupe   - delete duplicate m2 library entries
  python export_m2_lib.py export   - export all 72 m2 presets (overwrite)
  python export_m2_lib.py all      - dedupe then export

The library list uses 40px rows; the app Library contains several duplicate
entries per preset, so dedupe keeps the first (topmost) occurrence of each name
and deletes the rest via the row menu "Delete from Library" (confirmed with OK).

The export uses the library search field to isolate each preset, then the row
menu "Export..." -> JUCE file-save dialog (filename pre-filled, saved straight
into input/lib where the dialog is parked).

The saved .preset90 does NOT contain MIDI CC assignments; those live in
midi_cc_states/*-m2.json.
"""

import csv
import glob
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from pywinauto import Application as PA, mouse
from pywinauto import keyboard

OCR2_PS1 = r"C:\Users\Thoma\AppData\Local\Temp\opencode\ocr2.ps1"
ROOT = os.path.dirname(os.path.abspath(__file__))
CSV_PATH = os.path.join(ROOT, "families_m2.csv")
INPUT_DIR = r"C:\server\fx\input"
LIB_DIR = os.path.join(INPUT_DIR, "lib")
SCRATCH = r"C:\Users\Thoma\AppData\Local\Temp\opencode"

SLOT = "m2"
STATUS_ORDER = [
    "Delay", "Distortion", "EQ", "Harmonizer", "Harmonizer+", "Looper",
    "Modulation", "Multi", "Reverb", "Synth", "Utility",
]
FAM = "delay|dist|eq|harm|harmp|synth|util|utility|looper|mod|multi|reverb"


def get_win():
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    for w in app_ui.windows():
        r = w.rectangle()
        if w.window_text() == "H90 Control" and r.right - r.left > 900:
            return w
    raise RuntimeError("no main window")


def library_name(slot, slug, effect, cap=23):
    eff = effect.replace(" ", "_")
    name = "%s %s %s" % (slot, slug, eff)
    if len(name) > cap:
        prefix = "%s %s " % (slot, slug)
        keep = cap - len(prefix)
        eff = eff[:keep].rstrip("_")
        name = "%s%s" % (prefix, eff)
    return name


def literal_keys(text):
    """Escape pywinauto send_keys special characters so the text is typed
    literally (notably '+' which otherwise acts as the Shift modifier)."""
    out = []
    for ch in text:
        if ch in "+^%~()[]{}":
            out.append("{%s}" % ch)
        else:
            out.append(ch)
    return "".join(out)


def norm_name(s):
    s = s.lower()
    s = s.replace("1", "l").replace("/", "l").replace("_", " ")
    s = re.sub(r"[^a-z0-9+ ]", "", s)
    return re.sub(r"\s+", " ", s).strip()


def load_targets():
    targets = []
    with open(CSV_PATH, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            name = library_name(SLOT, r["slug"], r["effect"])
            targets.append({
                "name": name,
                "key": norm_name(name),
                "category": r["category"],
                "slug": r["slug"],
                "effect": r["effect"],
            })
    return targets


# ---------------------------------------------------------------------------
# Library view / search
# ---------------------------------------------------------------------------
def ensure_library_view():
    try:
        get_win().set_focus()
    except Exception:
        pass
    time.sleep(0.5)
    keyboard.send_keys("{ESC}")
    time.sleep(0.5)
    mouse.click(coords=pt(932, 1018))
    time.sleep(1.0)
    mouse.click(coords=pt(371, 256))
    time.sleep(1.2)
    for _ in range(20):
        mouse.scroll(coords=pt(450, 730), wheel_dist=3)
        time.sleep(0.1)


def find_search_edit():
    try:
        win = get_win()
    except Exception:
        return None
    dx, dy = win_delta()
    try:
        descs = win.descendants()
    except Exception:
        return None
    for el in descs:
        try:
            if el.element_info.control_type != "Edit":
                continue
            r = el.rectangle()
            rx, ty = r.left - dx, r.top - dy
            if 700 < rx < 1020 and 230 < ty < 290:
                return el
        except Exception:
            pass
    return None


def set_search(text):
    edit = find_search_edit()
    if edit is not None:
        try:
            edit.set_focus()
            time.sleep(0.2)
            keyboard.send_keys("^a")
            time.sleep(0.15)
            keyboard.send_keys(literal_keys(text), with_spaces=True)
            time.sleep(0.4)
            keyboard.send_keys("{ENTER}")
            time.sleep(1.2)
            return True
        except Exception:
            pass
    mouse.click(coords=pt(877, 261))
    time.sleep(0.3)
    keyboard.send_keys("^a")
    time.sleep(0.15)
    keyboard.send_keys(literal_keys(text), with_spaces=True)
    time.sleep(0.4)
    keyboard.send_keys("{ENTER}")
    time.sleep(1.2)
    return True


def visible_rows():
    win = get_win()
    try:
        descs = win.descendants()
    except Exception:
        return []
    dx, dy = win_delta()
    rows = {}
    for el in descs:
        try:
            if el.element_info.control_type != "ListItem":
                continue
            r = el.rectangle()
            lx, ty, rx, by = r.left - dx, r.top - dy, r.right - dx, r.bottom - dy
            if lx > 290 and rx > 800 and ty >= 317 and by <= 1000:
                rows[ty] = Rect(r.left, r.top, r.right, r.bottom)
        except Exception:
            pass
    return [rows[k] for k in sorted(rows)]


class Rect:
    def __init__(self, left, top, right, bottom):
        self.left, self.top, self.right, self.bottom = left, top, right, bottom
        (self.left, self.top, self.right, self.bottom) = (int(left), int(top), int(right), int(bottom))

    def center(self):
        return ((self.left + self.right) // 2, (self.top + self.bottom) // 2)


# Reference client-area origin these coordinates were measured against
# (window at L1,T31,R1023,B1039).  Everything else is derived relative to the
# live window rect so the script survives the window being moved/resized.
REF_X, REF_Y = 1, 31


def win_delta():
    try:
        r = get_win().rectangle()
        return r.left - REF_X, r.top - REF_Y
    except Exception:
        return 0, 0


def pt(x, y):
    dx, dy = win_delta()
    return int(x + dx), int(y + dy)


def is_in(x, y):  # translate a relative coord pair back to reference space
    dx, dy = win_delta()
    return x - dx, y - dy


# ---------------------------------------------------------------------------
# Popup / row menu
# ---------------------------------------------------------------------------
def find_popup():
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    p = None
    for w in app_ui.windows():
        r = w.rectangle()
        if 100 < (r.right - r.left) < 250 and 80 < (r.bottom - r.top) < 250 and r.left > 200:
            if p is None or (r.bottom - r.top) < (p.bottom - p.top):
                p = Rect(r.left, r.top, r.right, r.bottom)
    return p


def wait_popup(tries=12):
    for _ in range(tries):
        p = find_popup()
        if p:
            return p
        time.sleep(0.25)
    return None


def popup_title(rect):
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    for w in app_ui.windows():
        rr = w.rectangle()
        if (rr.left, rr.top, rr.right, rr.bottom) == (rect.left, rect.top, rect.right, rect.bottom):
            for el in w.descendants():
                try:
                    tt = el.window_text().strip()
                    if tt.startswith(SLOT + " "):
                        return tt
                    if tt in ("Copy", "Export...", "Import...", "Delete from Library"):
                        return None
                except Exception:
                    pass
    return None


def click_item(rect, dy):
    mouse.click(coords=(rect.left + 100, rect.top + dy))
    time.sleep(1.0)


def find_confirm_ok():
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    dx, dy = win_delta()
    for w in app_ui.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Button":
                    continue
                nm = el.window_text().strip()
                r = el.rectangle()
                rx, ty = r.left - dx, r.top - dy
                if nm == "OK" and 380 < rx < 560 and 550 < ty < 700:
                    return Rect(r.left, r.top, r.right, r.bottom)
            except Exception:
                pass
    return None


def delete_row(row):
    """Delete one library row via its menu; verifies popup title is an m2 name."""
    cx, cy = pt(314, (row.top + row.bottom) // 2)
    mouse.click(coords=(cx, cy))
    time.sleep(0.8)
    p = wait_popup()
    if p is None:
        return "no-popup"
    title = popup_title(p)
    if not title:
        keyboard.send_keys("{ESC}")
        time.sleep(0.4)
        return "no-title"
    click_item(p, 163)
    ok = None
    for _ in range(10):
        ok = find_confirm_ok()
        if ok:
            break
        time.sleep(0.3)
    if ok is None:
        keyboard.send_keys("{ESC}")
        time.sleep(0.4)
        return "no-confirm"
    cx, cy = ok.center()
    mouse.click(coords=(cx, cy))
    time.sleep(1.2)
    return ("deleted", title)


# ---------------------------------------------------------------------------
# Per-row OCR naming (dedupe scanning without popups)
# ---------------------------------------------------------------------------
def clean_parts(txt):
    t = txt.strip()
    t = t.replace("mufti", "multi").replace("mu/ti", "multi")
    t = re.sub(r"\s+", " ", t)
    if re.match(r"^m\s*2\s", t, re.I) or t.lower().startswith("mz "):
        t = "m2 " + re.sub(r"^m\s*[2z]\s+", "", t, flags=re.I)
    else:
        return None, None
    m = re.match(r"^m2\s+(" + FAM + r")\s+(.+)$", t)
    if m:
        return m.group(1), m.group(2).strip()
    return None, None


def ocr_row_name(image, row):
    cy = row.top - 31
    crop = image.crop((310, cy, 575, cy + 40))
    cp = os.path.join(SCRATCH, "_rw.png")
    crop.save(cp)
    r = subprocess.run(
        ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass",
         "-File", OCR2_PS1, "-ImagePath", cp],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    for ln in r.stdout.splitlines():
        m = re.match(r"^L\d+\t.+?\t.+?\t.+?\t(.*)$", ln.strip())
        if not m:
            continue
        fam, name = clean_parts(m.group(1).strip())
        if fam and name and len(name) >= 3:
            return fam, name
    return None, None


def scan_page():
    image = get_win().capture_as_image()
    out = []
    for row in visible_rows():
        fam, name = ocr_row_name(image, row)
        out.append((row, fam, name))
    return out


# ---------------------------------------------------------------------------
# Export plumbing
# ---------------------------------------------------------------------------
def find_save_filename_edit():
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    for w in app_ui.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Edit":
                    continue
                r = el.rectangle()
                if r.top < 700:
                    continue  # main-window control, not the file-browser dialog
                nm = (el.window_text() or "").strip().lower()
                if "имя файла" in nm or "filename" in nm:
                    return el, Rect(r.left, r.top, r.right, r.bottom)
            except Exception:
                pass
    return None, None


def _txt(el):
    try:
        return el.window_text() or ""
    except Exception:
        return ""


def find_save_button():
    """Return the Save (Сохранение) UIA element of the file-browser dialog.

    NOTE: the whole JUCE dialog is exposed in a virtual 1920x1040 canvas whose
    element rects do NOT map to the real screen (mouse clicks on those coords
    land nowhere).  Callers must invoke the returned element, never click it."""
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    for w in app_ui.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Button":
                    continue
                r = el.rectangle()
                if r.top < 800:
                    continue  # main-window control, not the file-browser dialog
                nm = _txt(el).strip().lower()
                if "сохран" in nm or nm == "save":
                    return el
            except Exception:
                pass
    return None


def find_cancel_button():
    app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    for w in app_ui.windows():
        for el in w.descendants():
            try:
                if el.element_info.control_type != "Button":
                    continue
                r = el.rectangle()
                if r.top < 800:
                    continue
                nm = _txt(el).strip().lower()
                if "отмен" in nm or "cancel" in nm:
                    return el
            except Exception:
                pass
    return None


def find_overwrite_modal_buttons():
    """Look for the "Подтверждение сохранения в файле..." overwrite popover and
    return its affirmative (Да/Yes) and negative (Нет/No) UIA elements, or
    (None, None).  Detection is text-based (уже существует / хотите заменить),
    so it works regardless of where the popover renders."""
    try:
        app_ui = PA(backend="uia").connect(path="H90 Control.exe")
    except Exception:
        return None, None
    for w in app_ui.windows():
        try:
            if w.window_text() == "H90 Control":
                # the popover may be nested inside the main window's tree
                pass
            words = []
        except Exception:
            continue
        els = []
        try:
            els = w.descendants()
        except Exception:
            continue
        is_confirm = False
        yes_el = no_el = None
        for el in els:
            try:
                ct = el.element_info.control_type
                if ct not in ("Text", "Button", "Static", "Window"):
                    continue
                txt = _txt(el).strip().lower()
                if not txt:
                    continue
                if ("уже существует" in txt or "хотите заменить" in txt
                        or "заменить его" in txt):
                    is_confirm = True
                    continue
                if ct == "Button":
                    if txt in ("да", "yes", "ok", "принять", "заменить",
                               "replace", "overwrite"):
                        if yes_el is None or txt.startswith("да"):
                            yes_el = el
                    elif txt in ("нет", "no", "cancel", "отмена"):
                        no_el = el
            except Exception:
                pass
        if is_confirm and yes_el is not None:
            return yes_el, no_el
    return None, None


def dismiss_save_overwrite_modal():
    """If the overwrite-confirm popover is up, INVOKE its affirmative (Да) UIA
    element.  Returns True if a popover was found and handled."""
    yes_el, no_el = find_overwrite_modal_buttons()
    if yes_el is None:
        return False
    try:
        yes_el.invoke()
        return True
    except Exception:
        pass
    try:
        mouse.click(coords=yes_el.rectangle().center())
        return True
    except Exception:
        pass
    return False


def close_save_dialog():
    """Make sure the save dialog is dismissed.  Prefers invoking the Cancel
    (Отмена) UIA element; falls back to ESC."""
    for _ in range(3):
        edit, _ = find_save_filename_edit()
        if edit is None:
            return True
        cancel = find_cancel_button()
        dismissed = False
        if cancel is not None:
            try:
                cancel.invoke()
                dismissed = True
            except Exception:
                pass
        if not dismissed:
            keyboard.send_keys("{ESC}{ENTER}")
        time.sleep(0.7)
        if find_save_filename_edit()[0] is None:
            return True
    return find_save_filename_edit()[0] is None


def export_one_popup(expected_path):
    """After the row menu Export... was clicked: set filename, invoke Save,
    WAIT for the overwrite popover to open and react to it, and return 'saved'
    once the file exists and the dialog is gone.

    The target file is NOT pre-deleted: a pre-existing file makes the JUCE
    dialog show its "уже существует / хотите заменить его?" popover, which we
    must wait for and answer before proceeding to the next preset."""
    base = os.path.basename(expected_path)[:-len(".preset90")]
    edit = None
    for _ in range(12):
        edit, edit_r = find_save_filename_edit()
        if edit is not None:
            break
        time.sleep(0.3)
    if edit is None:
        close_save_dialog()
        return "no-dialog"
    try:
        edit.set_focus()
        time.sleep(0.2)
        keyboard.send_keys("^a")
        time.sleep(0.15)
        keyboard.send_keys(literal_keys(base), with_spaces=True)
        time.sleep(0.3)
        got = (edit.get_value() or "").strip()
        if base not in got and got.endswith(")"):
            # dialog auto-renamed with a "(N)" suffix -> re-type exact name
            keyboard.send_keys("^a")
            time.sleep(0.15)
            keyboard.send_keys(literal_keys(base), with_spaces=True)
            time.sleep(0.3)
    except Exception:
        pass
    btn = None
    for _ in range(10):
        btn = find_save_button()
        if btn:
            break
        time.sleep(0.3)
    if btn is None:
        close_save_dialog()
        return "no-save-btn"
    try:
        btn.invoke()
    except Exception:
        close_save_dialog()
        return "save-invoke-fail"
    for i in range(40):
        time.sleep(0.3)
        file_ok = glob.glob(expected_path)
        # overwrite popover must be answered before anything else
        if dismiss_save_overwrite_modal():
            time.sleep(0.8)
            continue
        if not file_ok:
            continue
        time.sleep(0.5)
        if find_save_filename_edit()[0] is None:
            return "saved"
        time.sleep(0.8)
    close_save_dialog()
    if glob.glob(expected_path):
        return "saved"
    return "no-file"


def export_preset(target):
    """Export one m2 preset by name; returns status string."""
    set_search(target["name"])
    time.sleep(1.0)
    rows = visible_rows()
    if not rows:
        set_search(target["name"])
        time.sleep(1.2)
        rows = visible_rows()
    if not rows:
        return "no-rows"
    row = rows[0]
    mouse.click(coords=pt(314, (row.top + row.bottom) // 2))
    time.sleep(0.8)
    p = wait_popup()
    if p is None:
        keyboard.send_keys("{ESC}")
        time.sleep(0.4)
        return "no-popup"
    title = popup_title(p)
    if title is None or norm_name(title) != target["key"]:
        keyboard.send_keys("{ESC}")
        time.sleep(0.4)
        return "title-mismatch: %r" % title
    click_item(p, 90)
    target_path = os.path.join(LIB_DIR, target["name"] + ".preset90")
    res = export_one_popup(target_path)
    return res


def print_status(targets, done):
    rem = [t for t in targets if t["key"] not in done]
    cats = {}
    for t in rem:
        cats[t["category"]] = cats.get(t["category"], 0) + 1
    parts = ", ".join("%s %d" % (c, cats[c]) for c in STATUS_ORDER if c in cats)
    print("[status] remaining: %d types / %d effects | %s"
          % (len(cats), len(rem), parts), flush=True)


# ---------------------------------------------------------------------------
# Dedupe
# ---------------------------------------------------------------------------
def dedupe():
    targets = load_targets()
    ensure_library_view()
    get_win().set_focus()
    time.sleep(0.4)
    keyboard.send_keys("{ESC}")
    time.sleep(0.4)
    set_search("m2 ")
    time.sleep(1.5)

    deleted_total = 0
    for t in targets:
        set_search(t["name"])
        rows = visible_rows()
        if not rows:
            print("[dedupe] %s : NO ROWS" % t["name"], flush=True)
            continue
        for _ in range(6):
            if len(rows) <= 1:
                break
            row = rows[1]
            res = delete_row(row)
            if isinstance(res, tuple) and res[0] == "deleted":
                deleted_total += 1
                print("[dedupe] deleted %s (total %d)" % (res[1], deleted_total),
                      flush=True)
            else:
                print("[dedupe] %s delete failed: %s" % (t["name"], res),
                      flush=True)
                break
            rows = visible_rows()
        else:
            print("[dedupe] %s still has >1 rows after retries" % t["name"],
                  flush=True)

    print("=== dedupe done: total deleted = %d ===" % deleted_total, flush=True)
    return deleted_total


# ---------------------------------------------------------------------------
# Export
# ---------------------------------------------------------------------------
def export():
    targets = load_targets()
    ensure_library_view()
    get_win().set_focus()
    time.sleep(0.4)
    keyboard.send_keys("{ESC}")
    time.sleep(0.4)
    set_search("m2 ")
    time.sleep(1.5)

    for f in glob.glob(os.path.join(LIB_DIR, "m2*.preset90")):
        try:
            os.remove(f)
        except OSError:
            pass

    done = set()
    exported = 0
    failed = []
    for t in targets:
        res = export_preset(t)
        if res == "saved":
            done.add(t["key"])
            exported += 1
            print("[%s] EXPORTED (%s)" % (t["name"], t["category"]), flush=True)
        else:
            failed.append((t["name"], res))
            print("[%s] FAILED: %s" % (t["name"], res), flush=True)
        print_status(targets, done)
        time.sleep(0.4)

    print("\n=== results ===")
    print("exported:", exported)
    print("failed: %d" % len(failed))
    for t, r in failed:
        print("  %s : %s" % (t, r))
    missing = [t["name"] for t in targets if t["key"] not in done]
    print("missing (%d):" % len(missing))
    for m in missing:
        print("  " + m)


if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "all"
    if mode in ("all", "dedupe"):
        dedupe()
    if mode in ("all", "export"):
        export()