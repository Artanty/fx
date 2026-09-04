import struct, io, os

src = r'C:/server/fx/input/User 2.lst90'

def f32(x):
    return struct.unpack('<f', x)[0]

def main():
    b = open(src, 'rb').read()
    out = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'octaver_decode.txt'),
                  'w', encoding='utf-8')

    # MASSIVUZZ octaver record pre-json: knob blocks at 6972(knob3),7036(knob4),7100(knob9)
    # post-json: 8380(knob4),8444(knob3)
    blocks = [
        ('pre knob3', 6972),
        ('pre knob4', 7036),
        ('pre knob9', 7100),
        ('post knob4', 8380),
        ('post knob3', 8444),
    ]
    for label, off in blocks:
        # tag
        tag_start = b.index(b'tjknobs-knob', off)
        tag_end = b.index(b'\x00', tag_start)
        tag = b[tag_start:tag_end].decode()
        # data follows tag + 3 zeros
        d = tag_end + 3
        nxt = struct.unpack('<i', b[d:d+4])[0]
        out.write('\n=== %s (off %d, tag=%s) data@%d next_word=%d ===\n' % (label, off, tag, d, nxt))
        # dump 40 bytes
        out.write('  raw: %s\n' % b[d:d+48].hex(' '))
        if nxt == 7 or nxt == 6 or (nxt > 1000 and nxt & 0xffff0000 in (0xffff0000,)):
            out.write('  (offset-table node)\n')
        else:
            # simple block: parse tail floats
            # find the two 4-byte floats near the end. The simple blocks end: ... 80 3f <f1> <f2>
            # search last ~24 bytes for a run
            seg = b[d:d+48]
            out.write('  ascii: %r\n' % seg)

    # Decode the "simple" pre-knob3 float tail fully
    out.write('\n\n===== deep decode of simple knob tails =====\n')
    # knob3 at 6972: header ends after ff ff ff ff 00 02 00 00 00 00 00 00 00 00 80 3f (15 bytes)
    # then two floats
    simple = [
        ('pre knob3', 6972, 0),
        ('pre knob4', 7036, 0),
        ('post knob4', 8380, 0),
        ('post knob3(composite?)', 8444, 1),
    ]
    for label, off, iscomp in simple:
        ts = b.index(b'tjknobs-knob', off)
        te = b.index(b'\x00', ts)
        d = te + 3
        if not iscomp:
            # skip nxt(4)=ptr, then 28 00 00 00 ... let's parse the fixed 40-byte header
            # header: ptr(4) + 11 words + 3 bytes? Let's just find the last '80 3f' then 2 floats
            blk = b[d:d+52]
            hi = blk.rfind(b'\x00\x00\x80\x3f')
            f1 = f32(blk[hi+4:hi+8])
            f2 = f32(blk[hi+8:hi+12])
            out.write('%s: header_80_3f@%d f1=%.6f f2=%.6f\n' % (label, hi, f1, f2))
        else:
            out.write('%s: composite, skip\n' % label)
    out.close()
    print('done')

main()
