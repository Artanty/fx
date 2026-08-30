import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = bytearray(open(os.path.join(here, 'req1_out.bin'), 'rb').read())
tw = json.load(open(os.path.join(here, 'twoway.json')))
out = io.open(os.path.join(here, 'fully_reconstructed.txt'), 'w', encoding='utf-8')

tw_compact = json.dumps(tw, separators=(',', ':'))
tw_b64 = base64.b64encode(tw_compact.encode('utf-8')).decode()
out.write('b64(twoway compact) len=%d\n' % len(tw_b64))

# The data region holding the JSON base64 is [211:951] (data1+data2).
# The readable base64 chars in the doc are in-stream; gaps are dict copies.
# Fill gaps greedily from tw_b64 in order: walk doc[211:951]; wherever a doc byte is a b64
# char that matches the next expected tw_b64 char, consume; else if it's a gap (binary/zero),
# replace it with the next expected b64 char.
doc = bytearray(b)
start = 211
end = 951
j = 0  # index into tw_b64
replacements = []
for i in range(start, end):
    if j >= len(tw_b64):
        break
    c = doc[i]
    expected = ord(tw_b64[j])
    isb64 = (65 <= c <= 90) or (97 <= c <= 122) or (48 <= c <= 57) or c in (43, 47, 61)
    if isb64 and c == expected:
        j += 1  # in-stream char matches; keep it, advance
    elif not isb64:
        # gap -> fill with expected b64 char (this is a dict-copy region in the real write)
        doc[i] = expected
        replacements.append(i)
        j += 1
    else:
        # isb64 but mismatch? treat as an already-correct in-stream char from elsewhere; keep as-is
        pass

out.write('filled %d gap/slot positions, consumed %d of %d b64 chars\n' % (len(replacements), j, len(tw_b64)))
out.write('unconsumed b64 chars: %d\n' % (len(tw_b64) - j))

# Save the fully reconstructed plaintext
open(os.path.join(here, 'req1_out_full.bin'), 'wb').write(bytes(doc))
out.write('\nsaved req1_out_full.bin (976 bytes)\n')

# Show the region [190:976] of the filled doc
line = ''
out.write('\n=== filled doc 190:976 ascii ===\n')
for i in range(190, 976):
    c = doc[i]
    ch = chr(c) if 32 <= c < 127 else '.'
    line += ch
    if (i - 190 + 1) % 48 == 0:
        out.write('%4d-%4d  %s\n' % (i - 47, i, line))
        line = ''
if line:
    out.write('%4d-%4d  %s\n' % (976 - len(line), 975, line))
out.close()
print('done')
