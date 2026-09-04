#!/usr/bin/env python3
"""Exhaustive window-shift search: find the best placement of a candidate dict
blob in the 32K window by maximizing constraint hits + region b64-chars."""
import sys, os, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_dict_recover as H
from h90_reconstruct import extract_deflate, REQ1, REQ2, WINDOW

B64SET = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")


def load_constraints(name):
    d = json.load(open(f"server/h90-captures/{name}_dict_constraints.json"))
    c = d["constraints"] if isinstance(d, dict) else d
    if isinstance(c, dict):
        return {off: e["out_pos"] for off, e in c.items()}
    return {off: e["out_pos"] for off, e in c}


def score_at_shift(defl, constraints, blob, shift, lo=211):
    """Place blob at window[shift:shift+len]; score constraint bytes + region."""
    win = bytearray(WINDOW)
    n = len(blob)
    win[shift:shift + n] = blob[:WINDOW - shift]
    zd = bytes(win)
    try:
        out, src, sym = H.deflate_track(defl, zdict=zd)
    except Exception:
        return None
    hits = sum(1 for off, pos in constraints.items()
               if 0 <= off < WINDOW and out[pos] in B64SET)
    region = bytes(out[lo:])
    nch = sum(1 for b in region if b in B64SET)
    return hits, nch, len(region), bytes(out)


def search(blob, req, lo=211):
    constraints = load_constraints(req)
    defl, _ = extract_deflate(REQ2 if req == "req2" else REQ1)
    best = []
    step = 1 if len(blob) < 8000 else 8
    for shift in range(0, max(1, WINDOW - len(blob) + 1), step):
        r = score_at_shift(defl, constraints, blob, shift, lo)
        if r is None:
            continue
        hits, nch, total, out = r
        if hits >= 40:
            best.append((hits, nch, shift, out))
    best.sort(key=lambda t: (t[0], t[1]), reverse=True)
    for hits, nch, shift, out in best[:10]:
        print(f"  shift {shift:6d}  hits {hits:3d}/{len(constraints)}  "
              f"b64 {nch}/{total}  (blob@{shift}-{shift+len(blob)})")
    return best


if __name__ == "__main__":
    path = sys.argv[1]
    req = "req2" if "--req2" in sys.argv else "req1"
    blob = open(path, "rb").read()
    print(f"{os.path.basename(path)} ({len(blob)} B) vs {req}:")
    search(blob, req)
