#!/usr/bin/env python3
"""Precisely map the req1 output region: align b64(file_json) against the
region's known literals to find divergence, and locate embedded strings."""
import sys, os, base64
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_dict_recover as H
from h90_reconstruct import extract_deflate, REQ1, WINDOW
import h90_dict_shift as S

B64 = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
B64SET = set(B64)
b64val = {c: i for i, c in enumerate(B64)}


def decode_req1_with(blob, shift):
    c = S.load_constraints('req1')
    defl, _ = extract_deflate(REQ1)
    win = bytearray(WINDOW)
    win[shift:shift + len(blob)] = blob
    out, src, sym = H.deflate_track(defl, zdict=bytes(win))
    return out, src


def main():
    blob = open('/tmp/h90_fb/preset90_twoway.bin', 'rb').read()
    out, src = decode_req1_with(blob, 29807)

    js = open('/tmp/h90_fb/twoway.json', 'rb').read()
    jsb64 = base64.b64encode(js)
    print(f"file json {len(js)} B -> b64 {len(jsb64)} chars")

    # region: mark fixed (literal) vs copy positions
    region = out[211:976]
    fixed = [src[i][0] == 'lit' for i in range(211, 976)]
    print(f"region {len(region)} chars, fixed(literal) {sum(fixed)}, copy {len(fixed)-sum(fixed)}")

    # find which file-json slice, aligned at region start, matches best
    best = []
    for js_off in range(0, 40):
        sub64 = base64.b64encode(js[js_off:])
        ok = bad = 0
        for i in range(len(region)):
            j = i
            if j >= len(sub64):
                break
            if not fixed[i]:
                continue
            if region[i] == sub64[j]:
                ok += 1
            else:
                bad += 1
        best.append((ok, bad, js_off))
    best.sort(reverse=True)
    print("top: file-json slice offset vs region (literal matches):")
    for ok, bad, off in best[:6]:
        print(f"  js[{off}:] -> {ok} match, {bad} mismatch")

    js_off = best[0][2]
    sub64 = base64.b64encode(js[js_off:])
    print(f"\nusing js[{js_off}:] = {js[js_off:js_off+30]!r}")
    print("first mismatched literal positions (region vs b64(file json)):")
    n = 0
    last = -10
    for i in range(len(region)):
        if i >= len(sub64):
            break
        if fixed[i] and region[i] != sub64[i]:
            print(f"  region[{211+i}]={chr(region[i])!r} json64[{i}]={chr(sub64[i])!r}")
            n += 1
            last = i
            if n >= 30:
                break
    print(f"total literals {sum(fixed)}; {sum(1 for i in range(len(region)) if fixed[i] and i < len(sub64) and region[i]==sub64[i])} match")
    # last literal match position
    lastm = max((i for i in range(len(region)) if i < len(sub64) and fixed[i] and region[i] == sub64[i]), default=-1)
    print(f"last literal match @ region index {lastm} (out {211+lastm})")
    import re
    r = bytes(region)
    for m in re.finditer(rb'tjknobs-knob4', r):
        print(f"  embedded tjknobs-knob4 @ region {m.start()} (out {211+m.start()})")


if __name__ == '__main__':
    main()
