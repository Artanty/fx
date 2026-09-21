"""H90 Control UI Automation driver.

Attaches to the running native "H90 Control" JUCE app and drives its parameter
knobs via Windows UI Automation (pywinauto). No web UI involved.

Commands:
  --list                    dump every parameter row (label -> current value)
  --top N                   tree-dump only the first N controls (debug)
  --tree                    full control tree dump (debug)
  --get LABEL               print the current value of one knob
  --set LABEL VALUE         change a knob to VALUE (drag-calibrated, like UIA)
"""

import argparse
import json
import math
import os
import re
import sys
import time

from pywinauto import Application
from pywinauto.controls.uiawrapper import UIAWrapper
from pywinauto import timings
from pywinauto import mouse

import comtypes
from comtypes import COMError
from comtypes.gen import UIAutomationClient as uiac

import h90_app

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
KNOB_MAP_DEFAULT = os.path.join(BASE_DIR, "knob-map.json")
SNAPSHOT_DIR_DEFAULT = os.path.join(BASE_DIR, "snapshots")

NUMERIC_RE = re.compile(r"^\s*[-+]?\d+(?:[,.]\d+)?\s*$")
UNIT_TEXT_RE = re.compile(r"([-+]?\d+(?:[,.]\d+)?)\s*([A-Za-zµ/°]+)?$")


def connect():
    return h90_app.connect()


WIN_TITLE = h90_app.running_title() or "Eventide Control"


def get_window(app):
    wins = [w for w in app.windows() if h90_app.is_main_title(w.window_text())] or app.windows()
    return wins[0]


def walk(ctrl, depth=0, out=None, max_depth=12):
    if out is None:
        out = []
    if depth > max_depth:
        return out
    try:
        children = ctrl.children()
    except Exception:
        children = []
    for ch in children:
        try:
            ctype = ch.element_info.control_type
        except Exception:
            ctype = ""
        try:
            name = ch.window_text()
        except Exception:
            name = ""
        try:
            av = ch.get_value()
        except Exception:
            av = ""
        out.append((depth, ctype, name, av, ch))
        walk(ch, depth + 1, out, max_depth)
    return out


def is_readable(av):
    return bool(av) and av != "Not set" and "IS NOT" not in av


def collect_params(win, xmin=536, xmax=10000):
    """Return rows of (label_text, value_text, slider_elem) — group each Edit
    readout with the nearest Text label by (column,row) as before. Parameters
    bound the scan region (default x>=536 = the right/bank columns; Slot A
    knobs live in x 289..656, pass xmin=280, xmax=655 to capture them)."""
    rows = []
    try:
        all_ctrls = walk(win, max_depth=14)
    except Exception as ex:
        print("walk error: %s" % ex)
        return rows

    labels = []  # (x, y, text)
    edits = []   # (x, y, value_text)
    sliders = []  # (x, y, elem)
    for depth, ctype, name, av, ch in all_ctrls:
        if not ctype:
            continue
        try:
            r = ch.rectangle()
            x, y = int(r.left), int(r.top)
        except Exception:
            continue
        if x < xmin or x > xmax or y < 200:
            continue
        if ctype == "Text":
            t = name.strip()
            if t and not t.startswith("IS NOT"):
                labels.append((x, y, t, ch))
        elif ctype == "Edit":
            edits.append((x, y, av, ch))
        elif ctype == "Slider":
            sliders.append((x, y, ch))
        elif ctype == "Spinner":
            edits.append((x, y, av, ch))
        elif ctype == "ComboBox":
            # some knob readouts are read-only ComboBox-edits (value in name)
            t = (name or "").strip()
            if t and t not in ("Global",):
                edits.append((x, y, t, ch))

    def nearest_label(x, y):
        best, bd = None, 1e9
        for lx, ly, t, el in labels:
            d = abs(lx - x) + abs(ly - y) * 3
            if d < bd:
                best, bd = (t, el, lx, ly), d
        return best

    used = set()
    for ex, ey, val, el in edits:
        if not available_value(val, el):
            continue
        match = nearest_label(ex, ey)
        if not match:
            continue
        t, lel, lx, ly = match
        key = (lx, ly)
        if key in used:
            continue
        used.add(key)
        rows.append({"label": t, "value": val, "edit": el, "label_elem": lel,
                     "lx": lx, "ly": ly, "ex": ex, "ey": ey,
                     "slider": nearest_slider(sliders, ex, ey)})
    rows.sort(key=lambda r: (r["ly"], r["lx"]))
    return rows


