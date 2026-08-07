#!/usr/bin/env python3
"""Regression tests for h90_dict_recover.deflate_track.

Validates the custom inflate decoder against Python's zlib (a trusted
reference) across:
  - fixed-block and dictionary streams (tests/node_fixed.json, node_fuzz.json)
  - randomized payloads (seeded, deterministic)
  - the canonical 9-byte "100xA + 100xB" stream that exposed a wrong
    LENGTH_BASE/LENGTH_EXTRA table
  - truncated streams (partial-output semantics must match zlib)

Usage:  python3 test_h90_dict_recover.py
"""

import base64
import json
import os
import random
import sys
import zlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_dict_recover as H

TESTS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tests")

# The 9-byte stream zlib.compress(b"A"*100 + b"B"*100) produces.
D9 = bytes.fromhex("7374a43d70a2030000")
D9_PAYLOAD = b"A" * 100 + b"B" * 100


def check(name, cond, detail=""):
    status = "ok  " if cond else "FAIL"
    print(f"[{status}] {name}" + (f" — {detail}" if detail and not cond else ""))
    return cond


def test_fixed_corpus():
    cases = json.load(open(os.path.join(TESTS_DIR, "node_fixed.json")))
    bad = 0
    for i, c in enumerate(cases):
        p = base64.b64decode(c["payload"])
        d = base64.b64decode(c["defl"])
        try:
            out, _, _ = H.deflate_track(d)
        except Exception as e:
            bad += 1
            continue
        if out != p:
            bad += 1
    return check("fixed corpus (26)", bad == 0, f"{bad} failing")


def test_fuzz_corpus():
    cases = json.load(open(os.path.join(TESTS_DIR, "node_fuzz.json")))
    bad = 0
    for i, c in enumerate(cases):
        db = base64.b64decode(c["dict"])
        p = base64.b64decode(c["payload"])
        d = base64.b64decode(c["defl"])
        try:
            out, _, _ = H.deflate_track(d, db)
        except Exception as e:
            bad += 1
            continue
        if out != p:
            bad += 1
    return check("fuzz corpus w/ dict (60)", bad == 0, f"{bad} failing")


def test_random_crosscheck():
    rng = random.Random(1337)
    trials = 150
    fails = 0
    for t in range(trials):
        n = rng.randint(1, 1500)
        kind = rng.random()
        if kind < 0.4:
            p = bytes(rng.randint(0, 255) for _ in range(n))
        elif kind < 0.7:
            alpha = bytes(range(32, 127))
            p = bytes(rng.choice(alpha) for _ in range(n))
        else:
            seg = bytes(rng.randint(0, 255) for _ in range(rng.randint(1, 40)))
            p = (seg * (n // len(seg) + 1))[:n]
        lvl = rng.choice([0, 1, 2, 4, 6, 9])
        if rng.random() < 0.5:
            zd = bytes(rng.randint(0, 255) for _ in range(rng.randint(1, 1500)))
            co = zlib.compressobj(lvl, zlib.DEFLATED, -15, 8,
                                  zlib.Z_DEFAULT_STRATEGY, zd)
        else:
            zd = b""
            co = zlib.compressobj(lvl, zlib.DEFLATED, -15)
        d = co.compress(p) + co.flush()
        try:
            out, src, _ = H.deflate_track(d, zd)
        except Exception:
            fails += 1
            continue
        if out != p:
            fails += 1
            continue
        for i, s in enumerate(src):
            if len(s) > 1 and not (0 <= s[1] < len(zd) + i):
                fails += 1
                break
    return check(f"random crosscheck vs zlib ({trials})", fails == 0,
                 f"{fails} failing")


def test_known_stream():
    out, src, syms = H.deflate_track(D9)
    ok = out == D9_PAYLOAD
    expect = [("lit", 65), ("lit", 65), ("copy", 98, 1, 2),
              ("lit", 66), ("copy", 99, 1, 101)]
    ok = ok and syms == expect
    return check("known 100A/100B stream + symbol trace", ok,
                 f"{out[:10]!r} syms={syms}")


def test_truncated_partial():
    """Truncated streams must yield the same partial output zlib yields."""
    rng = random.Random(99)
    ok = True
    for _ in range(30):
        p = bytes(rng.randint(0, 255) for _ in range(rng.randint(300, 1200)))
        co = zlib.compressobj(6, zlib.DEFLATED, -15)
        d = co.compress(p) + co.flush()
        cut = rng.randint(1, len(d) - 1)
        d_cut = d[:cut]
        z = zlib.decompressobj(-15)
        try:
            out_z = z.decompress(d_cut)
        except zlib.error:
            out_z = None
        try:
            out_m = H.deflate_track(d_cut)[0]
        except Exception:
            out_m = None
        if out_z is None:
            continue  # zlib errored; decoder may legitimately differ
        if out_m != out_z:
            ok = False
            break
    return check("truncated-stream partial output matches zlib", ok)


def main():
    results = [
        test_fixed_corpus(),
        test_fuzz_corpus(),
        test_random_crosscheck(),
        test_known_stream(),
        test_truncated_partial(),
    ]
    print()
    print("ALL PASS" if all(results) else "FAILURES PRESENT")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main())
