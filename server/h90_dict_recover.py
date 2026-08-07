#!/usr/bin/env python3
"""DEFLATE decoder with LZ77 match tracking for H90 import-dictionary recovery.

Decodes a raw DEFLATE stream (no zlib header) with an optional preset
dictionary (zdict), and unlike zlib it records the exact LZ77 symbol stream
(literals vs length/distance matches) plus, for every output byte, whether it
was copied directly from the dictionary and from which dict offset.

This lets us recover the runtime dictionary the H90 Control app uses to
raw-deflate import write payloads (see H90-IMPORT-NOTES.md).

Usage:
  h90_dict_recover.py track <raw-deflate.bin> [--zdict <dict.bin>]
      decode and print the symbol summary
  h90_dict_recover.py dictrefs <raw-deflate.bin> [--zdict <dict.bin>]
      print output-offset -> dict-offset mappings (json to stdout)
"""

import sys
import json

# ---- length / distance tables (RFC 1951, zlib length_base/extra) ----
LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35,
               43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3,
                4, 4, 4, 4, 5, 5, 5, 5, 0]

DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257,
             385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289,
             16385, 24577]
DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9,
              9, 10, 10, 11, 11, 12, 12, 13, 13]

CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]


class DeflateError(Exception):
    pass


class EndOfInput(Exception):
    """Ran out of compressed input bits mid-symbol (stream truncated).

    Mirrors zlib's partial-output + eof=False behaviour: deflate_track() catches
    this and returns whatever has been decoded so far.
    """


class BitReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def read(self, n):
        v = 0
        for i in range(n):
            if self.pos >> 3 >= len(self.data):
                raise EndOfInput(f"input exhausted at bit {self.pos}")
            byte = self.data[self.pos >> 3]
            v |= ((byte >> (self.pos & 7)) & 1) << i
            self.pos += 1
        return v

    def read_align(self, n):
        self.pos = (self.pos + 7) & ~7
        return self.read(n)

    def byte_pos(self):
        return self.pos >> 3


def build_huffman(lengths):
    """Canonical Huffman decode table from code-length list."""
    max_bits = max(lengths) if lengths else 0
    bl_count = [0] * (max_bits + 1)
    for l in lengths:
        if l:
            bl_count[l] += 1
    next_code = [0] * (max_bits + 1)
    code = 0
    for bits in range(1, max_bits + 1):
        code = (code + bl_count[bits - 1]) << 1
        next_code[bits] = code
    table = {}
    for sym, l in enumerate(lengths):
        if l:
            table[(next_code[l], l)] = sym
            next_code[l] += 1
    return table, max_bits


def decode_symbol(br, table, max_bits):
    code = 0
    for bits in range(1, max_bits + 1):
        code = (code << 1) | br.read(1)
        hit = table.get((code, bits))
        if hit is not None:
            return hit
    raise DeflateError("invalid huffman code")


def fixed_tables():
    lengths = [8] * 144 + [9] * 112 + [7] * 24 + [8] * 8
    lt, lt_max = build_huffman(lengths)
    dist_lengths = [5] * 32
    dt, dt_max = build_huffman(dist_lengths)
    return lt, lt_max, dt, dt_max


def dynamic_tables(br):
    hlit = br.read(5) + 257
    hdist = br.read(5) + 1
    hclen = br.read(4) + 4
    cl_lengths = [0] * 19
    for i in range(hclen):
        cl_lengths[CLEN_ORDER[i]] = br.read(3)
    cl_table, cl_max = build_huffman(cl_lengths)

    all_lengths = []
    while len(all_lengths) < hlit + hdist:
        sym = decode_symbol(br, cl_table, cl_max)
        if sym < 16:
            all_lengths.append(sym)
        elif sym == 16:
            if not all_lengths:
                raise DeflateError("repeat code with no previous length")
            prev = all_lengths[-1]
            all_lengths.extend([prev] * (br.read(2) + 3))
        elif sym == 17:
            all_lengths.extend([0] * (br.read(3) + 3))
        elif sym == 18:
            all_lengths.extend([0] * (br.read(7) + 11))
    if len(all_lengths) > hlit + hdist:
        raise DeflateError("code lengths overflow")
    lit_lengths = all_lengths[:hlit]
    dist_lengths = all_lengths[hlit:]
    lt, lt_max = build_huffman(lit_lengths)
    dt, dt_max = build_huffman(dist_lengths)
    return lt, lt_max, dt, dt_max


