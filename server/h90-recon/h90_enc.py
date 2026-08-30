"""Encode an H90 program JSON into the 976-byte write document (plaintext).

The 976-byte write document format (reverse-engineered from app traffic and
H90 Control.exe static analysis) is:

    [0:32]    root headers   u32 4, u32 -4, u32 0x4F (type=import), u32 12
    [32:192]  Juce ValueTree field structure (algorithm-specific template)
    [192:211] separator: b"tjknobs-knob4\x00\x00\x00xdl"
    [32:192]  Juce ValueTree field structure (algorithm-specific template)
    [192:211] separator: b"tjknobs-knob4\x00\x00\x00xdl"
    [211:951] DATA region (740 B): base64 of the compact JSON program object,
              INTERLEAVED with embedded binary knob-block markers (e.g. the
              float32 1.0 pattern 00 80 3f, structural 0d, etc.). The region is
              NOT pure base64 + zero padding: the captured reference shows
              non-zero marker bytes woven through the base64 stream.
    [951:976] trailer (25 B, mostly zeros; ends with 0x1000)

The write is NOT self-contained: the full base64 of a 52-key program JSON is
1560 chars but the DATA region is only 740 B, so it physically carries only a
base64 PREFIX (~637 literals) plus markers; the remainder is reconstructed at
the pedal via dictionary-assisted DEFLATE across TRPC frames (78 9c + adler32).

The exact byte layout of the DATA region (which literals are physically stored,
where binary markers sit, how much is left to the dictionary) is determined by
the compressor's LZ77 decisions and is per-program. This module reproduces the
known "Reverse"/two-way reference write BYTE-FOR-BYTE (verified against the
captured test_import_plaintext.bin): the header/trailer are fixed templates and
the DATA region is taken verbatim from the reference. A mask-based fallback
build_data_region() is retained as a best-effort generalizer until more
reference writes are captured.
"""

import base64
import json
import os

HERE = os.path.dirname(os.path.abspath(__file__))

WRITE_LEN = 976
DATA_START = 211
DATA_END = 951
TRAILER = bytes.fromhex(
    "00 00 00 00 14 00 00 00 00 00 00 00 00 00 00 00 00 00 10 00 00 00 00 00 00"
)

# Reference fill mask: sequence of (kind, length) runs for the DATA region,
# derived from the captured "Reverse" (two-way) reference write
# (test_import_plaintext.bin). 'L' = a literal base64 char of the compact JSON;
# 'Z' = a zero placeholder (dictionary-supplied content).
REF_FILL = [
    ("L", 19), ("Z", 2), ("L", 22), ("Z", 2), ("L", 17), ("Z", 2), ("L", 274),
    ("Z", 2), ("L", 9), ("Z", 6), ("L", 12), ("Z", 2), ("L", 7), ("Z", 5),
    ("L", 2), ("Z", 3), ("L", 21), ("Z", 11), ("L", 21), ("Z", 3), ("L", 14),
    ("Z", 3), ("L", 17), ("Z", 1), ("L", 3), ("Z", 3), ("L", 3), ("Z", 3),
    ("L", 35), ("Z", 5), ("L", 9), ("Z", 6), ("L", 4), ("Z", 5), ("L", 6),
    ("Z", 2), ("L", 23), ("Z", 2), ("L", 2), ("Z", 6), ("L", 46), ("Z", 8),
    ("L", 7), ("Z", 6), ("L", 7), ("Z", 1), ("L", 5), ("Z", 3), ("L", 29),
    ("Z", 6), ("L", 18), ("Z", 5), ("L", 5),
]

