#!/usr/bin/env python3
"""Decode Eventide H90 TRPC SysEx frames.

Frame:  F0 1C 77 00  <f4> <f5> <f6> <f7>  <body...>  F7
        prefix  │    └── 4 x 7-bit header ──┘  └─ body ─┘
Header: two 14-bit fields, high/low split:
        msgid  = (f4 << 7) | f5        (session counter, NOT echoed)
        type   = (f6 << 7) | f7        (low byte 0x02 = device error,
                                        0x34 = success ack)
Known types:  0x03/0x07/0x20-0x28  small flatbuffer commands
              0x13                 preset data dump (zlib FlatBuffer)
              0x25                 OS/software info
              0x4f                 import/export request (host->device)
        Import flow: host sends type 0x4f request (zlib body) ->
                     device replies type 0x13 preset dump -> success ack
                     type 0x34 (references type 0x13 + zero preset UUID
                     00000000-0000-0000-0000-000000000001).
Body:   7-bit packed (8 packed bytes -> 7 raw bytes), optional zlib deflate
        (bodies > 100 B), root FlatBuffers uoffset = 12.

Usage:
  h90_decode.py FRAME.hex           one space-free hex frame
  h90_decode.py -f capture.txt      parse RX lines from a capture file
"""

import sys
import re
import zlib
import struct


def unpack_7bit(packed: bytes) -> bytes:
    """MIDI SysEx 7-bit packing: 8 packed bytes -> 7 raw bytes (LSB-first).

    Handles a trailing partial group: decode only complete raw bytes, ignore
    the leftover padding bits.
    """
    out = bytearray()
    for i in range(0, len(packed) - 7, 8):
        p = packed[i:i + 8]
        out.append(p[0] | ((p[1] & 1) << 7))
        out.append((p[1] >> 1) | ((p[2] & 3) << 6))
        out.append((p[2] >> 2) | ((p[3] & 7) << 5))
        out.append((p[3] >> 3) | ((p[4] & 15) << 4))
        out.append((p[4] >> 4) | ((p[5] & 31) << 3))
        out.append((p[5] >> 5) | ((p[6] & 63) << 2))
        out.append((p[6] >> 6) | (p[7] << 1))
    # trailing partial group (< 8 bytes): bit-stream decode whole raw bytes
    rem = len(packed) % 8
    if rem >= 1:
        bits = []
        for b in packed[len(packed) - rem:]:
            for k in range(7):
                bits.append((b >> k) & 1)
        for i in range(0, len(bits) - 7, 8):
            v = 0
            for k in range(8):
                v |= bits[i + k] << k
            if v <= 0xFF:
                out.append(v)
    return bytes(out)


def pack_7bit(raw: bytes) -> bytes:
    """Inverse of unpack_7bit: 7 raw bytes -> 8 packed bytes."""
    out = bytearray()
    for i in range(0, len(raw) - 6, 7):
        d = raw[i:i + 7]
        out.append(d[0] & 0x7F)
        out.append(((d[0] >> 7) & 1) | ((d[1] & 0x3F) << 1))
        out.append(((d[1] >> 6) & 3) | ((d[2] & 0x1F) << 2))
        out.append(((d[2] >> 5) & 7) | ((d[3] & 0x0F) << 3))
        out.append(((d[3] >> 4) & 15) | ((d[4] & 0x07) << 4))
        out.append(((d[4] >> 3) & 31) | ((d[5] & 0x03) << 5))
        out.append(((d[5] >> 2) & 63) | ((d[6] & 0x01) << 6))
        out.append((d[6] >> 1) & 0x7F)
    return bytes(out)


def try_zlib(data: bytes):
    """Return (payload, mode) if data decompresses as zlib/deflate, else None."""
    if data.startswith(b"\x78"):
        for wbits in (15, -15):
            try:
                return zlib.decompress(data, wbits), "zlib"
            except zlib.error:
                pass
    return None


