#!/usr/bin/env python3
"""Batch pipeline for remaining m2 effects.

For each effect (families_m2.csv order):
  1. import the pristine starter from input/lib via set_slot_a.py 5 <file> --slot B
  2. reconnect + open Parameters, then run build_knob_values.py <state>.json
     (CC assign + ensure_full_range + value calibration -> DB + capture json)
  3. finalize: pedal Save (header Save), Save to Library overwrite, and the
     library export through export_one_final().

Usage:
  python run_m2_batch.py [--limit N] [--only '<Effect>'] [--from <effect>]
                         [--redo]
"""
import argparse
import csv
import glob
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import export_m2_lib as E
import auto_import

ROOT = os.path.dirname(os.path.abspath(__file__))
INPUT_LIB = r"C:\server\fx\input\lib"
LOG = os.path.join(ROOT, "batch_knob_log.txt")


def kebab(effect):
    e = effect.lower().replace("&", "and")
    return re.sub(r"[^a-z0-9+]+", "-", e).strip("-")


def find_starter(slug, effect):
    cand = "m2 %s %s.preset90" % (slug, effect.replace(" ", "_"))
    p = os.path.join(INPUT_LIB, cand)
    if os.path.exists(p):
        return p
    ne = re.sub(r"[^a-z0-9]+", "", effect.lower())
    for f in glob.glob(os.path.join(INPUT_LIB, "m1 %s *.preset90" % slug)):
        base = os.path.basename(f)
        m = re.match(r"m1 %s (.+)\.preset90$" % slug, base)
        nf = re.sub(r"[^a-z0-9]+", "", (m.group(1) if m else base).lower())
        if ne.startswith(nf) or nf.startswith(ne):
            return f
    return None


def read_done():
    if not os.path.exists(LOG):
        return set()
    out = set()
    for l in open(LOG, encoding="utf-8"):
        l = l.strip()
        if " :: ok" in l or l.endswith(" :: ok"):
            out.add(l.split(" :: ", 1)[0].strip())
    return out


def run(cmd, timeout=2400):
    r = subprocess.run([sys.executable] + cmd, cwd=ROOT,
                       capture_output=True, text=True, encoding="utf-8",
                       errors="replace", timeout=timeout)
    return r.returncode, (r.stdout or "") + (r.stderr or "")


def ensure_params():
    if not auto_import.connect_if_needed(timeout=60):
        return False
    time.sleep(0.8)
    from pywinauto.mouse import click
    click(coords=E.pt(380, 1018))
    time.sleep(1.4)
    try:
        import uia_driver
        rows = uia_driver.collect_params(E.get_win())
    except Exception:
        rows = []
    if not rows:
        click(coords=E.pt(45, 50))
        time.sleep(1.4)
        click(coords=E.pt(380, 1018))
        time.sleep(1.4)
    return True


def pedal_save():
    w = E.get_win()
    dx, dy = E.win_delta()
    from pywinauto.mouse import click
    click(coords=(911 + dx, 141 + dy))
    time.sleep(2.2)
    E.close_save_dialog()
    E.dismiss_save_overwrite_modal()
    time.sleep(0.5)


def preimport_cleanup():
    """Close any stale import/save dialog still up (a failed previous run
    leaves one open; a fresh import then types into the wrong dialog)."""
    from pywinauto.keyboard import send_keys
    import import_preset as I
    send_keys("{ESC}")
    time.sleep(0.4)
    if I.dialog_open():
        c = I.cancel_button()
        if c is not None:
            try:
                c.invoke()
            except Exception:
                pass
            time.sleep(0.5)
    E.close_save_dialog()
    E.dismiss_save_overwrite_modal()
    time.sleep(0.4)


def process_effect(row, redo):
    category, slug, effect = row["category"], row["slug"], row["effect"]
    state = kebab(effect) + "-m2.json"
    state_path = os.path.join(ROOT, "midi_cc_states", state)
    starter = find_starter(slug, effect)
    if not os.path.exists(state_path):
        return "fail:no-state(%s)" % state
    if starter is None:
        return "fail:no-starter"
    lib_name = E.library_name("m2", slug, effect)
    expected = os.path.join(INPUT_LIB, lib_name + ".preset90")

    print("[%s] import %s" % (effect, os.path.basename(starter)))
    preimport_cleanup()
    rc, out = run(["set_slot_a.py", "5", starter, "--slot", "B"], 900)
    for line in out.splitlines():
        if line.startswith("STATUS"):
            pass
    if "STATUS: imported" not in out:
        return "fail:import(%s)" % (out.strip().splitlines() or ["?"])[0][:80]

    if not ensure_params():
        return "fail:reconnect"
    print("[%s] build" % effect)
    rc, out = run(["build_knob_values.py", state], 3600)
    rows_db = None
    for line in out.splitlines():
        if "DB rows written" in line:
            rows_db = line.strip()
    if rc != 0 or rows_db is None:
        tail = "\n".join(out.splitlines()[-6:])
        return "fail:build(%s)" % tail[:200]

    print("[%s] finalize" % effect)
    pedal_save()
    rc, out = run(["save_to_library.py", "--slot", "m2", "--slug", slug,
                   "--effect", effect], 300)
    lib_ok = ("OK: program saved" in out) or ("already" in out)
    try:
        before = os.path.getmtime(expected)
    except OSError:
        before = 0.0
    top = auto_import.connect_if_needed(timeout=60) if not lib_ok else True
    status = E.export_one_final(lib_name, expected, before)
    time.sleep(1.0)
    return ("ok" if status == "saved" else "ok-lib(%s)" % status)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--only", default=None)
    ap.add_argument("--from", dest="frm", default=None)
    ap.add_argument("--redo", action="store_true")
    args = ap.parse_args()

    rows = list(csv.DictReader(open(os.path.join(ROOT, "families_m2.csv"),
                                    encoding="utf-8-sig")))
    if args.frm:
        started = False
        rows = [r for r in rows if (started := started or kebab(r["effect"]) == args.frm)]
    if args.only:
        rows = [r for r in rows if r["effect"].lower() == args.only.lower()]
    done = read_done() if not args.redo else set()

    todo = []
    for r in rows:
        if (not args.redo) and kebab(r["effect"]) in done:
            continue
        todo.append(r)
    if args.limit:
        todo = todo[:args.limit]

    print("todo: %d effects" % len(todo))
    results = []
    for r in todo:
        st = process_effect(r, args.redo)
        tag = "OK" if st.startswith("ok") else "FAIL"
        line = "%s :: %s (%s/%s)" % (kebab(r["effect"]), st, r["category"], r["effect"])
        with open(LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
        results.append(line)
        print("[%s] %s" % (tag, line))

    print("\n=== BATCH SUMMARY ===")
    for line in results:
        print(" ", line)


if __name__ == "__main__":
    main()