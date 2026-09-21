"""Calibrate every knob value of a single effect to the DB.

For each knob in a midi_cc_states/<slug>-<bank>.json assignment:

  numeric knobs: read the app readout (human title) at the rangeValue ends,
                 calibrate lo/hi/k, and emit one knob_values row per natural
                 step of the knob (cc = the MIDI CC byte that lands on it).
  enum knobs:    sweep rangeValue 0..1 finely and record each distinct title
                 + the RV it first appears at -> CC trigger = round(127*rv).

The app (Eventide Control, connected to the pedal) is the single source of
truth for the live readouts. Since the app exclusively owns the pedal's MIDI
while connected, the CC byte that triggers a value is computed from the same
RV-to-option quantization the app itself uses (uniform N-way division, which
the H90 firmware mirrors from CC 0 -> Start .. CC 127 -> End).

Usage:
  python build_knob_values.py <slug>-<bank>.json   (file inside midi_cc_states/)

Writes:
  knob_values/<slug>-<bank>.json                     capture
  midi_cc_map.db  tables knob_info + knob_values    additive (no drops)
"""

import argparse
import json
import math
import os
import re
import sqlite3

GENERAL_BLOCK = {
    "In Gain", "Out Gain", "Bypass", "Tails", "Tempo Mode",
    "HotKnob", "Kill Dry",
}
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import uia_driver
import h90_app
import assign_cc

BASE = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(BASE, "midi_cc_states")
OUT_DIR = os.path.join(BASE, "knob_values")
DB_PATH = os.path.join(BASE, "midi_cc_map.db")

ENUM_SWEEP_STEP = 0.02
ENUM_SETTLE = 0.16
ROW_FORMAT = "{title!:<24} {band:>40}"


def classify_unit(text):
    _, unit = uia_driver.classify_value(text)
    return unit


def title_number(text):
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", text or "")
    return float(m.group().replace(",", ".")) if m else None


def fmt_num(v, unit=""):
    if v is None:
        return ""
    if unit:
        return ("%g %s" % (v, unit)).strip()
    if float(v).is_integer():
        return str(int(v))
    return "%g" % v


def readout(row):
    return (uia_driver.readout_text(row) or "").strip()


CURR_WIN = [None]


def _refresh_row_slider(row):
    w = CURR_WIN[0]
    if w is None:
        return None
    try:
        rows = uia_driver.collect_params(w)
    except Exception:
        return None
    label = row["label"].strip()
    for r in rows:
        if r["label"].strip() == label and r["slider"] is not None:
            row.update(r)
            return row["slider"]
    return None


def set_rv(row, rv, settle=0.35):
    """Move the knob slider to rv (0..1), clearing the readout afterwards.
    rv may be None (stale read); falls back to 0.0.  If a SetValue fails the
    UIA element is usually stale after an app re-render, so refresh the row's
    elements and retry a few times."""
    target = 0.0 if rv is None else max(0.0, min(1.0, rv))
    for _ in range(3):
        if uia_driver.set_rangevalue_fast(row["slider"], target):
            break
        time.sleep(0.25)
        if _refresh_row_slider(row) is None:
            break
    time.sleep(settle)
    return readout(row)


def connect_state(win):
    """Return True when the app shows param rows (i.e. is connected + a program)."""
    rows = uia_driver.collect_params(win)
    return bool(rows)


def _read_cur_rv(row):
    cur = uia_driver.slider_rangevalue(row["slider"])
    for _ in range(3):
        if cur is not None:
            return cur
        time.sleep(0.25)
        if _refresh_row_slider(row) is None:
            break
        cur = uia_driver.slider_rangevalue(row["slider"])
    return cur


