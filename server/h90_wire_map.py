#!/usr/bin/env python3
"""Map req1_out's chunked b64 stream onto b64(twoway.json).

Walks the b64 runs of req1_out sequentially, aligning each run against
enc = base64(twoway.json) with a forward skip (marker bytes between chunks).
Classifies every position: literal-match / literal-SUBSTITUTED / dict-copy.
"""
import sys
import os
import base64

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import h90_reconstruct as R
import h90_dict_recover as H


def main():
    twj = open(os.path.join(R.RECON_DIR, "twoway.json"), "rb").read() \
        if hasattr(R, "RECON_DIR") else open("server/h90-recon/twoway.json", "rb").read()
    enc = base64.b64encode(twj)

    defl1, up1 = R.extract_deflate(R.REQ1)
    out1, src1, _ = H.deflate_track(defl1, zdict=bytes(R.WINDOW))
    known1 = R.mark_known(out1, src1)

    B64SET = R.B64SET
    runs = []
    cur = None
    for i in range(192, len(out1)):
        if out1[i] in B64SET:
            if cur is None:
                cur = [i, i]
            else:
                cur[1] = i
        else:
            if cur:
                runs.append(tuple(cur))
                cur = None
    if cur:
        runs.append(tuple(cur))

    # markers between runs
    print("=== inter-run marker bytes ===")
    for k in range(len(runs) - 1):
        a, b = runs[k][1] + 1, runs[k + 1][0] - 1
        if b >= a:
            print("  after run@%d: %s" % (runs[k][0], out1[a:b + 1].hex(" ")))

    print("\n=== sequential alignment (anchored, bounded skip) ===")
    LIT = {b"tjknobs", b"knob4", b"xdl"}
    runs2 = [r for r in runs if bytes(out1[r[0]:r[1] + 1]) not in LIT]
    ai = next(k for k, (a, b) in enumerate(runs2) if a <= 275 <= b)
    pos = {ai: 92}
    # forward
    for k in range(ai + 1, len(runs2)):
        a, b = runs2[k]
        seg = bytes(out1[a:b + 1])
        kn = [known1[i] for i in range(a, b + 1)]
        n = len(seg)
        prev_end = pos[k - 1] + (runs2[k - 1][1] - runs2[k - 1][0] + 1)
        best = (-1, None)
        for pp in range(max(0, prev_end - 6), min(len(enc) - n, prev_end + 90) + 1):
            sc = sum(1 for j in range(n) if kn[j] and seg[j] == enc[pp + j])
            if sc > best[0]:
                best = (sc, pp)
        pos[k] = best[1]
    # backward
    for k in range(ai - 1, -1, -1):
        a, b = runs2[k]
        seg = bytes(out1[a:b + 1])
        kn = [known1[i] for i in range(a, b + 1)]
        n = len(seg)
        nxt_start = pos[k + 1]
        best = (-1, None)
        for pp in range(max(0, nxt_start - 90), min(len(enc) - n, nxt_start + 6) + 1):
            sc = sum(1 for j in range(n) if kn[j] and seg[j] == enc[pp + j])
            if sc > best[0]:
                best = (sc, pp)
        pos[k] = best[1]

    sub_positions = []
    unk_positions = []
    for k, (a, b) in enumerate(runs2):
        seg = bytes(out1[a:b + 1])
        kn = [known1[i] for i in range(a, b + 1)]
        n = len(seg)
        p = pos[k]
        if p is None:
            print("[%4d..%4d] n=%3d NO-ALIGNMENT" % (a, b, n))
            continue
        nknown = sum(kn)
        sc = sum(1 for j in range(n) if kn[j] and seg[j] == enc[p + j])
        j0 = p * 3 // 4
        j1 = (p + n) * 3 // 4
        ctx = twj[max(0, j0 - 15):j1 + 15]
        diffs = [(chr(seg[j]), chr(enc[p + j])) for j in range(n)
                 if kn[j] and seg[j] != enc[p + j]]
        tag = ""
        if sc < nknown:
            tag = " SUBS:%r" % (diffs[:8],)
        unk_here = [a + j for j in range(n) if not kn[j]]
        unk_positions += unk_here
        sub_positions += [a + j for j in range(n) if kn[j] and seg[j] != enc[p + j]]
        print("[%4d..%4d] n=%3d enc@%4d..%4d json[%4d:%4d] %d/%d%s unk=%d" %
              (a, b, n, p, p + n, j0, j1, sc, nknown, tag, len(unk_here)))
        print("      json ctx: %r" % ctx[:110])

    print("\nsubstituted known positions:", len(sub_positions))
    print("unknown (dict-copy) positions:", len(unk_positions))


if __name__ == "__main__":
    main()
