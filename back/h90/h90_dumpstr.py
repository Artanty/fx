#!/usr/bin/env python3
"""Dump printable ASCII runs from H90 Control.exe at given RVAs."""
import struct
import sys

BIN = r"C:\Program Files\Eventide\H90 Control.exe"


def main():
    with open(BIN, "rb") as f:
        data = f.read()
    e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
    nsec = struct.unpack_from("<H", data, e_lfanew + 6)[0]
    optsize = struct.unpack_from("<H", data, e_lfanew + 20)[0]
    secstart = e_lfanew + 24 + optsize
    sections = []
    for i in range(nsec):
        o = secstart + i * 40
        name = data[o:o + 8].rstrip(b"\x00").decode("ascii", "ignore")
        vsize, vaddr, rsize, roff = struct.unpack_from("<IIII", data, o + 8)
        sections.append((name, vaddr, roff, vsize or rsize))

    for arg in sys.argv[1:]:
        rva = int(arg, 16)
        sec = None
        for name, vaddr, roff, size in sections:
            if vaddr <= rva < vaddr + size:
                sec = (name, roff + (rva - vaddr))
                break
        if sec is None:
            print("%#x: not in any section" % rva)
            continue
        name, off = sec
        print("=== %#x (%s @ file off %#x) ===" % (rva, name, off))
        blk = data[off:off + 0x400]
        cur = bytearray()
        curbase = 0
        for i in range(len(blk)):
            b = blk[i]
            if 32 <= b < 127:
                if not cur:
                    curbase = rva + i
                cur.append(b)
            else:
                if cur:
                    print("  %#x  %s" % (curbase, cur.decode()))
                    cur = bytearray()
        if cur:
            print("  %#x  %s" % (curbase, cur.decode()))


if __name__ == "__main__":
    main()
