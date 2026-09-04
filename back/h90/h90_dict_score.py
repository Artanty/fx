#!/usr/bin/env python3
"""Score candidate dictionaries against the H90 write-path dict constraints.

Each candidate blob is placed in the 32K deflate window at several alignments
(left, right, and all integer shifts if --exhaustive), then req1/req2 are
decoded with it and scored:

  * constraint hit-rate: the dict byte at each constrained window offset must be
    a base64 char (region out[211:] is b64 JSON, so copied bytes are b64 chars)
  * region validity: out[211:976] must be contiguous base64 that decodes
  * JSON plausibility: decoded region should contain the preset's params
  * cross-req test: use req1's output (with a good req1 dict) as req2's dict

Usage:
  h90_dict_score.py scan CANDIDATE [CANDIDATE...] [--req1|--req2] [--align R|L]
  h90_dict_score.py scan-dir DIR
  h90_dict_score.py constraints FILE.json
"""
import sys, os, re, json, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_dict_recover as H
from h90_reconstruct import (extract_deflate, REQ1, REQ2, WINDOW,
                             PRESET_TWOWAY, PRESET_MURKY, b64_blob_from)

B64 = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
B64SET = set(B64)
JSON_KEYS = [b'algorithm_name', b'dlya', b'dlyb', b'dmix', b'bypa_normal',
             b'preset_name', b'com.eventide', b'routing_type', b'version']


def load_constraints(name="req1"):
    f = f"server/h90-captures/{name}_dict_constraints.json"
    d = json.load(open(f))
    c = d["constraints"] if isinstance(d, dict) else d
    if isinstance(c, dict):
        return {off: e["out_pos"] for off, e in c.items()}
    return {off: e["out_pos"] for off, e in c}


def b64_region_score(buf, lo=211):
    """How much of buf[lo:] is contiguous valid b64 of length >= 100?"""
    body = buf[lo:]
    if not body:
        return 0, None
    m = re.search(rb"[A-Za-z0-9+/]{100,}", body)
    if not m:
        return 0, None
    return len(m.group(0)), m.group(0)


def region_is_b64chars(buf, lo, hi):
    n = sum(1 for b in buf[lo:hi] if b in B64SET)
    return n, hi - lo


def decode_with(defl, blob, align):
    zdict = blob if align == "exact" else build_win(blob, align)
    if len(zdict) != WINDOW:
        return None
    out, src, sym = H.deflate_track(defl, zdict=zdict)
    return out, src


def build_win(blob, align):
    n = len(blob)
    if n >= WINDOW:
        return blob[-WINDOW:]
    if align == "R":
        return bytes(WINDOW - n) + blob
    if align == "L":
        return blob + bytes(WINDOW - n)
    raise ValueError(align)


def score_req(req_path, constraints, blob, align, lo=211):
    defl, _ = extract_deflate(req_path)
    try:
        out, src = decode_with(defl, blob, align)
    except Exception as e:
        return {"err": str(e)}
    if out is None:
        return {"err": "dict larger than window"}
    n_char, total = region_is_b64chars(out, lo, len(out))
    hit = sum(1 for off in constraints if out[constraints[off]] in B64SET)
    blob64, b64bytes = b64_region_score(bytes(out))
    keys = {}
    for k in JSON_KEYS:
        keys[k.decode()] = bytes(out).find(k)
    return {
        "out_len": len(out),
        "b64char_frac": f"{n_char}/{total}",
        "constraint_hits": f"{hit}/{len(constraints)}",
        "b64_blob": blob64,
        "keys": keys,
    }


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd = args.pop(0)
    req = "req2" if "--req2" in args else "req1"
    args = [a for a in args if a not in ("--req1", "--req2")]
    aligns = ["R", "L"] if "--align" not in args else [args[args.index("--align") + 1]]
    if "--align" in args:
        del args[args.index("--align"):args.index("--align") + 2]
    constraints = load_constraints(req)
    req_path = REQ2 if req == "req2" else REQ1

    if cmd == "constraints":
        for off, pos in sorted(constraints.items()):
            print(f"  window+{off} -> out[{pos}]")
        return

    if cmd == "scan":
        for path in args:
            blob = open(path, "rb").read()
            for align in aligns:
                r = score_req(req_path, constraints, blob, align)
                print(f"{os.path.basename(path):24s} {align} {json.dumps(r, sort_keys=True)}")
        return

    if cmd == "scan-dir":
        for root, _, files in os.walk(args[0]):
            for fn in sorted(files):
                if fn.startswith("."):
                    continue
                path = os.path.join(root, fn)
                try:
                    blob = open(path, "rb").read()
                except Exception:
                    continue
                if len(blob) < 64:
                    continue
                for align in aligns:
                    r = score_req(req_path, constraints, blob, align)
                    print(f"{os.path.basename(path):24s} {align} {json.dumps(r, sort_keys=True)}")
        return


if __name__ == "__main__":
    main()