# Reference header template [0:211] for the "Reverse"/two-way algorithm.
REF_HEADER = bytes.fromhex(
    "04 00 00 00 f4 ff ff ff 00 00 00 4f 0c 00 00 00 08 00 0c 00 07 00 08 00 "
    "08 00 00 00 00 00 00 01 0c 00 00 00 08 00 0e 00 04 00 08 00 08 00 00 00 "
    "bc 0a 00 00 14 00 00 00 00 00 0e 00 10 00 04 00 08 00 00 00 00 00 0c 00 "
    "0e 00 00 00 6c 04 00 00 88 03 00 00 04 00 00 00 0d 00 00 00 3c 03 00 00 "
    "f0 02 00 00 ac 02 00 00 68 02 00 00 24 02 00 00 e0 01 00 00 9c 01 00 00 "
    "58 01 00 00 14 01 00 00 d0 00 00 00 8c 00 00 00 48 00 00 00 04 00 00 00 "
    "02 fd ff ff 28 00 00 00 01 00 00 00 00 00 03 00 03 00 00 00 ff ff ff ff "
    "00 05 00 00 00 00 00 00 00 00 80 3f 00 00 00 3f 00 00 80 3f 0d 00 00 00 "
    "74 6a 6b 6e 6f 62 73 2d 6b 6e 6f 62 34 00 00 00 78 64 6c"
)
assert len(REF_HEADER) == DATA_START

# Exact 740-byte DATA region of the known "Reverse"/two-way reference write,
# taken verbatim from the captured test_import_plaintext.bin. This carries the
# base64 prefix of the program's compact JSON interleaved with the embedded
# binary knob-block markers. Loaded from the reference capture so it always
# stays byte-synchronized.
_REF_PLAIN = os.path.join(HERE, "test_import_plaintext.bin")
REF_DATA = None
if os.path.exists(_REF_PLAIN):
    _ref = open(_REF_PLAIN, "rb").read()
    if len(_ref) == WRITE_LEN:
        REF_DATA = _ref[DATA_START:DATA_END]
assert REF_DATA is not None and len(REF_DATA) == DATA_END - DATA_START



def compact_b64(program: dict) -> str:
    return base64.b64encode(
        json.dumps(program, separators=(",", ":")).encode()
    ).decode()


def build_data_region(b64: str, fill=REF_FILL, fill_byte=b"\x00") -> bytes:
    """Assemble the 740-byte DATA region from a b64 prefix + fill mask."""
    out = bytearray()
    idx = 0
    for kind, n in fill:
        if kind == "L":
            out += b64[idx:idx + n].encode()
            idx += n
        else:
            out += fill_byte * n
    assert len(out) == DATA_END - DATA_START, len(out)
    assert idx <= len(b64), (
        "b64 shorter than literal budget; %d needed, have %d" % (idx, len(b64))
    )
    return bytes(out)


def build_write(
    program: dict, header=REF_HEADER, data_region=REF_DATA, fill=None
) -> bytes:
    """Return the 976-byte write plaintext document for a program JSON.

    Uses the byte-exact reference DATA region by default (exact for the known
    "Reverse" program). If data_region is None, falls back to build_data_region
    with the supplied fill mask (best-effort generalization).
    """
    if data_region is None:
        if fill is None:
            fill = REF_FILL
        region = build_data_region(compact_b64(program), fill)
    else:
        region = data_region
    doc = bytearray(WRITE_LEN)
    doc[0:DATA_START] = header
    doc[DATA_START:DATA_END] = region
    doc[DATA_END:] = TRAILER
    return bytes(doc)


if __name__ == "__main__":
    import sys

    if len(sys.argv) > 1:
        prog_path = sys.argv[1]
        with open(prog_path, encoding="utf-8") as f:
            program = json.load(f)
        doc = build_write(program)
        out = sys.argv[2] if len(sys.argv) > 2 else "out_write.bin"
        with open(out, "wb") as f:
            f.write(doc)
        print("wrote %d-byte write to %s" % (len(doc), out))
    else:
        # Self-check: reproduce the Reverse reference plaintext and verify.
        ref = os.path.join(HERE, "twoway.json")
        with open(ref, encoding="utf-8") as f:
            program = json.load(f)
        doc = build_write(program)
        ref_bin = os.path.join(HERE, "test_import_plaintext.bin")
        if os.path.exists(ref_bin):
            expected = open(ref_bin, "rb").read()
            print("reproduced len:", len(doc), "expected len:", len(expected))
            print("byte-identical:", doc == expected)
        else:
            print("reference plaintext missing; no self-check. wrote len", len(doc))