def available_value(av, el):
    if not is_readable(av):
        return False
    return True


def nearest_slider(sliders, x, y):
    best, bd = None, 1e9
    for sx, sy, el in sliders:
        d = (sx - x) ** 2 + (sy - y) ** 2
        if d < bd:
            best, bd = el, d
    return best


def list_params(win):
    rows = collect_params(win)
    if not rows:
        print("(no parameter rows found)")
        return
    for r in rows:
        print("PARAM: %-28s = %s   (label@%d,%d edit@%d,%d%s)"
              % (r["label"], r["value"], r["lx"], r["ly"], r["ex"], r["ey"],
                 " slider" if r["slider"] is not None else ""))


def find_row(win, label):
    rows = collect_params(win)
    for r in rows:
        if label.lower() in r["label"].lower():
            return r
    return None


def slider_rangevalue(slider):
    """Return the Slider's RangeValue (normalized 0..1) via COM pattern, or None."""
    try:
        el = slider.element_info.element
        p = el.GetCurrentPattern(uiac.UIA_RangeValuePatternId)
        rv = p.QueryInterface(uiac.IUIAutomationRangeValuePattern)
        return rv.CurrentValue
    except Exception:
        return None


def slider_set_rangevalue(slider, value, max_retries=5, tol=0.01):
    """Set the Slider's RangeValue (0..1), endpoint-clamped, retrying until the
    readback settles within tol (JUCE applies live + the readout may quantize)."""
    value = max(0.0, min(1.0, value))
    for i in range(max_retries):
        try:
            el = slider.element_info.element
            p = el.GetCurrentPattern(uiac.UIA_RangeValuePatternId)
            rv = p.QueryInterface(uiac.IUIAutomationRangeValuePattern)
            rv.SetValue(value)
        except Exception as ex:
            print("  set err: %s" % ex)
            return False
        time.sleep(0.4)
        cur = slider_rangevalue(slider)
        if cur is not None and abs(cur - value) <= tol:
            return True
    return False


def parse_value(txt):
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", txt)
    return float(m.group()) if m else None


def set_param(win, label, target):
    r = find_row(win, label)
    if not r:
        print("NOT FOUND: %s" % label)
        return False
    if r["slider"] is None:
        print("%s has no slider (non-continuous knob)" % r["label"])
        return False

    def readout():
        try:
            return r["edit"].get_value()
        except Exception:
            return r["edit"].window_text()

    cur_rv = slider_rangevalue(r["slider"])
    cur_parsed = parse_value(readout())
    print("  %s: readout=%r readback_rv=%.4f" % (r["label"], readout(), cur_rv))
    if cur_rv is None:
        print("  no RangeValue on slider - cannot SET via UIA")
        return False
    if cur_parsed is None:
        print("  readout not numeric (%r) - cannot calibrate" % readout())
        return False
    # Calibrate the RV(0..1) <-> readout mapping with two probes (JUCE applies
    # live; the readout is the ground truth). Then restore and set the target.
    lo = hi = None
    for tag, probe in (("max", 1.0), ("min", 0.0)):
        slider_set_rangevalue(r["slider"], probe)
        time.sleep(0.5)
        pv = parse_value(readout())
        print("  probe %s: rv=%.4f readout=%r -> parsed=%s"
              % (tag, probe, readout(), pv))
        if pv is not None:
            if tag == "max":
                hi = pv
            else:
                lo = pv
    slider_set_rangevalue(r["slider"], cur_rv)
    time.sleep(0.5)
    print("  restored to rv=%.4f readout=%r" % (cur_rv, readout()))
    if lo is None or hi is None or hi <= lo:
        print("  could not calibrate range (lo=%s hi=%s)" % (lo, hi))
        return False
    # The RV(0..1) maps to the readout through a JUCE skew curve, so iterate:
    # bisect on rv until the live readout lands on the target value.
    if target < lo or target > hi:
        print("  target %s outside knob range [%s..%s]" % (target, lo, hi))
        return False
    rv_lo, rv_hi = 0.0, 1.0
    cur = None
    for it in range(24):
        mid = (rv_lo + rv_hi) / 2.0
        slider_set_rangevalue(r["slider"], mid)
        time.sleep(0.35)
        cur = parse_value(readout())
        if cur is None:
            print("  lost readout at iter %d" % it)
            break
        if abs(cur - target) <= 0.5:
            break
        if cur < target:
            rv_lo = mid
        else:
            rv_hi = mid
    ok = cur is not None and abs(cur - target) <= 0.5
    print("  SET %s -> %s (rv=%.4f over [%s..%s]) readout=%r readback_rv=%.4f ok=%s"
          % (r["label"], target, slider_rangevalue(r["slider"]), lo, hi,
             readout(), slider_rangevalue(r["slider"]), ok))
    return ok


