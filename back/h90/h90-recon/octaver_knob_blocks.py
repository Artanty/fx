import struct, io, os, json

src = r'C:/server/fx/input/User 2.lst90'
b = open(src, 'rb').read()

def f(o): return struct.unpack('<f', b[o:o+4])[0]
ONE = b'\x00\x00\x80\x3f'

# Find all five knob-blocks for MASSIVUZZ (offsets from earlier)
block_offsets = [6960, 7024, 7088, 8372, 8436]
out = io.open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
              'octaver_knob_blocks.txt'), 'w', encoding='utf-8')

for off in block_offsets:
    te = b.index(b'\x00', off)   # end of 'tjknobs-knobN'
    tag = b[off:te].decode()
    d = te + 3
    first = struct.unpack('<i', b[d:d+4])[0]
    if first == 7:
        kind = 'COMPOSITE(7)'
        seg = b[d:d+48]
        offsets = struct.unpack('<7i', b[d+4:d+4+28])
        out.write('\n%s @%d tag=%s COMPOSITE first=%d offsets=%s\n' % (kind, off, tag, first, offsets))
    else:
        kind = 'simple'
        # find first '00 00 80 3f' (1.0) after data start
        idx = b.find(ONE, d, d+64)
        if idx >= 0:
            f1 = f(idx+4); f2 = f(idx+8)
            out.write('\n%s @%d tag=%s SIMPLE  1.0@%d  f1=%.7f f2=%.7f\n' % (kind, off, tag, idx, f1, f2))
        else:
            out.write('\n%s @%d tag=%s SIMPLE  (no 1.0 marker)\n' % (kind, off, tag))

out.write('\n\nJSON ref (MASSIVUZZ):\n')
j = json.load(open(r'C:/server/fx/server/h90-recon/lst90_json/02_MASSIVUZZ.json'))
for key in ['atck','sens','fuzz','fzmx','fzmx_start_exp','fzmx_end_exp','flta','fltb',
            'resa','resb','mmix','pmix','pmix_start_exp','pmix_end_exp','fuzz_start_exp',
            'fuzz_end_exp','in1_sens','in2_sens','out1_sens','out2_sens','preset_mix','killdry']:
    out.write('  %-16s = %r\n' % (key, j.get(key)))
out.close()
print('done')
