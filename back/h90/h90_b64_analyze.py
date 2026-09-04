#!/usr/bin/env python3
"""Analyze req1_out structure: chunked b64 vs TWO-WAY preset JSON."""
import sys
import os
import base64
import json

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_reconstruct as R
import h90_dict_recover as H

defl1, up1 = R.extract_deflate(R.REQ1)
out1, src1, _ = H.deflate_track(defl1, zdict=bytes(R.WINDOW))
known1 = R.mark_known(out1, src1)

print("req1_out len:", len(out1))

# classify region 192..end
B64SET = R.B64SET
runs = []
cur = None
for i in range(192, len(out1)):
    b = out1[i]
    if b in B64SET:
        if cur is None:
            cur = [i, i]
        else:
            cur[1] = i
    else:
        if cur is not None:
            runs.append(tuple(cur))
            cur = None
if cur:
    runs.append(tuple(cur))
print("\nb64 runs (start,end,len):")
for a, b in runs:
    unk_in = sum(1 for i in range(a, b + 1) if not known1[i])
    print("  [%4d..%4d] %3dB unk=%d" % (a, b, b - a + 1, unk_in))

# concatenated b64 stream (all runs joined)
blob = bytes(c for i, c in enumerate(out1) if i >= 192 and c in B64SET)
print("\nconcatenated b64 len:", len(blob), " mod4 =", len(blob) % 4)
pad = blob + b"=" * (-len(blob) % 4)
try:
    dec = base64.b64decode(pad)
    print("joined decode:", dec[:120])
except Exception as e:
    print("joined decode failed:", e)

# per-run decode
print("\nper-run decodes:")
for a, b in runs[:30]:
    seg = out1[a:b + 1]
    unk_in = sum(1 for i in range(a, b + 1) if not known1[i])
    s = bytes(seg)
    txt = "".join(chr(c) if c in B64SET else "?" for c in s)
    ok = ""
    if len(s) % 4 == 0 and not unk_in:
        try:
            ok = base64.b64decode(s + b"=" * (-len(s) % 4))[:48]
        except Exception as e:
            ok = "ERR %s" % e
    print("  [%4d] %s\n        unk=%d -> %r" % (a, txt, unk_in, ok))

# TWO-WAY preset JSON for reference
tw = open(R.PRESET_TWOWAY, "rb").read()
print("\nTWO-WAY preset90 size:", len(tw))
print("head:", tw[:200])