# ---------------------------------------------------------------------------
# Knob discovery -> persisted knob map for fast future sets
# ---------------------------------------------------------------------------

def readout_text(row):
    try:
        return row["edit"].get_value()
    except Exception:
        try:
            return row["edit"].window_text()
        except Exception:
            return ""


def set_rangevalue_fast(slider, value):
    value = max(0.0, min(1.0, value))
    try:
        el = slider.element_info.element
        p = el.GetCurrentPattern(uiac.UIA_RangeValuePatternId)
        rv = p.QueryInterface(uiac.IUIAutomationRangeValuePattern)
        rv.SetValue(value)
        return True
    except Exception as ex:
        print("  set err: %s" % ex)
        return False


def probe_readout(row, rv, settle=0.45):
    """Set a knob to a raw RangeValue and read the live on-screen readout."""
    set_rangevalue_fast(row["slider"], rv)
    time.sleep(settle)
    return readout_text(row)


def classify_value(text):
    t = (text or "").strip()
    if not t:
        return "empty", None
    if NUMERIC_RE.match(t):
        return "numeric", None
    m = UNIT_TEXT_RE.match(t)
    if m and (m.group(2) or "").strip():
        return "numeric", m.group(2).strip()
    return "enum", None


def col_bucket(x, y):
    """Screen-level grouping of the H90 app's two program blocks + bottom mixer."""
    if y >= 1500:
        return "global"
    return "A" if x < 1150 else "B"


def drag_knob(win, label, dy, hold=0.35):
    """Performs a REAL mouse drag on a knob's dial (absolute screen pixels, dy
    >0 = drag down = value down for these rotaries). This drives JUCE through its
    user-interaction path, so the app actually transmits knob moves to the pedal
    (RangeValue.SetValue does NOT). Returns the readout before/after."""
    r = find_row(win, label)
    if not r or r["slider"] is None:
        print("NOT FOUND (or no slider): %s" % label)
        return
    rect = r["slider"].rectangle()
    cx, cy = int((rect.left + rect.right) / 2), int((rect.top + rect.bottom) / 2)
    before = readout_text(r)
    mouse.move(coords=(cx, cy))
    mouse.press(button="left", coords=(cx, cy))
    time.sleep(0.2)
    step = 6 if dy >= 0 else -6
    steps = int(abs(dy) / 6) or 1
    for i in range(1, steps + 1):
        mouse.move(coords=(cx, cy + step * i))
        time.sleep(max(0.01, hold / steps))
    time.sleep(0.1)
    mouse.release(button="left", coords=(cx, cy + step * steps))
    time.sleep(0.4)
    after = readout_text(r)
    print("DRAG %s (dial center %d,%d dy=%+d): readout %r -> %r"
          % (r["label"], cx, cy, dy, before, after))