def calibrate_numeric(row, unit):
    """lo/hi/k via uia_driver; titles + parsed numbers at rv=0 and rv=1.
    Handles inverted knobs (rv=1 -> LOW value, e.g. Threshold, Release)."""
    cur_rv = _read_cur_rv(row)
    if cur_rv is None:
        return None
    t0, t1 = set_rv(row, 0.0, 0.5), set_rv(row, 1.0, 0.5)
    v0, v1 = parse_num_echo(t0), parse_num_echo(t1)
    vmid = parse_num_echo(set_rv(row, 0.5, 0.4))
    set_rv(row, cur_rv, 0.4)
    if v0 is None or v1 is None:
        return None
    inverted = v0 > v1
    lo, hi = (v1, v0) if inverted else (v0, v1)
    if hi <= lo:
        return None
    k = 1.0
    if vmid is not None and lo < vmid < hi:
        rat = (vmid - lo) / (hi - lo)
        if 0 < rat < 0.9999:
            k = math.log(rat) / math.log(0.5)
            if not (0.3 <= k <= 8.0):
                k = 1.0
    lo_title, hi_title = fmt_num(lo, unit), fmt_num(hi, unit)
    return {"lo": lo, "hi": hi, "k": k, "inverted": int(inverted),
            "lo_title": lo_title, "hi_title": hi_title, "rv0": cur_rv}


def parse_num_echo(text):
    return title_number(text)


def enum_sweep(row, settle=ENUM_SETTLE):
    """Record (rv_first, title) transitions sweeping 0..1. Returns ordered list
    of {title, rv} with rv = first position that produced the title."""
    cur_rv = _read_cur_rv(row)
    seq = []
    last = None
    for i in range(int(1.0 / ENUM_SWEEP_STEP) + 1):
        rv = min(1.0, i * ENUM_SWEEP_STEP)
        t = set_rv(row, rv, settle)
        if t != last:
            seq.append((rv, t))
            last = t
    set_rv(row, cur_rv, 0.35)
    options = []
    seen = set()
    for rv, t in seq:
        if t in seen:
            continue
        seen.add(t)
        options.append({"title": t, "rv": rv})
    return options, cur_rv


def knob_tuple(row):
    r = row["edit"].element_info.rectangle
    return (row["label"], r.left, r.top, r.width(), r.height())


# ---------------------------------------------------------------------------
# External Mapping modal Start/End sliders (full-range enforcement)
# ---------------------------------------------------------------------------

def slider_rv(el):
    try:
        from comtypes.gen import UIAutomationClient as uia
        e = el.element_info.element
        ptr = e.GetCurrentPattern(uia.UIA_RangeValuePatternId)
        rvp = ptr.QueryInterface(uia.IUIAutomationRangeValuePattern)
        return rvp.CurrentValue
    except Exception:
        return None


def set_slider_rv(el, target, max_retries=5, tol=0.01):
    try:
        from comtypes.gen import UIAutomationClient as uia
        e = el.element_info.element
        ptr = e.GetCurrentPattern(uia.UIA_RangeValuePatternId)
        rvp = ptr.QueryInterface(uia.IUIAutomationRangeValuePattern)
    except Exception:
        return False
    for i in range(max_retries):
        try:
            rvp.SetValue(max(0.0, min(1.0, target)))
        except Exception:
            return False
        time.sleep(0.35)
        cur = slider_rv(el)
        if cur is not None and abs(cur - target) <= tol:
            return True
    return False


def popup_range_sliders(pop):
    """Return (start_el, end_el), anchoring each Slider to the 'Start'/'End'
    Static label right above it. Fresh-scans the tree each call so elements
    from the CC#-slider sub-popup cannot go stale."""
    labels = {}
    sliders = []
    try:
        for el in pop.descendants():
            try:
                cls = el.friendly_class_name()
                txt = (el.window_text() or "").strip()
                r = el.rectangle()
                if cls == "Static" and txt in ("Start", "End"):
                    labels[txt.lower()] = r.top
                elif cls == "Slider":
                    sliders.append((r.top, el))
            except Exception:
                pass
    except Exception:
        return None
    out = {}
    for name, ltop in labels.items():
        best, bd = None, 1e9
        for stop, el in sliders:
            d = abs(stop - ltop)
            if d < bd and stop >= ltop - 2:
                best, bd = (el, stop), d
        if best:
            out[name] = best[0]
    return out.get("start"), out.get("end")


def get_range_state(pop):
    pair = popup_range_sliders(pop)
    if pair is None:
        return None
    s, e = pair
    srv = slider_rv(s)
    erv = slider_rv(e)
    if srv is None or erv is None:
        return None
    return {"start_before": round(srv, 3), "end_before": round(erv, 3)}


