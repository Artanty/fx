#!/usr/bin/env python3
"""H90 import write-payload reconstruction pipeline (persistent).

Extracts the raw DEFLATE streams from captured import requests, decodes the
read responses (pedal state dumps), runs the LZ77 dictionary tracker against
candidate dictionaries, and analyses the embedded base64 JSON region so the
dict-dependent bytes can be solved offline.

See H90-IMPORT-NOTES.md for protocol background.

Usage:
  h90_reconstruct.py extract  <req.bin> [--out DIR]      # deflate stream + resp decode
  h90_reconstruct.py decode-resp <resp.bin>              # print read-response payload
  h90_reconstruct.py analyze <req.bin> [options]         # region b64 group analysis
  h90_reconstruct.py track <req.bin> [options]           # deflate_track summary

Options:
  --dict FILE          candidate dictionary file (read payload, .preset90, ...)
  --dict-align L|R     align FILE at left (start) or right (end) of 32K window
  --json FILE          expected JSON text file: b64-encode it and diff region
  --out DIR            output directory (default server/h90-recon)
"""

import sys
import os
import re
import json
import zlib
import base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_dict_recover as H
from h90_decode import unpack_7bit

WINDOW = 32768
B64 = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
B64SET = set(B64)
b64val = {c: v for v, c in enumerate(B64)}
HEREDIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES = os.path.join(HEREDIR, "h90-captures")
REQ1 = os.path.join(CAPTURES, "h90_import_req.bin")
REQ2 = os.path.join(CAPTURES, "h90_import2_req.bin")
RESP1 = os.path.join(CAPTURES, "h90_import_resp_big.bin")
RESP2 = os.path.join(CAPTURES, "h90_import2_resp.bin")
PRESET_TWOWAY = os.path.join(HEREDIR, "..", "patchstorage", "preset90",
                             "TWO-WAY-640284089dce6.preset90")
PRESET_MURKY = os.path.join(HEREDIR, "..", "patchstorage", "preset90",
                            "MURKY-BUCKUET-LEAD-642f25f984e72.preset90")


# ---------------------------------------------------------------- capture IO

def extract_deflate(path):
    """7-bit unpack an H90 frame and return the raw DEFLATE stream bytes."""
    raw = open(path, "rb").read()
    assert raw.startswith(b"\xF0\x1C\x77\x00"), "not an H90 TRPC frame"
    body = raw[8:]
    if body.endswith(b"\xF7"):
        body = body[:-1]
    up = unpack_7bit(body)
    assert up.startswith(b"\x78"), "not a zlib stream"
    return up[2:-4], up


def decode_read_response(path):
    """Unpack + zlib-inflate a read response (pedal state dump)."""
    raw = open(path, "rb").read()
    body = raw[8:]
    if body.endswith(b"\xF7"):
        body = body[:-1]
    return zlib.decompress(unpack_7bit(body), 15)


def build_dict(blob, align="R"):
    """Place `blob` at the left or right end of a 32K zero window."""
    n = len(blob)
    if n > WINDOW:
        raise ValueError(f"dict too large: {n}")
    if align == "R":
        return bytes(WINDOW - n) + blob
    return blob + bytes(WINDOW - n)


def b64_blob_from(buf):
    m = re.search(rb"[A-Za-z0-9+/]{100,}={0,2}", buf)
    return m.group(0) if m else None


# ---------------------------------------------------------------- analysis

def mark_known(out, src):
    """Known positions: literals, plus copies from already-known output."""
    known = [False] * len(out)
    for i in range(len(out)):
        if src[i][0] == "lit":
            known[i] = True
    changed = True
    while changed:
        changed = False
        for i in range(len(out)):
            if known[i] or src[i][0] != "copy":
                continue
            if src[i][1] >= WINDOW and known[src[i][1] - WINDOW]:
                known[i] = True
                changed = True
    return known


def region_groups(out, src, lo, hi):
    """Group output positions [lo,hi) into 4-char base64 groups.

    Returns list of dicts: {pos, chars, unresolved} per group, where chars[i]
    is the b64 char value or None if the position is unresolved (dict-copied).
    """
    groups = []
    for g in range(lo, hi - 3, 4):
        chars, unresolved = [], []
        for k in range(4):
            p = g + k
            if src[p][0] == "lit" and out[p] in B64SET:
                chars.append(b64val[out[p]])
            elif src[p][0] == "copy" and src[p][1] >= WINDOW:
                # self-reference: resolved only if the referenced byte is known
                rp = src[p][1] - WINDOW
                if rp < len(out) and out[p] in B64SET:
                    chars.append(b64val[out[p]])
                else:
                    chars.append(None)
                    unresolved.append(p)
            else:
                chars.append(None)
                unresolved.append(p)
        groups.append({"pos": g, "chars": chars, "unresolved": unresolved})
    return groups