def calibrate_slider(row):
    """Swing a knob through rv=1/0/0.5, read lo/hi/mid readouts, restore, and fit
    the JUCE skew exponent k (value ~ lo + (hi-lo)*rv^k). Returns dict or None."""
    slider = row["slider"]
    if slider is None:
        return None
    rv0 = slider_rangevalue(slider)
    if rv0 is None:
        return None
    v_hi = parse_value(probe_readout(row, 1.0))
    v_lo = parse_value(probe_readout(row, 0.0))
    v_mid = parse_value(probe_readout(row, 0.5))
    v_cur = parse_value(probe_readout(row, rv0))
    if v_hi is None or v_lo is None or v_hi <= v_lo:
        return None
    k = 1.0
    if v_mid is not None:
        rat = (v_mid - v_lo) / (v_hi - v_lo)
        if 0 < rat < 0.9999:
            k = math.log(rat) / math.log(0.5)
            if not (0.3 <= k <= 8.0):
                k = 1.0
    return {"lo": v_lo, "hi": v_hi, "mid": v_mid, "k": k, "rv0": rv0, "cur": v_cur}


def collect_extra_controls(win):
    """Capture non-slider UI controls (ComboBox/Button) for the knob map."""
    out = []
    try:
        ctrls = walk(win, max_depth=14)
    except Exception:
        return out
    for depth, ctype, name, av, ch in ctrls:
        if ctype not in ("ComboBox", "Button", "ToggleButton"):
            continue
        try:
            r = ch.rectangle()
            x, y = int(r.left), int(r.top)
        except Exception:
            continue
        if x < 536 or y < 200:
            continue
        text = (name or "").strip() or (av or "").strip()
        if not text:
            continue
        out.append({"ctype": ctype, "name": text,
                    "ex": x, "ey": y,
                    "bucket": col_bucket(x, y)})
    return out


def discover(win, out_path, snapdir):
    rows = collect_params(win)
    preset = None
    knobs = []
    for r in rows:
        if r["ly"] < 400 or r["label"] == "04":
            if preset is None:
                preset = r["value"]
            continue
        ex, ey, lx, ly = r["ex"], r["ey"], r["lx"], r["ly"]
        bucket = col_bucket(ex, ey)
        vtype, unit = classify_value(r["value"])
        entry = {
            "key": "%s | %s | %d,%d" % (r["label"], bucket, ex, ey),
            "label": r["label"],
            "bucket": bucket,
            "value": r["value"],
            "vtype": vtype,
            "unit": unit,
            "has_slider": r["slider"] is not None,
            "ex": ex, "ey": ey, "lx": lx, "ly": ly,
            "lo": None, "hi": None, "k": None, "rv": None, "settable": False,
        }
        if r["slider"] is not None:
            cur_rv = slider_rangevalue(r["slider"])
            entry["rv"] = cur_rv
            if vtype != "enum":
                cal = calibrate_slider(r)
                if cal:
                    entry.update(lo=cal["lo"], hi=cal["hi"], k=cal["k"],
                                 settable=True, rv=cal["rv0"])
        knobs.append(entry)

    controls = collect_extra_controls(win)

    doc = {
        "kind": "h90-knob-map",
        "source": "H90 Control app (UIA)",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "preset": preset or "?",
        "layout": {"col_break_x": 1150, "row_break_y": 1500},
        "knobs": knobs,
        "controls": controls,
    }

    os.makedirs(snapdir, exist_ok=True)
    snap_path = os.path.join(
        snapdir, "band-delay-%s.json" % time.strftime("%Y%m%d-%H%M%S"))
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
    with open(snap_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)

    print("DISCOVER preset=%r knobs=%d controls=%d" % (preset, len(knobs), len(controls)))
    for e in knobs:
        tag = "SETTABLE" if e["settable"] else ("enum" if e["vtype"] == "enum" else "readme")
        print("  [%s] %-6s %-28s = %-12r rv=%-8s lo=%-5s hi=%-5s k=%s"
              % (e["bucket"], tag, e["key"], e["value"],
                 e["rv"], e["lo"], e["hi"], e["k"]))
    for c in controls:
        print("  [%s] ctrl   %-24s = %r" % (c["bucket"], c["ctype"] + " " + c["name"], c["ex"]))
    print("saved knob map:      %s" % out_path)
    print("saved snapshot:      %s" % snap_path)
    return doc


def load_map(path=KNOB_MAP_DEFAULT):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return None


