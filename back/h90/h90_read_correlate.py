#!/usr/bin/env python3
"""Read the current visible H90 editor knobs and print them mapped to JSON keys."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_ui as U
import h90_params as P

# read live knob label -> value
live = {}
params = U.scan_params()
for p in params:
    lab = p["label"].strip()
    if not lab:
        continue
    if lab in live:
        continue  # keep first (page-1) occurrence
    live[lab] = p["value"]

print("=== Knob -> value (live screen) ===")
for lab, val in live.items():
    print(f"  {lab:16} = {val}")

print()
print("=== Octaver knob -> JSON key -> value ===")
for lab, key in P.OCTAVER_KNOB_TO_KEY.items():
    val = live.get(lab, "")
    print(f"  {lab:14} -> {key:6} = {val}")