def walk_flatbuffers(buf: bytes, max_depth: int = 8):
    """Best-effort FlatBuffers root walk: print vtable/field table summary."""
    if len(buf) < 4:
        return
    root = struct.unpack_from("<I", buf, 0)[0]
    print(f"      fb root uoffset = {root}")
    if root + 4 > len(buf):
        return
    vt = struct.unpack_from("<I", buf, root)[0]
    if vt + 4 > len(buf):
        return
    vtabs = root + 4 - vt
    vtsize, table_size = struct.unpack_from("<HH", buf, vtabs)
    print(f"      fb vtable @{vtabs} size={vtsize} table_size={table_size}")
    nfields = (vtsize - 4) // 2
    for i in range(min(nfields, 24)):
        off = struct.unpack_from("<H", buf, vtabs + 4 + i * 2)[0]
        if off == 0:
            continue
        fpos = root + off
        if fpos + 4 <= len(buf):
            val = struct.unpack_from("<I", buf, fpos)[0]
            print(f"      fb field[{i}] off={off} u32={val} 0x{val:x}")


def decode_frame(f: bytes, name: str = ""):
    print(f"=== {name} len={len(f)}")
    if not f.startswith(b"\xF0\x1C\x77\x00"):
        print("  NOT an H90 TRPC frame (prefix mismatch)")
        return
    if not f.endswith(b"\xF7"):
        print("  missing F7 terminator")
    hdr = f[4:8]
    msgid = (hdr[0] << 7) | hdr[1]
    mtype = (hdr[2] << 7) | hdr[3]
    body = f[8:-1] if f.endswith(b"\xF7") else f[8:]
    print(f"  header = {hdr.hex(' ')}  msgid=0x{msgid:x}({msgid})  type=0x{mtype:x}({mtype})"
          f"  status={'OK' if mtype == 0x34 else 'ERR' if mtype == 0x02 else '?'}")
    print(f"  body   = {len(body)} bytes (7-bit packed), first8={body[:8].hex(' ')}")
    if len(body) == 0:
        return
    raw = unpack_7bit(body)
    print(f"  unpacked = {len(raw)} bytes, first8={raw[:8].hex(' ')}")
    if raw.startswith(b"\x78"):
        z = try_zlib(raw)
        if z:
            payload, mode = z
            print(f"  -> {mode} inflate -> {len(payload)} bytes, first12={payload[:12].hex(' ')}")
            walk_flatbuffers(payload)
            preset_name(payload)
            return
    walk_flatbuffers(raw)
    preset_name(raw)


def preset_name(buf: bytes):
    """Best-effort preset identity: printable runs in the tail (name + 3 UUIDs)."""
    runs = []
    cur = bytearray()
    for i, b in enumerate(buf[-300:]):
        if 32 <= b < 127:
            cur.append(b)
        else:
            if len(cur) >= 4:
                runs.append(cur.decode("ascii", "replace"))
            cur.clear()
    if cur and len(cur) >= 4:
        runs.append(cur.decode("ascii", "replace"))
    if len(runs) >= 2:
        print(f"  tail strings = {runs[-3:] if len(runs) >= 3 else runs}")


def load_frames_from_log(path: str):
    """Extract complete F0..F7 frames from a capture log (RX/TX lines)."""
    text = open(path, "rb").read().replace(b"\x00", b"")
    try:
        text = text.decode("utf-8", errors="replace")
    except Exception:
        text = text.decode("latin1", errors="replace")
    frames = []
    for m in re.finditer(r"([0-9A-Fa-f]{2})\s*(?:[0-9A-Fa-f]{2}\s*)*", text):
        pass
    # simpler: grab every hex run, merge continuation lines
    cur = bytearray()
    for line in text.split("\n"):
        mm = re.match(r"^(?:RX|TX) \d{4}-\d\d-\d\d [\d:]+ [+-]\d{4}\s+([0-9A-Fa-f]+)$", line.strip())
        if not mm:
            continue
        h = mm.group(1).replace(" ", "")
        try:
            b = bytes.fromhex(h)
        except ValueError:
            continue
        if not cur:
            cur.extend(b)
        elif cur and not b.startswith(b"\xF0"):
            cur.extend(b)
        if b and b[-1] == 0xF7:
            frames.append(bytes(cur))
            cur = bytearray()
    return frames


def main():
    args = sys.argv[1:]
    if args and args[0] == "-f":
        frames = load_frames_from_log(args[1])
        print(f"loaded {len(frames)} frames from {args[1]}")
        for i, f in enumerate(frames):
            decode_frame(f, f"frame[{i}]")
    else:
        h = args[0].replace(" ", "").replace("0x", "")
        decode_frame(bytes.fromhex(h), "frame")


if __name__ == "__main__":
    main()
