#!/usr/bin/env python3
"""Generic FlatBuffers tree dumper for H90 captures (schema-less walk)."""
import struct
import sys


def u32(b, o):
    return struct.unpack_from("<I", b, o)[0]


def i32(b, o):
    return struct.unpack_from("<i", b, o)[0]


def i16(b, o):
    return struct.unpack_from("<h", b, o)[0]


def u16(b, o):
    return struct.unpack_from("<H", b, o)[0]


def f32(b, o):
    return struct.unpack_from("<f", b, o)[0]


class FB:
    def __init__(self, buf):
        self.buf = buf

    def table(self, pos, depth=0, out=None, path=""):
        """Walk a table at pos; yield (path, type, value) tuples."""
        if out is None:
            out = []
        if depth > 10 or pos + 4 > len(self.buf):
            return out
        vt_rel = i32(self.buf, pos)
        if vt_rel == 0:
            return out
        vtabs = pos - vt_rel
        if vtabs < 0 or vtabs + 4 > len(self.buf):
            return out
        vtsize = u16(self.buf, vtabs)
        tsize = u16(self.buf, vtabs + 2)
        nfields = max(0, (vtsize - 4) // 2)
        for fi in range(nfields):
            off = u16(self.buf, vtabs + 4 + fi * 2)
            if off == 0:
                continue
            fpos = pos + off
            p2 = "%s.f%d" % (path, fi)
            self.field(fpos, fi, depth, out, p2)
        return out

    def field(self, fpos, fi, depth, out, p2):
        buf = self.buf
        # heuristics: try scalar first (4B), then offset-indirect
        val32 = u32(buf, fpos)
        # indirect: uoffset -> table/string/vector
        tgt = fpos + val32
        is_offset = False
        if val32 != 0 and tgt + 4 <= len(buf):
            # string? length-prefixed ascii
            n = u32(buf, tgt)
            if 0 < n < 4096 and tgt + 4 + n <= len(buf):
                s = buf[tgt + 4:tgt + 4 + n]
                if all(32 <= c < 127 or c in (9, 10, 13) for c in s):
                    out.append((p2, "string", s.decode()))
                    is_offset = True
            # vector?
            if not is_offset:
                cnt = u32(buf, tgt)
                if 0 < cnt < 10000 and tgt + 4 + cnt * 4 <= len(buf):
                    # vector of offsets (tables/strings): first elem small uoffset
                    e0 = u32(buf, tgt + 4)
                    if 0 < e0 <= tgt + 4 - (tgt + 4) + cnt * 4 + len(buf):
                        out.append((p2, "vector", (tgt, cnt)))
                        is_offset = True
        if not is_offset:
            # scalars: dump several interpretations
            out.append((p2, "scalar", {
                "u32": val32,
                "i32": i32(buf, fpos),
                "f32": round(f32(buf, fpos), 7),
            }))

    def vec_elem(self, vpos, idx):
        """Element of a vector at vpos (after count): try table/string."""
        buf = self.buf
        epos = vpos + 4 + idx * 4
        rel = u32(buf, epos)
        if rel == 0:
            return None
        tgt = epos + rel
        # string?
        n = u32(buf, tgt)
        if 0 < n < 4096 and tgt + 4 + n <= len(buf):
            s = buf[tgt + 4:tgt + 4 + n]
            if all(32 <= c < 127 or c in (9, 10, 13) for c in s):
                return ("string", s.decode())
        return ("table", tgt)

    def dump(self, root=0, maxdepth=6):
        root_pos = u32(self.buf, root)
        self.walk_table(root_pos, "root", 0, maxdepth)

    def walk_table(self, pos, path, depth, maxdepth):
        if depth > maxdepth or pos + 4 > len(self.buf):
            return
        vt_rel = i32(self.buf, pos)
        if vt_rel == 0:
            return
        vtabs = pos - vt_rel
        if vtabs < 0 or vtabs + 4 > len(self.buf):
            return
        vtsize = u16(self.buf, vtabs)
        tsize = u16(self.buf, vtabs + 2)
        nfields = max(0, (vtsize - 4) // 2)
        ind = "  " * depth
        print("%s%s @%d vtsize=%d tsize=%d nf=%d" % (ind, path, pos, vtsize, tsize, nfields))
        for fi in range(nfields):
            off = u16(self.buf, vtabs + 4 + fi * 2)
            if off == 0:
                continue
            fpos = pos + off
            p2 = "%s.f%d" % (path, fi)
            val32 = u32(self.buf, fpos)
            if val32 == 0:
                print("%s%s = 0" % (ind, p2))
                continue
            tgt = fpos + val32
            handled = False
            if tgt + 4 <= len(self.buf):
                n = u32(self.buf, tgt)
                if 0 < n < 8192 and tgt + 4 + n <= len(self.buf):
                    s = self.buf[tgt + 4:tgt + 4 + n]
                    printable = sum(1 for c in s if 32 <= c < 127 or c in (9, 10, 13))
                    if printable >= len(s) * 0.95:
                        show = s[:80].decode("ascii", "replace")
                        print("%s%s = string(%d) %r%s" % (ind, p2, n, show,
                                                          "..." if n > 80 else ""))
                        handled = True
                if not handled and 0 < n < 100000 and tgt + 4 + n * 4 <= len(self.buf):
                    cnt = n
                    ok = 0
                    for i in range(min(cnt, 8)):
                        erel = u32(self.buf, tgt + 4 + i * 4)
                        et = tgt + 4 + i * 4 + erel
                        if 0 < erel <= len(self.buf) and et < len(self.buf):
                            ok += 1
                    if cnt and ok == min(cnt, 8):
                        kind = "vector"
                    else:
                        kind = "?"
                    if kind == "vector":
                        print("%s%s = vector(%d) @%d" % (ind, p2, cnt, tgt))
                        if depth < maxdepth:
                            for i in range(min(cnt, 64)):
                                el = self.vec_elem(tgt, i)
                                if el is None:
                                    continue
                                if el[0] == "string":
                                    print("%s  [%d] string %r" % (ind, i, el[1][:60]))
                                else:
                                    self.walk_table(el[1], "%s[%d]" % (p2, i),
                                                    depth + 1, maxdepth)
                        handled = True
            if not handled:
                print("%s%s = scalar u32=%d i32=%d f32=%r" %
                      (ind, p2, val32, i32(self.buf, fpos),
                       round(f32(self.buf, fpos), 7)))


if __name__ == "__main__":
    data = open(sys.argv[1] if len(sys.argv) > 1 else
                "server/h90-recon/preset90_twoway.bin", "rb").read()
    print("file size:", len(data))
    fb = FB(data)
    fb.dump()
