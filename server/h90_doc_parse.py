#!/usr/bin/env python3
"""Definitive structural parse of req1_out: every byte classified.

Regions: literal (deflate literal), copy-from-known (resolvable inside out1),
copy-from-X (unresolvable, pre-segment window), with source positions.
"""
import sys
import os
import base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_reconstruct as R
import h90_dict_recover as H


def main():
    defl1, up1 = R.extract_deflate(R.REQ1)
    out1, src1, syms1 = H.deflate_track(defl1, zdict=bytes(R.WINDOW))
    known1 = R.mark_known(out1, src1)

    # classify each output byte directly from symbols
    cls = [None] * len(out1)
    pos = 0
    for sym in syms1:
        if sym[0] == "lit":
            cls[pos] = ("L", None)
            pos += 1
        else:
            _, length, dist, out_pos = sym
            for k in range(length):
                p = out_pos + k
                sp = p - dist
                if sp >= 0:
                    cls[p] = ("C", sp)
                else:
                    cls[p] = ("X", R.WINDOW + sp)
            pos = out_pos + length

    # group consecutive same-kind regions
    print("=== req1_out region map (%d bytes) ===" % len(out1))
    i = 0
    while i < len(out1):
        j = i
        kind = cls[i][0]
        while j < len(out1) and cls[j][0] == kind:
            j += 1
        seg = out1[i:j]
        if kind == "L":
            txt = "".join(chr(c) if 32 <= c < 127 else "." for c in seg)
            print("[%3d..%3d] LIT   %3dB  %r" % (i, j - 1, j - i, txt[:70]))
        elif kind == "C":
            srcs = [cls[k][1] for k in range(i, j)]
            print("[%3d..%3d] COPY  %3dB  <- out[%d..%d]  %r" %
                  (i, j - 1, j - i, srcs[0], srcs[-1],
                   "".join(chr(c) if 32 <= c < 127 else "." for c in seg)[:50]))
        else:
            srcs = [cls[k][1] for k in range(i, j)]
            print("[%3d..%3d] XDICT %3dB  <- win[%d..%d] (X-tail %d..%d)" %
                  (i, j - 1, j - i, srcs[0], srcs[-1],
                   srcs[0] - R.WINDOW, srcs[-1] - R.WINDOW))
        i = j


if __name__ == "__main__":
    main()
