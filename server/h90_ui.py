#!/usr/bin/env python3
"""H90 Control app: parse the current screen and read/change parameters via UI Automation.

Windows-only. Uses pywinauto (UIA backend) to read the JUCE H90 Control app's
widget tree -- no image/OCR needed, because the app exposes accessibility nodes.

The editor exposes each parameter knob as three co-located widgets per column:
  Slider (the rotary knob), Edit (the current-value readout), Text (the label).

Usage (CLI):
  python h90_ui.py --list             scan + list all current parameter values
  python h90_ui.py --get "Mix"        read one parameter by label
  python h90_ui.py --set "Mix" 50     set a parameter (drag its knob toward value)
  python h90_ui.py --set "Mix" 50 --raw    set using raw drag tokens (see code)

Notes:
  * Parameters live in one or more "Algorithm Parameters" groups (the H90 is a
    dual-algorithm pedal, so there can be two pages).
  * Only parameters whose label/readout/slider are currently visible on screen
    can be read/set. Scroll or switch tabs first if needed.
"""

import re
import sys
import time
import argparse

import pyautogui
from pywinauto import Desktop

WIN_TITLE = "H90 Control"


def _get_window(backend="uia"):
    win = Desktop(backend=backend).window(title_re=WIN_TITLE)
    try:
        win.set_focus()
    except Exception:
        pass
    return win


def _iter(el, max_depth=12):
    """Yield depth-first (element)."""
    def _walk(node, depth):
        if depth > max_depth:
            return
        yield node
        try:
            kids = node.children()
        except Exception:
            return
        for k in kids:
            yield from _walk(k, depth + 1)
    yield from _walk(el, 0)


def _meta(el):
    try:
        name = el.element_info.name or ""
        ctrl = el.element_info.control_type or "?"
    except Exception:
        name, ctrl = "", "?"
    rect = None
    try:
        rect = el.rectangle()
    except Exception:
        pass
    return ctrl, name, rect


def scan_params():
    """Return list of param dicts: {label, value, slider_rect, label_rect}."""
    win = _get_window()
    widgets = []
    for el in _iter(win):
        ctrl, name, rect = _meta(el)
        if rect is None:
            continue
        if ctrl == "Slider":
            widgets.append(("slider", name, rect))
        elif ctrl == "Edit":
            widgets.append(("value", name, rect))
        elif ctrl == "Text":
            widgets.append(("label", name, rect))

    # Pair labels with the value readout and slider of the same column.
    # Heuristic: group by column (x-center) then row (y).
    def cx(r):
        return (r.left + r.right) / 2.0

    def cy(r):
        return (r.top + r.bottom) / 2.0

    labels = [w for w in widgets if w[0] == "label" and w[1].strip()]
    values = [w for w in widgets if w[0] == "value"]
    sliders = [w for w in widgets if w[0] == "slider"]

    params = []
    used_values = set()
    used_labels = set()
    # Match a label to the value readout directly beneath it (same x, close y),
    # and to the nearest slider for that column. Each value readout is consumed
    # by exactly one label (greedy nearest) to avoid cross-group theft.
    for i, (_, lname, lrect) in enumerate(labels):
        if i in used_labels:
            continue
        lcx, lcy = cx(lrect), cy(lrect)
        # nearest unused value readout in same column band
        best_v = None
        for vi, (_, vname, vrect) in enumerate(values):
            if vi in used_values:
                continue
            if abs(cx(vrect) - lcx) < 45 and abs(cy(vrect) - lcy) < 48:
                gap = abs(cy(vrect) - lcy)
                if best_v is None or gap < best_v[0]:
                    best_v = (gap, vi, vname, vrect)
        val = ""
        if best_v is not None:
            val = best_v[2].strip()
            used_values.add(best_v[1])
        # nearest slider in same column
        best_s = None
        for _, _, srect in sliders:
            if abs(cx(srect) - lcx) < 45:
                if best_s is None or abs(cx(srect) - lcx) < abs(cx(best_s) - lcx):
                    best_s = srect
        params.append({
            "label": lname.strip(),
            "value": val,
            "label_rect": lrect,
            "value_rect": best_v[3] if best_v else None,
            "slider_rect": best_s,
        })
    return params