def analyze_region(defl, zdict, lo=211, hi=951):
    out, src, symbols = H.deflate_track(defl, zdict=zdict)
    known = mark_known(out, src)
    groups = region_groups(out, src, lo, hi)
    unk = [p for grp in groups for p in grp["unresolved"]]
    return {
        "out_len": len(out),
        "lo": lo, "hi": hi,
        "n_groups": len(groups),
        "unresolved_count": len(unk),
        "unresolved_pos": unk,
        "groups": groups,
        "out": bytes(out),
        "src": src,
        "known": known,
    }


# ---------------------------------------------------------------- CLI

def cmd_extract(args, outdir):
    for name in ("REQ1", "REQ2"):
        src = {"REQ1": REQ1, "REQ2": REQ2}[name]
        defl, up = extract_deflate(src)
        dst = os.path.join(outdir, f"{name.lower()}_defl.raw")
        open(dst, "wb").write(defl)
        print(f"{name}: packed {len(up)} -> deflate {len(defl)} B -> {dst}")
    for name, src in (("RESP1", RESP1), ("RESP2", RESP2)):
        payload = decode_read_response(src)
        dst = os.path.join(outdir, f"{name.lower()}_dec.bin")
        open(dst, "wb").write(payload)
        print(f"{name}: payload {len(payload)} B -> {dst}")
    # stash the candidates too
    for name, src in (("preset90_twoway", PRESET_TWOWAY), ("preset90_murky", PRESET_MURKY)):
        dst = os.path.join(outdir, name + ".bin")
        open(dst, "wb").write(open(src, "rb").read())
        print(f"candidate {name}: {os.path.getsize(dst)} B -> {dst}")


def cmd_decode_resp(args, outdir):
    for name, src in (("RESP1", RESP1), ("RESP2", RESP2)):
        payload = decode_read_response(src)
        print(f"{name}: {len(payload)} B")
        blob = b64_blob_from(payload)
        print(f"  b64 blob: {'none' if not blob else len(blob) + ' chars'}")
        for key in (b"dmix", b"dlya", b"preset_name", b"TWO", b"MURKY"):
            i = payload.find(key)
            print(f"  {key.decode()}: {'@' + str(i) if i >= 0 else 'none'}")


def cmd_track(args, outdir, analyze=False):
    req = REQ1 if "--req2" not in args else REQ2
    defl, _ = extract_deflate(req)
    if "--zero" in args:
        zdict = bytes(WINDOW)
        dname = "zero"
    else:
        if "--dict" in args:
            blob = open(args[args.index("--dict") + 1], "rb").read()
        else:
            blob = decode_read_response(RESP1)
        align = "R" if "--dict-align L" not in args else "L"
        zdict = build_dict(blob, align)
        dname = f"{os.path.basename(args[args.index('--dict') + 1]) if '--dict' in args else 'resp1'}:{align}"
    out, src, symbols = H.deflate_track(defl, zdict=zdict)
    refs, direct, depend = H.dict_refs(out, src, WINDOW)
    n_lit = sum(1 for s in symbols if s[0] == "lit")
    n_cp = sum(1 for s in symbols if s[0] == "copy")
    print(f"{os.path.basename(req)} dict={dname}")
    print(f"  out {len(out)} B  lit={n_lit} copy={n_cp}  "
          f"dict_refs={len(refs)} direct_offsets={len(direct)} "
          f"({min(direct) if direct else '-'}..{max(direct) if direct else '-'})")
    if analyze:
        res = analyze_region(defl, zdict)
        print(f"  region[{res['lo']}:{res['hi']}] groups={res['n_groups']} "
              f"unresolved={res['unresolved_count']}")
        outpath = os.path.join(outdir, "analysis.json")
        json.dump({"req": os.path.basename(req), "dict": dname,
                   "out_len": res["out_len"],
                   "unresolved_pos": res["unresolved_pos"],
                   "unresolved_count": res["unresolved_count"],
                   "groups": [{"pos": g["pos"], "unresolved": g["unresolved"]}
                              for g in res["groups"]]},
                  open(outpath, "w"), indent=1)
        print(f"  wrote {outpath}")
    if "--hex" in args:
        print(out.hex())


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd = args.pop(0)
    outdir = os.path.join(HEREDIR, "h90-recon")
    if "--out" in args:
        i = args.index("--out")
        outdir = args[i + 1]
        del args[i:i + 2]
    os.makedirs(outdir, exist_ok=True)
    if cmd == "extract":
        cmd_extract(args, outdir)
    elif cmd == "decode-resp":
        cmd_decode_resp(args, outdir)
    elif cmd == "analyze":
        cmd_track(args, outdir, analyze=True)
    elif cmd == "track":
        cmd_track(args, outdir, analyze=False)
    else:
        print(f"unknown command {cmd!r}")
        print(__doc__)


if __name__ == "__main__":
    main()
