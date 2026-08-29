#!/usr/bin/env python3
"""H90 algorithm parameter models (knob label <-> JSON key) recovered by
reverse-engineering the H90 Control app (Win, 2026-08-28).

Each algorithm has a list of JSON base keys (order in the write/preset JSON),
plus a display mapping from on-screen knob label to that key.

The full preset JSON uses one record per base key with the companion keys:
  <key>                          (current/denormalized value)
  <key>_denormalized_pretaper    (raw 0..1 pretaper position)
  <key>_start_exp, <key>_end_exp (exponent range)
See h90-recon/twoway.json for a complete example.

Global / pedal-level knobs (not algorithm digits) map to keys like
in1_sens/out1_sens, bypa_normal, killdry, expression_pedal, tmpv, tsyn,
x_switch/y_switch/z_switch, preset_mix, preset_name, product_id, version.
"""

# The H90 "Reverse"/TWO-WAY algorithm (UUID 21e22b15-5814-4cf8-b271-ffbaea0d4246)
# base key order:
REVERSE_KEYS = ["xfad", "mdpt", "mspd", "fltr", "fbkb", "fbka", "dlyb",
                "dlya", "dmix", "mmix"]

# "Drty Vocals" = Octaver algorithm (UUID 0163d495-aaea-4727-a223-ef5b190975d3)
# base key order (recovered from the live editor descriptor + binary model):
OCTAVER_KEYS = ["atck", "sens", "fuzz", "fzmx", "resb", "resa", "fltb",
                "flta", "pmix", "mmix"]

# Octaver knob label -> key
OCTAVER_KNOB_TO_KEY = {
    "Mix": "mmix",
    "Pitch Mix": "pmix",
    "Oct-Fuzz Mix": "fzmx",
    "Envelope": "atck",
    "Sensitivity": "sens",
    "Fuzz": "fuzz",
    "Filter A": "flta",
    "Filter B": "fltb",
    "Resonance A": "resa",
    "Resonance B": "resb",
}

# On-screen display order is NOT the JSON order. The UI re-sorts to this order
# and shows Filter/Resonance A-before-B although JSON is B-before-A.
OCTAVER_DISPLAY_ORDER = [OCTAVER_KNOB_TO_KEY[k] for k in
                         ["Mix", "Pitch Mix", "Oct-Fuzz Mix", "Envelope",
                          "Sensitivity", "Fuzz", "Filter A", "Filter B",
                          "Resonance A", "Resonance B"]]


def key_to_knob(algo_key, mapping=None):
    mapping = mapping or OCTAVER_KNOB_TO_KEY
    inv = {v: k for k, v in mapping.items()}
    return inv.get(algo_key)


if __name__ == "__main__":
    import json, sys
    print("Octaver keys (JSON order):", OCTAVER_KEYS)
    print("Octaver keys (display order):", OCTAVER_DISPLAY_ORDER)
    print(json.dumps(OCTAVER_KNOB_TO_KEY, indent=2))