def force_full_range(pop, state):
    """Set End=1.0 (and Start=0.0 if needed) given a BEFORE-read state taken
    in the same fresh popup session. Returns the dict passed in (unchanged
    keys) + after-fields; the Start re-read inside the same session is
    unreliable, so confirmation is done via reopen_verify_range()."""
    pair = popup_range_sliders(pop)
    if pair is None:
        return state
    s, e = pair
    out = dict(state)
    sb = out.get("start_before")
    eb = out.get("end_before")
    if sb is None or eb is None:
        return out
    if eb < 0.999:
        set_slider_rv(e, 1.0)
    if sb > 0.001:
        set_slider_rv(s, 0.0)
    out["start_after"] = sb if sb <= 0.001 else 0.0
    out["end_after"] = eb if eb >= 0.999 else 1.0
    out["fixed"] = abs(sb) > 0.001 or abs(eb - 1.0) > 0.01
    return out


def reopen_verify_range(d, pid, knob):
    """Fresh _open_knob_popup visit; reliable read of Start/End. Returns
    (start_rv, end_rv) or None. A SetValue during a popup visit makes queuing
    another SetValue+read on the Start slider report None, so we verify on a
    clean visit instead."""
    rb, pop, last = assign_cc._open_knob_popup(d, pid, knob)
    if pop is None:
        return None
    st = get_range_state(pop)
    cb = assign_cc.close_btn(pop)
    if cb is not None:
        assign_cc.click_center(cb)
    if st is None:
        return None
    return st["start_before"], st["end_before"]


def ensure_full_range_modal(d, pid, knob):
    """Fresh first visit: read authoritative Start/End BEFORE any SetValue,
    fix only what is off range, then confirm via a clean re-open."""
    rb, pop, last = assign_cc._open_knob_popup(d, pid, knob)
    if pop is None:
        return {"msg": "open: " + last}
    assign_cc.close_popup(d, pid)
    state = None
    for _ in range(3):
        state = reopen_verify_range(d, pid, knob)
        if state is not None:
            break
    if state is None:
        return {"msg": "range unreadable"}
    sb, eb = state
    base = {"start_before": sb, "end_before": eb,
            "start_after": sb, "end_after": eb,
            "fixed": abs(sb) > 0.001 or abs(eb - 1.0) > 0.01,
            "msg": "ok"}
    if not base["fixed"]:
        return base
    rb, pop, last = assign_cc._open_knob_popup(d, pid, knob)
    if pop is not None:
        base = force_full_range(pop, base)
        assign_cc.close_popup(d, pid)
    v = reopen_verify_range(d, pid, knob)
    if v is not None:
        base["start_after"], base["end_after"] = v[0], v[1]
        base["confirmed"] = (abs(v[0]) <= 0.001 and abs(v[1] - 1.0) <= 0.01)
    return base


def assign_cc_only(d, pid, knob, cc):
    """Set source=MIDI CC + CC# N only (assign_cc.assign_knob), with retry."""
    res = assign_cc.assign_knob(d, pid, knob, cc)
    if res.startswith("FAIL"):
        time.sleep(1.0)
        from pywinauto.keyboard import send_keys
        send_keys("{ESC}")
        time.sleep(0.4)
        assign_cc.close_popup(d, pid)
        time.sleep(0.5)
        res = assign_cc.assign_knob(d, pid, knob, cc)
    return res


def db_connect():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.executescript("""
    CREATE TABLE IF NOT EXISTS knob_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      effect TEXT NOT NULL,
      slot TEXT NOT NULL,
      control TEXT NOT NULL,
      cc INTEGER NOT NULL,
      vtype TEXT NOT NULL,
      unit TEXT,
      lo REAL, hi REAL, k REAL, inverted INTEGER DEFAULT 0,
      UNIQUE(effect, slot, control)
    );
    CREATE TABLE IF NOT EXISTS knob_values (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      knob_id INTEGER NOT NULL REFERENCES knob_info(id) ON DELETE CASCADE,
      idx INTEGER,
      value_cc INTEGER,
      rv REAL,
      title TEXT NOT NULL
    );
    """)
    try:
        cur.execute("SELECT inverted FROM knob_info LIMIT 1")
    except sqlite3.OperationalError:
        cur.execute("ALTER TABLE knob_info ADD COLUMN inverted INTEGER DEFAULT 0")
    con.commit()
    return con


