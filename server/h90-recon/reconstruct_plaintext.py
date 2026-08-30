import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = bytearray(open(os.path.join(here, 'req1_out.bin'), 'rb').read())
tw = json.load(open(os.path.join(here, 'twoway.json')))
out = io.open(os.path.join(here, 'reconstruct_plaintext.txt'), 'w', encoding='utf-8')

# The intended plaintext: data1 region [211:872] should contain base64(twoway compact).
# Reconstruct by grafting in the base64 stream that belongs to data1.
tw_compact = json.dumps(tw, separators=(',', ':'))
tw_b64 = base64.b64encode(tw_compact.encode('utf-8')).decode()

# Where does the JSON b64 payload start in the doc?  The separator ends "tjknobs-knob4\x00\x00\x00xdl" then "dmVy..." 
# b64 of '{"a' starts with 'eyJ'. Find first b64 char of tw_b64 that appears right after offset 211.
# The doc likely: [211 ...] = b64 stream (with gaps). The start of tw_b64 = 'eyJhbGp...' but we saw 'xdldmVy' at 211 region
# meaning the JSON began earlier. Actually the data1 region [211:872] holds the json. Let's compute the doc's gap positions
# and try to "deinterleave": assume doc[211:872] = interleaving of binary + b64(tw_json). 
# Approach: walk tw_b64; for each char find it sequentially in doc[211:872] possibly with gaps.

def deinterleave(docseg, stream):
    """Match a base64 stream into a doc segment allowing arbitrary gaps; return gap regions filled."""
    match = []
    si = 0
    j = 0
    # find start: first char of stream in docseg
    start = -1
    for idx in range(len(docseg)):
        if docseg[idx] == stream[0]:
            start = idx
            break
    # greedy
    pos = 0
    filled = bytearray(docseg)
    j = 0
    for idx in range(start, len(docseg)):
        if j < len(stream) and docseg[idx] == ord(stream[j]):
            j += 1
    return start, j

# document the offsets of the readable JSON regions and the gaps
out.write('expected b64(twoway compact)[0:60] = %s\n' % tw_b64[:60])
out.write('doc region 211:872 head: %r\n' % bytes(b[211:300]))
out.write('\n')

# Build the full reconstructed plaintext: 
# - Keep binary header [0:211] as-is (it contains the offsets etc.)
# - data1 [211:872]: fill with b64 stream but preserve binary bytes that are NOT part of the b64.
# Since we can't perfectly separate binary-vs-b64 without the stream, do a greedy fill:
# place each char of tw_b64 at the earliest doc position >= 211 that matches it, overwriting.
doc = bytearray(b)
twb = tw_b64.encode()
pos = 0
for idx in range(211, 872):
    if pos < len(twb) and doc[idx] == twb[pos]:
        pos += 1
out.write('greedy: matched %d of %d b64 chars in data1 before running out\n' % (pos, len(twb)))

# Now compute where the decomposition: separate data2 and trailer appear intact.
out.write('trailer [951:976]: %r\n' % bytes(b[951:976]))
# Count how the full 976 is split
# block1 = 211..872 (661 bytes), sep2=872..891(19), block2=891..951(60), trailer=951..976(25)
# 211+ (b64 len 1560 fits?) 1560 > 661 so b64 spans into... wait b64 len is 1560 but that won't fit in data1 661.
# Unless data1+data2 together hold it: 661+60=721 < 1560. So the write does NOT hold the full b64.
# => the write holds a SUBSET of the json (only knob values), not the full twoway.
out.write('\nIMPORTANT: b64 len=%d but data1+data2 capacity ~721. So write stores a SUBSET.\n' % len(twb))
out.write('Readable content is a partial JSON (knob subset). Confirms earlier ~46%% finding.\n')
out.close()
print('done')