def deflate_track(data, zdict=b""):
    """Decode raw DEFLATE `data` with dictionary `zdict`.

    Returns (output, src, symbols) where
      output : bytes  (decoded payload; may be partial if the deflate stream is
               truncated without a final block, matching zlib's partial-output /
               eof=False behaviour)
      src    : list per output byte: ("lit",) or ("copy", abs_pos)
               abs_pos is the position in the combined (zdict ++ output) stream
               from which the byte was copied.
      symbols: list of ("lit", byte) / ("copy", length, distance, out_pos)
    """
    br = BitReader(data)
    window = bytearray(zdict)
    dict_len = len(zdict)
    out = bytearray()
    src = []
    symbols = []
    lt_fix, lt_fix_max, dt_fix, dt_fix_max = fixed_tables()
    eof = False
    try:
        while not eof:
            bfinal = br.read(1)
            btype = br.read(2)
            if btype == 0:
                br.read_align(0)
                length = br.read(16)
                nlen = br.read(16)
                if (~length & 0xFFFF) != nlen:
                    raise DeflateError("stored block LEN/NLEN mismatch")
                for _ in range(length):
                    b = br.read(8)
                    out.append(b)
                    window.append(b)
                    src.append(("lit",))
                symbols.append(("stored", length))
            elif btype == 1:
                lt, lt_max = lt_fix, lt_fix_max
                dt, dt_max = dt_fix, dt_fix_max
            elif btype == 2:
                lt, lt_max, dt, dt_max = dynamic_tables(br)
            else:
                raise DeflateError("invalid block type")

            if btype != 0:
                while True:
                    sym = decode_symbol(br, lt, lt_max)
                    if sym < 256:
                        out.append(sym)
                        window.append(sym)
                        src.append(("lit",))
                        symbols.append(("lit", sym))
                    elif sym == 256:
                        break
                    else:
                        li = sym - 257
                        length = LENGTH_BASE[li] + br.read(LENGTH_EXTRA[li])
                        dsym = decode_symbol(br, dt, dt_max)
                        if dsym >= 30:
                            raise DeflateError("invalid distance code")
                        dist = DIST_BASE[dsym] + br.read(DIST_EXTRA[dsym])
                        out_pos = len(out)
                        symbols.append(("copy", length, dist, out_pos))
                        ref_start = len(window) - dist
                        if ref_start < 0:
                            raise DeflateError(
                                f"distance too far back: dist={dist} at out {out_pos}")
                        for j in range(length):
                            abs_pos = ref_start + j
                            b = window[abs_pos]
                            src.append(("copy", abs_pos))
                            out.append(b)
                            window.append(b)
            eof = bfinal
    except EndOfInput:
        pass
    return bytes(out), src, symbols


def dict_refs(output, src, dict_len):
    """Map dict offset -> output position (and byte value, if literal-derived).

    Returns (refs, direct_offsets, dependent_out):
      refs: list of (out_pos, dict_offset) direct references
    """
    refs = []
    direct = set()
    depend = set()
    for pos, s in enumerate(src):
        if s[0] == "copy":
            abs_pos = s[1]
            if abs_pos < dict_len:
                refs.append((pos, abs_pos))
                direct.add(abs_pos)
                depend.add(pos)
    # transitive: output bytes copied from dict-derived output
    derived = set(depend)
    changed = True
    while changed:
        changed = False
        for pos, s in enumerate(src):
            if pos in derived:
                continue
            if s[0] == "copy":
                abs_pos = s[1]
                if abs_pos >= dict_len and (abs_pos - dict_len) in derived:
                    derived.add(pos)
                    changed = True
    return refs, direct, derived


def main():
    args = sys.argv[1:]
    if not args:
        print(__doc__)
        return
    cmd = args[0]
    path = args[1]
    zdict = b"\x00" * 32768
    if "--zdict" in args:
        zdict = open(args[args.index("--zdict") + 1], "rb").read()
    data = open(path, "rb").read()
    out, src, symbols = deflate_track(data, zdict)
    if cmd == "track":
        n_lit = sum(1 for s in symbols if s[0] == "lit")
        n_copy = sum(1 for s in symbols if s[0] == "copy")
        n_stored = sum(1 for s in symbols if s[0] == "stored")
        refs, direct, depend = dict_refs(out, src, len(zdict))
        print(f"decoded {len(out)} bytes ({len(data)} in, {len(symbols)} symbols)")
        print(f"  literals={n_lit} copies={n_copy} stored_blocks={n_stored}")
        print(f"  dict refs={len(refs)} direct dict offsets={len(direct)} "
              f"transitively dict-dependent output={len(depend)}")
        for off in sorted(direct)[:10]:
            print(f"    dict offset {off} (0x{off:x})")
        if direct:
            print(f"    dict offset range {min(direct)}..{max(direct)}")
        return out.hex()
    elif cmd == "dictrefs":
        refs, direct, depend = dict_refs(out, src, len(zdict))
        print(json.dumps({
            "input": path,
            "zdict_len": len(zdict),
            "out_len": len(out),
            "refs": [[p, o] for p, o in refs],
            "direct_offsets": sorted(direct),
            "dependent_out": sorted(depend),
        }))
        return
    else:
        print(f"unknown command {cmd!r}")
        return


if __name__ == "__main__":
    main()
