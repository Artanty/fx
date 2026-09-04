#!/usr/bin/env python3
"""Test candidate dictionaries against captured H90 import constraints."""
import sys, json, zlib
sys.path.insert(0, "server")
import h90_dict_recover as H
from h90_reconstruct import extract_deflate, REQ1, REQ2, RESP1, RESP2, WINDOW
from h90_decode import unpack_7bit

B64SET = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")

def decode_resp(path):
    raw = open(path, "rb").read()
    body = raw[8:]
    if body.endswith(b"\xf7"):
        body = body[:-1]
    return zlib.decompress(unpack_7bit(body), 15)

resp1 = decode_resp(RESP1)

# Load constraints
for req_name, req_path in [("req1", REQ1), ("req2", REQ2)]:
    cdata = json.load(open(f"server/h90-captures/{req_name}_dict_constraints.json"))
    constraints = cdata["constraints"]
    # constraints is a list of [offset, {byte, out_pos}] tuples
    constraint_map = {}
    for item in constraints:
        off = item[0]
        entry = item[1]
        constraint_map[off] = entry["out_pos"]

    print(f"=== {req_name}: {len(constraint_map)} constraints ===")

    defl, _ = extract_deflate(req_path)

    # Test with resp1 R-aligned as dict
    dict_r = bytes(WINDOW - len(resp1)) + resp1
    out, src, syms = H.deflate_track(defl, zdict=dict_r)

    n_lit = sum(1 for s in syms if s[0] == "lit")
    n_cp = sum(1 for s in syms if s[0] == "copy")
    print(f"  decoded {len(out)} bytes (lit={n_lit} copy={n_cp})")

    hits = 0
    misses = 0
    for off, out_pos in sorted(constraint_map.items()):
        if out_pos < len(out) and out[out_pos] in B64SET:
            hits += 1
        else:
            misses += 1
    print(f"  constraint hits: {hits}/{hits+misses}")

    # Also test zeros dict
    out_z, _, _ = H.deflate_track(defl, zdict=bytes(WINDOW))
    hits_z = 0
    for off, out_pos in constraint_map.items():
        if out_pos < len(out_z) and out_z[out_pos] in B64SET:
            hits_z += 1
    print(f"  zeros-dict hits: {hits_z}/{len(constraint_map)}")

    # Check what the dict bytes look like at constraint offsets
    dict_r_used = []
    for off, out_pos in sorted(constraint_map.items()):
        if out_pos < len(out):
            val = out[out_pos]
            in_b64 = val in B64SET
            dict_r_used.append((off, out_pos, val, in_b64))
    
    n_non_b64_in_region = sum(1 for _, p, v, _ in dict_r_used if not v)
    print(f"  non-b64 at constraint positions: {n_non_b64_in_region}")
    
    # Show the actual bytes at first 20 constraints
    print("  first 20 constraint bytes:")
    for off, pos, val, b64 in dict_r_used[:20]:
        ch = chr(val) if 32 <= val < 127 else "."
        print(f"    win+{off} out[{pos}] = 0x{val:02x} '{ch}' b64={b64}")

print()
print("=== Testing with .preset90 files as dict ===")
import os
preset_dir = "patchstorage/preset90"
if os.path.isdir(preset_dir):
    for fn in sorted(os.listdir(preset_dir)):
        if fn.endswith(".preset90"):
            blob = open(os.path.join(preset_dir, fn), "rb").read()
            for align in ["R", "L"]:
                if align == "R":
                    zdict = bytes(WINDOW - len(blob)) + blob
                else:
                    zdict = blob + bytes(WINDOW - len(blob))
                defl1, _ = extract_deflate(REQ1)
                try:
                    out, src, _ = H.deflate_track(defl1, zdict=zdict)
                    hits = sum(1 for off, pos in constraint_map.items()
                               if pos < len(out) and out[pos] in B64SET)
                    print(f"  {fn[:30]:30s} {align} out={len(out)}B hits={hits}/{len(constraint_map)}")
                except Exception as e:
                    print(f"  {fn[:30]:30s} {align} ERROR: {e}")