def read_all():
    out = []
    for p in scan_params():
        out.append((p["label"], p["value"]))
    return out


def get(label):
    for p in scan_params():
        if p["label"].lower() == label.lower():
            return p
    return None


def _drag_by(rect, dpx, dur=0.3):
    """Grab knob center and drag vertically by dpx (negative = up)."""
    sx = (rect.left + rect.right) / 2.0
    sy = (rect.top + rect.bottom) / 2.0
    pyautogui.moveTo(sx, sy, duration=0.12)
    time.sleep(0.04)
    pyautogui.mouseDown(button="left")
    time.sleep(0.04)
    pyautogui.moveTo(sx, sy + dpx, duration=dur)
    time.sleep(0.08)
    pyautogui.mouseUp(button="left")


def _num(v):
    """Extract the leading number from a value string; None if none."""
    m = re.match(r"\s*([+-]?\d+(?:\.\d+)?)", v or "")
    return float(m.group(1)) if m else None


def _value_of(p):
    try:
        return p["value"]
    except Exception:
        return ""


def read_value(label):
    p = get(label)
    return _value_of(p) if p else None


def set_param(label, target_value, tolerance=0.05, max_iters=10):
    """Set a knob to a numeric target by calibrated vertical drag.

    The knob's pixels-per-unit is learned on the fly: a 20px reference nudge is
    applied and the resulting readout delta measured, then the correct drag is
    computed and iterated until the readout lands within tolerance.
    """
    ref = get(label)
    if ref is None or ref["slider_rect"] is None:
        raise ValueError(f"parameter not found/visible: {label!r}")
    rect = ref["slider_rect"]
    tgt = _num(target_value)
    if tgt is None:
        raise ValueError(f"cannot interpret target value {target_value!r}")

    before = _num(_value_of(get(label)))
    if before is None:
        raise ValueError(f"cannot read current value for {label!r}")

    # calibration: how many px per value-unit does a vertical drag move it?
    _drag_by(rect, -20)  # 20px up
    time.sleep(0.2)
    after = _num(_value_of(get(label)))
    measured = (after - before) if after is not None else 0.0
    if abs(measured) < 1e-9:
        measured = 0.0
    px_per_unit = -20.0 / measured if measured != 0.0 else float("inf")

    # target drag in px
    need = tgt - after
    if px_per_unit == float("inf"):
        return _value_of(get(label))
    drag = need * px_per_unit

    last = _value_of(get(label))
    for _ in range(max_iters):
        cur = _num(last)
        if cur is None:
            break
        need = tgt - cur
        if abs(need) <= tolerance:
            break
        drag = need * px_per_unit
        drag = max(-400.0, min(400.0, drag))
        _drag_by(rect, drag)
        time.sleep(0.2)
        last = _value_of(get(label))
    return last


def _clean_value(v):
    v = (v or "").strip()
    m = re.match(r"(-?\d+(?:\.\d+)?)\s*(%|dB)?", v)
    return v


def _to_frac(v):
    """Interpret a value string / number as a 0..1 fraction.

    Handles '%', 'dB', bare numbers, and ratio/format strings. Returns None if
    it can't be interpreted.
    """
    v = (v or "").strip()
    if not v:
        return None
    m = re.match(r"([+-]?\d+(?:\.\d+)?)\s*(%)?$", v)
    if m:
        n = float(m.group(1))
        if m.group(2):  # percent
            return max(0.0, min(1.0, n / 100.0))
        return n  # assume 0..1 raw fraction
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list all visible params")
    ap.add_argument("--get", metavar="LABEL", help="read one param by label")
    ap.add_argument("--set", nargs=2, metavar=("LABEL", "VALUE"), help="set a param")
    args = ap.parse_args()

    if args.list or (not args.get and not args.set):
        for label, val in read_all():
            print(f"{label:28} = {val}")
    elif args.get:
        p = get(args.get)
        print(p["value"] if p else "NOT FOUND/visible")
    elif args.set:
        res = set_param(args.set[0], args.set[1])
        print(f"set {args.set[0]!r} -> {res}")


if __name__ == "__main__":
    main()