def save_rows(con, effect, slot, knobs_data):
    cur = con.cursor()
    for kd in knobs_data:
        cur.execute("""
          INSERT INTO knob_info(effect, slot, control, cc, vtype, unit, lo, hi, k, inverted)
          VALUES (?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(effect, slot, control) DO UPDATE SET
            cc=excluded.cc, vtype=excluded.vtype, unit=excluded.unit,
            lo=excluded.lo, hi=excluded.hi, k=excluded.k, inverted=excluded.inverted
        """, (effect, slot, kd["label"], kd["cc"], kd["vtype"], kd["unit"],
              kd.get("lo"), kd.get("hi"), kd.get("k"), kd.get("inverted") or 0))
        kid = cur.execute(
            "SELECT id FROM knob_info WHERE effect=? AND slot=? AND control=?",
            (effect, slot, kd["label"])).fetchone()[0]
        cur.execute("DELETE FROM knob_values WHERE knob_id=?", (kid,))
        for i, v in enumerate(kd["values"]):
            cur.execute(
                "INSERT INTO knob_values(knob_id, idx, value_cc, rv, title) "
                "VALUES (?,?,?,?,?)",
                (kid, i, v.get("cc"), v.get("rv"), v["title"]))
    con.commit()


def build_numeric_values(kd):
    """Per-natural-step value ladder: every integer/short value title + cc."""
    lo, hi, k = kd["lo"], kd["hi"], kd["k"]
    unit = kd.get("unit") or ""
    start = int(math.ceil(lo))
    stop = int(math.floor(hi))
    step = 1
    span = stop - start
    if span > 200:
        step = int(math.ceil(span / 100.0))
    rows = []
    for v in range(start, stop + 1, step):
        rat = (v - lo) / (hi - lo)
        rv = rat ** (1.0 / k) if k > 0 else rat
        if kd.get("inverted"):
            rv = 1.0 - rv
        cc = int(round(127 * max(0.0, min(1.0, rv))))
        rows.append({"title": fmt_num(v, unit), "rv": round(rv, 4), "cc": cc})
    if not rows:
        rows.append({"title": kd["lo_title"], "rv": 0.0, "cc": 0})
    return rows


