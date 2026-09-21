#!/usr/bin/env python3
"""Assign the knob values of a patch-storage preset file to an effect slot by
replaying calibrated values through our CC/value maps (NOT the app's native
import).

A .pgm90 program file contains one JSON preset blob per program slot (via
build_db.extract_json_blobs). Slot A uses the first blob, Slot B the second.
The blob keys are compact H9 param ids (dcay, efbk, ...). The desktop H90
editor shows them under slightly different row labels (e.g. the m2 ModEchoVerb
calls H9 'Predelay' -> 'Echo', H9 'Delay Time' -> 'Decay'). ALGORITHM_ROWS maps
the editor row labels to the blob keys for the algorithms we replay.

Flow:
  1. Decode the blob for the target slot and print its knob params.
  2. Determine the effect + its calibrated capture (knob_values/<slug>-m2.json)
     and locate the matching base starter in input/lib (m2 <cat> <Effect>.preset90).
  3. Native-import the starter into the slot (set_slot_a.py) as a clean base.
  4. For each effect knob row, resolve the calibrated rv whose value matches the
     preset target (numeric: nearest calibrated value; enum: nearest option),
     set the slider, and read back the editor value.
  5. Report knob | preset target | rv | cc | applied/readback.

Usage:
  python assign_patchstorage.py <preset-file> [--program 5] [--slot A]
                                 [--dry] [--no-import]
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import build_db
import build_knob_values as BKV
import h90_app
import import_preset
import uia_driver
import set_slot_a
from auto_import import _dismiss_modified_modal, connect_if_needed

# Editor row label -> blob key for the algorithms we replay.
ALGORITHM_ROWS = {
    "ModEchoVerb": {
        "Mix": "mmix",
        "Decay": "dcay",
        "Size": "size",
        "Echo": "pdly",
        "Echo Fdbk": "efbk",
        "Echo Tone": "eton",
        "Flanger Mix": "fxmx",
        "Mod Rate": "mrat",
        "Low Level": "lolv",
        "High Level": "hilv",
    },
    "ModFilter": {
        "Intensity": "itsy",
        "Type": "type",
        "Depth": "dpth",
        "Speed": "sped",
        "Shape": "shpe",
        "Width": "wdth",
        "Depth Mod": "dmod",
        "Speed Mod": "smod",
        "Mod Rate": "mrat",
        "Mod Source": "msrc",
        "Manual Mod": "pedal",
    },
}

# Program-level / general-block params never assigned to effect knobs.
NON_KNOB = re.compile(
    r"(bypa_normal|bypt_normal|preset_mix|killdry|tmpv|tsyn|slow_mode|"
    r"expression_pedal|in[12]_sens|out[12]_sens|x_switch|y_switch|z_switch|"
    r"product_id|version|_hot_switch$|_exp$)"
)


def kebab(name):
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def load_families():
    rows = []
    with open(os.path.join(HERE, "families_m2.csv"), encoding="utf-8") as f:
        for line in f:
            line = line.rstrip("\n")
            if not line or line.startswith("#"):
                continue
            parts = line.split(",")
            if len(parts) >= 3:
                rows.append({"cat": parts[0].strip(),
                             "slug": parts[1].strip(),
                             "effect": parts[2].strip()})
    return rows


def find_family(rows, effect):
    for r in rows:
        if r["effect"].lower() == effect.lower():
            return r
    return None


def title_number(text):
    m = re.search(r"[-+]?\d+(?:[.,]\d+)?", text or "")
    return float(m.group().replace(",", ".")) if m else None


def numeric_error(parsed, target):
    if parsed is None or target is None:
        return None
    return abs(parsed - target)


def resolve_rv(knob, target):
    """Return (rv, applied_title, err) calibrating knob to the preset value.
    Numeric -> nearest calibrated value title; enum -> nearest numeric option."""
    best = None
    for v in knob.get("values", []):
        num = title_number(v.get("title"))
        if num is None:
            continue
        err = numeric_error(num, target)
        if err is None:
            continue
        if best is None or err < best[2]:
            best = (v.get("rv"), v.get("title"), err)
    return best


def base_for(fam, effect):
    """m2 starter path in input/lib: 'm2 <cat> <Effect>.preset90'."""
    root = os.path.join(os.path.dirname(os.path.dirname(HERE)), "input", "lib")
    names = [
        "m2 %s %s.preset90" % (fam["cat"], effect),
        "m2 %s %s.preset90" % (fam["slug"], effect),
    ]
    for n in names:
        p = os.path.join(root, n)
        if os.path.isfile(p):
            return p
    return None


def plan_blob(path, slot):
    data = open(path, "rb").read()
    blobs = build_db.extract_json_blobs(data)
    if not blobs:
        print("ERROR: no JSON blobs found in %s" % path)
        return None
    idx = 0 if slot == "A" else (1 if len(blobs) > 1 else 0)
    blob = blobs[idx]
    return blob, idx, len(blobs)


def build_plan(blob):
    alg = blob.get("algorithm_name")
    rows = ALGORITHM_ROWS.get(alg)
    fam = find_family(load_families(), alg)
    if rows is None or fam is None:
        print("ERROR: no ALGORITHM_ROWS/family for algorithm %r" % alg)
        return None, alg, fam
    plan = []
    for label, key in rows.items():
        target = blob.get(key)
        plan.append({"label": label, "key": key, "target": target})
    return plan, alg, fam


def print_params(blob, alg):
    print("preset_name: %s  product_id: %s" % (
        blob.get("preset_name"), blob.get("product_id")))
    effect = {k: v for k, v in blob.items()
              if not NON_KNOB.search(k) and isinstance(v, (int, float))}
    print("--- effect params (%s) ---" % alg)
    for k, v in sorted(effect.items()):
        print("  %-22s %s" % (k, v))
    return effect


def prepare_app(program, base_path, slot):
    """Recall program N, reconnect, and import the base starter into the slot
    IN-PROCESS so the slot's parameter rows stay open for direct knob edits
    (a reconnect only shows the program General page). Returns the window."""
    h90_app.pin_window()
    win = h90_app.main_window()
    connect_if_needed(timeout=75.0)
    win = h90_app.main_window()
    # disconnect -> free the MIDI port so the recall node helper can reach it
    set_slot_a.disconnect(win)
    time.sleep(1.0)
    if set_slot_a.recall_program(program) != 0:
        print("ERROR: recall failed")
        return None
    connect_if_needed(timeout=60.0)
    win = h90_app.main_window()
    _dismiss_modified_modal(win)
    try:
        from pywinauto.mouse import click
        click(coords=(386, 97))   # 'Edit' radio
        time.sleep(1.4)
        win = h90_app.main_window()
    except Exception:
        pass
    status, info = import_preset.import_preset(base_path, slot)
    print("IMPORT: %s (slot %s: %s)" % (status, slot, info))
    if status != "imported":
        print("ERROR: base import failed")
        return None
    time.sleep(1.0)
    win = h90_app.main_window()
    return win


def load_capture(fam_slug_want):
    """Full slug override: ModEchoVerb capture is modechoverb-m2.json."""
    cap_file = os.path.join(HERE, "knob_values", "%s-m2.json" % fam_slug_want)
    if not os.path.isfile(cap_file):
        return None
    with open(cap_file, encoding="utf-8") as f:
        return json.load(f)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("path")
    ap.add_argument("--program", type=int, default=5)
    ap.add_argument("--slot", choices=["A", "B"], default="A")
    ap.add_argument("--no-import", action="store_true")
    ap.add_argument("--dry", action="store_true")
    args = ap.parse_args()

    blob, idx, nblobs = plan_blob(args.path, args.slot)
    if blob is None:
        return 1
    alg = blob.get("algorithm_name")
    print("slot %s <- blob %d/%d  algorithm=%s  preset=%s" % (
        args.slot, idx + 1, nblobs, alg, blob.get("preset_name")))
    print_params(blob, alg)

    plan, alg, fam = build_plan(blob)
    if plan is None:
        return 1
    slug = kebab(fam["effect"])   # e.g. modechoverb
    cap = load_capture(slug)
    print("capture: knob_values/%s-m2.json (%s knobs)" % (
        slug, len(cap.get("knobs", [])) if cap else "MISSING"))
    cap_by_label = {k.get("label"): k for k in (cap or {}).get("knobs", [])}

    rv_plan = []
    for p in plan:
        knob = cap_by_label.get(p["label"]) if cap else None
        if knob is None:
            rv_plan.append(dict(p, status="no-capture"))
            continue
        if p["target"] is None:
            rv_plan.append(dict(p, status="no-key"))
            continue
        rv, applied_title, err = resolve_rv(knob, p["target"])
        if rv is None:
            rv_plan.append(dict(p, status="no-rv"))
            continue
        rv_plan.append(dict(p, rv=rv, applied=applied_title, err=err,
                            cc=knob.get("values") and next(
                                (v.get("cc") for v in knob["values"]
                                 if v.get("rv") == rv), None)))

    print("\n--- plan ---")
    for p in rv_plan:
        print("  %-11s %-5s target=%-9s status=%-9s rv=%-5s cc=%s applied=%s" % (
            p["label"], p["key"],
            "%.3f" % p["target"] if isinstance(p["target"], float) else p["target"],
            p.get("status", "ok"), p.get("rv"), p.get("cc"), p.get("applied")))

    if args.dry:
        return 0

    base_path = base_for(fam, alg)
    if base_path is None:
        print("ERROR: no m2 starter for %s (%s)" % (alg, fam["cat"]))
        return 1
    if not args.no_import:
        win = prepare_app(args.program, base_path, args.slot)
        if win is None:
            return 1
    else:
        h90_app.pin_window()
        win = h90_app.main_window()
    rows = uia_driver.collect_params(win, xmin=280, xmax=655)
    BKV.CURR_WIN[0] = win
    by_label = {}
    for r in rows:
        by_label.setdefault(r["label"].strip(), []).append(r)
    print("discovered %d param rows" % len(rows))
    found = [lb for lb in set(by_label) if lb in ALGORITHM_ROWS.get(alg, {})]
    for lb in sorted(found):
        print("  row: %s" % lb)

    print("\n--- applying ---")
    reports = []
    for p in rv_plan:
        if not p.get("rv") and p.get("status") != "no-capture":
            reports.append(dict(p, readback="(skip)"))
            continue
        row = next((r for r in by_label.get(p["label"], [])
                    if r.get("slider") is not None), None)
        if row is None or row.get("slider") is None:
            reports.append(dict(p, status="no-row", readback=""))
            continue
        rb = BKV.set_rv(row, p.get("rv"))
        reports.append(dict(p, readback=rb))
        print("  %-11s target=%s rv=%s cc=%s applied=%s readback=%s" % (
            p["label"],
            "%.3f" % p["target"] if isinstance(p["target"], float) else p["target"],
            p.get("rv"), p.get("cc"), p.get("applied"), rb))

    print("\n--- final ---")
    for r in reports:
        print("%s::%s" % (r["label"], r.get("readback") or r.get("status")))

    fout = os.path.join(HERE, "patchstorage_assign.log.json")
    with open(fout, "a", encoding="utf-8") as f:
        json.dump({"file": args.path, "slot": args.slot, "algorithm": alg,
                   "preset": blob.get("preset_name"),
                   "reports": reports}, f, indent=2, default=str)
        f.write("\n")
    print("WROTE %s" % fout)
    return 0


if __name__ == "__main__":
    sys.exit(main())