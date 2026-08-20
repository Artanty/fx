#!/usr/bin/env python3
"""Extract ASCII strings from H90 Control.exe .rdata and filter for compress terms."""
import re

BIN = r"C:\Program Files\Eventide\H90 Control.exe"
PAT = re.compile(rb"[\x20-\x7e]{5,}")

with open(BIN, "rb") as f:
    data = f.read()

# .rdata from PE header
import struct

e_lfanew = struct.unpack_from("<I", data, 0x3C)[0]
nsec = struct.unpack_from("<H", data, e_lfanew + 6)[0]
optsize = struct.unpack_from("<H", data, e_lfanew + 20)[0]
secstart = e_lfanew + 24 + optsize
sections = {}
for i in range(nsec):
    o = secstart + i * 40
    name = data[o:o + 8].rstrip(b"\x00").decode("ascii", "ignore")
    vsize, vaddr, rsize, roff = struct.unpack_from("<IIII", data, o + 8)
    sections[name] = (vaddr, roff, vsize or rsize)

KEYWORDS = (b"deflate", b"inflate", b"gzip", b"zlib", b"compress", b"compress2",
            b"dictionary", b"zdict", b"stream", b"lz77", b"huffman", b"Deflator",
            b"Inflator", b"GZIPCompressor", b"GZIPDecompressor", b"ZLib", b"gzstream")

va_rdata, off_rdata, _ = sections[".rdata"]
blk = data[off_rdata:off_rdata + sections[".rdata"][2]]
lines = []
for m in PAT.finditer(blk):
    s = m.group()
    if any(k in s.lower() for k in (b"deflate", b"inflate", b"gzip", b"zlib", b"compress", b"dict")):
        va = va_rdata + m.start()
        lines.append("%#x  %s" % (va, s.decode("ascii", "ignore")))

with open(r"server\h90_rdata_compress_strings.txt", "w", encoding="utf-8") as f:
    f.write("\n".join(lines))
print("wrote", len(lines), "strings")