def main():
    ap = argparse.ArgumentParser(description="calibrate one effect's knob values")
    ap.add_argument("state", help="file name under midi_cc_states/, e.g. ducked-delay-m2.json")
    args = ap.parse_args()

    state_path = os.path.join(STATE_DIR, args.state)
    with open(state_path, encoding="utf-8") as f:
        state = json.load(f)
    assignments = state.get("assignments", [])
    effect = state.get("effect") or state.get("display") or args.state
    slot = state.get("slot", "?")
    print("effect=%r slot=%r assignments=%d" % (state.get("display"), slot, len(assignments)))
    time.sleep(0.2)

    pid = h90_app.find_pid()
    print("PID", pid)
    d = h90_app.desktop()
    h90_app.pin_window()
    from pywinauto.keyboard import send_keys
    send_keys("{ESC}")
    time.sleep(0.4)
    assign_cc.close_popup(d, pid)

    win = uia_driver.get_window(h90_app.connect())
    CURR_WIN[0] = win
    if not connect_state(win):
        print("STATUS: app not in a program view (connect + load a program first)")
        return 2

    rows_all = uia_driver.collect_params(win)
    by_label = {}
    for r in rows_all:
        by_label.setdefault(r["label"].strip(), []).append(r)
    print("discovered %d param rows" % len(rows_all))

    knobs_data = []
    for a in assignments:
        label = a["control"]
        cc = int(a["cc"])
        if (a.get("effect") or "").lower() == "general" or label in GENERAL_BLOCK:
            print("  ! general block: %-12s not calibrated" % label)
            continue
        row = None
        for cand in by_label.get(label, []):
            if cand["slider"] is not None:
                row = cand
                break
        if row is None:
            print("  ! row not found for %r" % label)
            continue
        am = assign_cc_only(d, pid, knob_tuple(row), cc)
        time.sleep(0.3)
        rng = ensure_full_range_modal(d, pid, knob_tuple(row))
        fixed = rng.get("fixed", False)
        cc_final = rng.get("cc_final")
        print("  assign %-12s -> CC#%d range=%s%s"
              % (label, cc, rng, " FIXED" if fixed else ""))
        time.sleep(0.3)
        kd_extra = {"range": rng, "cc_final": cc_final}

        unit = classify_unit(row["value"])
        cur_rv = uia_driver.slider_rangevalue(row["slider"])
        t0t = set_rv(row, 0.0, 0.5)
        t1t = set_rv(row, 1.0, 0.5)
        set_rv(row, cur_rv if cur_rv is not None else 0.0, 0.35)
        c0, u0 = uia_driver.classify_value(t0t)
        c1, _ = uia_driver.classify_value(t1t)
        is_numeric = c0 == "numeric" and c1 == "numeric"

        if is_numeric:
            cal = calibrate_numeric(row, unit or u0)
            if cal is None:
                print("  !  %-12s numeric but uncalibratable" % label)
                continue
            cur_rv = cal.pop("rv0")
            kd = {"label": label, "cc": cc, "vtype": "numeric",
                  "unit": unit or u0, **cal}
            kd.update(kd_extra)
            kd["values"] = build_numeric_values(kd)
            knobs_data.append(kd)
            print("  numeric %-10s lo=%s hi=%s k=%.2f unit=%r values=%d"
                  % (label, kd["lo"], kd["hi"], kd["k"], kd["unit"], len(kd["values"])))
            continue

        options, _cur = enum_sweep(row)
        n = len(options)
        kd = {"label": label, "cc": cc, "vtype": "enum", "unit": None,
              "lo": None, "hi": None, "k": None, "values": []}
        kd.update(kd_extra)
        for i, opt in enumerate(options):
            trigger = int(round(127 * opt["rv"]))
            kd["values"].append({"title": opt["title"], "rv": round(opt["rv"], 4),
                                 "cc": trigger})
        knobs_data.append(kd)
        print("  enum    %-10s options=%d" % (label, n))

    # Second-pass range verification: fresh modal visits AFTER calibration
    # (in-run re-reads can be stale in the same popup session, so confirm every
    # knob once the loop is done and no popup interleaving remains).
    rows_all = uia_driver.collect_params(win)
    by_label = {}
    for r in rows_all:
        by_label.setdefault(r["label"].strip(), []).append(r)
    for kd in knobs_data:
        cand = None
        for c in by_label.get(kd["label"], []):
            if c["slider"] is not None:
                cand = c
                break
        if cand is None:
            continue
        rng = ensure_full_range_modal(d, pid, knob_tuple(cand))
        if rng and rng.get("end_before") is not None:
            kd["range"] = rng
            print("  verify %-12s range=%s%s"
                  % (kd["label"], rng, " OK" if rng.get("confirmed") else ""))

    doc = {
        "kind": "h90-knob-values",
        "effect": effect, "display": state.get("display"), "slot": slot,
        "source": "Eventide Control app (UIA live readouts)",
        "created": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "knobs": knobs_data,
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    out_path = os.path.join(OUT_DIR, args.state)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
    print("saved capture: %s" % out_path)

    con = db_connect()
    save_rows(con, effect, slot, knobs_data)
    print("DB rows written: knob_info=%d -> knob_values" % len(knobs_data))

    print("\n=== RESULT TABLE %s / %s ===" % (effect, slot))
    for kd in knobs_data:
        print("-- %-12s CC#%d %s" % (kd["label"], kd["cc"], kd["vtype"].upper()))
        for v in kd["values"]:
            print("   %-28s trigger CC=%d" % (v["title"], v["cc"]))
    print("\nSTATUS: done (pausing; user to review before more effects)")


if __name__ == "__main__":
    main()