def find_map_entry(entries, label):
    """Return (entry, all_matching_entries). Plain label may be ambiguous (e.g.
    duplicate HotKnob labels); disambiguate with the "label | bucket | x,y" key."""
    needle = label.strip().lower()
    exact = [e for e in entries if e["label"].lower() == needle and e.get("settable")]
    hits = [e for e in entries if needle in e["key"].lower() and e.get("settable")]
    pool = exact or hits
    if not pool:
        return None, []
    return pool[0], pool


def set_knob_fast(win, entry, target):
    """One-shot SetValue using a calibrated knob-map entry. Returns (ok, msg)."""
    rows = collect_params(win)
    row = None
    for r in rows:
        if abs(r["ex"] - entry["ex"]) <= 3 and abs(r["ey"] - entry["ey"]) <= 3:
            row = r
            break
    if row is None:
        return False, "could not re-locate %s by coords" % entry["key"]
    if row["slider"] is None:
        return False, "%s lost its slider" % entry["key"]
    lo, hi, k = entry["lo"], entry["hi"], entry.get("k", 1.0)
    if hi is None or hi <= lo:
        return False, "%s has no calibration (lo=%s hi=%s)" % (entry["key"], lo, hi)
    if not (lo <= target <= hi):
        return False, "target %s outside [%s..%s]" % (target, lo, hi)
    rat = (target - lo) / (hi - lo)
    rv = rat ** (1.0 / k) if k > 0 else rat
    rv = max(0.0, min(1.0, rv))
    set_rangevalue_fast(row["slider"], rv)
    time.sleep(0.5)
    cur = parse_value(readout_text(row))
    ok = cur is not None and abs(cur - target) <= 0.5
    return ok, "%s -> %s (rv=%.4f over [%s..%s] k=%.3f) readout=%r" \
        % (entry["key"], target, rv, lo, hi, k, readout_text(row))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--get", default=None)
    ap.add_argument("--set", nargs=2, default=None, metavar=("LABEL", "VALUE"))
    ap.add_argument("--discover", action="store_true")
    ap.add_argument("--drag", nargs=2, default=None,
                    metavar=("LABEL", "DY"), help="real mouse-drag a knob by DY px")
    ap.add_argument("--out", default=KNOB_MAP_DEFAULT)
    ap.add_argument("--snapdir", default=SNAPSHOT_DIR_DEFAULT)
    ap.add_argument("--map", default=KNOB_MAP_DEFAULT,
                    help="knob-map JSON used by --set (default: knob-map.json)")
    ap.add_argument("--tree", action="store_true")
    ap.add_argument("--top", type=int, default=0)
    args = ap.parse_args()

    app = connect()
    win = get_window(app)
    print("window: %r" % win)

    if args.discover:
        discover(win, args.out, args.snapdir)
    elif args.drag:
        drag_knob(win, args.drag[0], int(args.drag[1]))
    elif args.list:
        list_params(win)
    elif args.get:
        r = find_row(win, args.get)
        if not r:
            print("NOT FOUND: %s" % args.get)
            sys.exit(1)
        print("%s = %s" % (r["label"], r["value"]))
    elif args.set:
        label, value = args.set
        target = float(value)
        entries = (load_map(args.map) or {}).get("knobs", []) or []
        entry, pool = find_map_entry(entries, label)
        if entry:
            if len(pool) > 1:
                print("  (ambiguous label; candidates: %s)" %
                      ", ".join(e["key"] for e in pool))
                print("  using %s" % entry["key"])
            ok, msg = set_knob_fast(win, entry, target)
            print(msg)
            if ok:
                return
            print("  fast set failed -> falling back to bisection")
        else:
            print("  (no calibrated map entry for %r; falling back to bisection)"
                  % label)
        set_param(win, label, target)
    elif args.top:
        allc = walk(win, max_depth=14)
        for depth, ctype, name, av, ch in allc[:args.top]:
            print("  " * depth + "%s %r value=%r" % (ctype, name, av))
    elif args.tree:
        for depth, ctype, name, av, ch in walk(win, max_depth=14):
            print("  " * depth + "%s %r value=%r" % (ctype, name, av))
    else:
        ap.print_help()


if __name__ == "__main__":
    main()