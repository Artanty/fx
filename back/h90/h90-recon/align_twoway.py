import base64, json, io, os

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
tw = json.load(open(os.path.join(here, 'twoway.json')))
out = io.open(os.path.join(here, 'align_twoway.txt'), 'w', encoding='utf-8')

# Hypothesis: data region [211:872] should contain base64(twoway.json)
# Build the base64 of twoway.json in the SAME key order (json.dumps preserves insertion order = twoway already canonical)
tw_json = json.dumps(tw)  # twoway.json was written with keys already in order
tw_b64 = base64.b64encode(tw_json.encode('utf-8'))
out.write('twoway.json serialized len=%d, b64=%d\n' % (len(tw_json), len(tw_b64)))
out.write('b64 head: %r\n' % tw_b64[:60])

# Where does b64 appear? Search in region [190:872]
data1 = b[211:872]
# brute allow gaps: walk data1, matching each b64 char in order against non-b64 chars in doc
# Compute how many leading b64 chars of tw_b64 can be matched allowing the doc's gaps
# Try: align the start. The b64 should start right at 211? Let's scan for first b64 char of tw_b64
first = tw_b64[:8]
# find first occurrence in raw doc
idx = b.find(first)
out.write('first 8 b64 chars found at raw offset %d\n' % idx)

# Now do a greedy alignment: for each doc byte from idx, if it equals next expected b64 char, consume; else it's a gap.
buf = bytearray(b)
pos = idx
exp = 0
match_count = 0
detail = []
gap_start = None
doc_i = idx
while exp < len(tw_b64) and doc_i < 976:
    if b[doc_i] == tw_b64[exp]:
        if gap_start is not None:
            detail.append(('gap', gap_start, doc_i - gap_start))
            gap_start = None
        detail.append(('b64', doc_i, b[doc_i]))
        exp += 1
        match_count += 1
    else:
        if gap_start is None:
            gap_start = doc_i
    doc_i += 1

out.write('\nmatched %d of %d b64 chars\n' % (match_count, len(tw_b64)))
gaps = [d for d in detail if d[0] == 'gap']
b64s = [d for d in detail if d[0] == 'b64']
out.write('num b64 positions matched=%d, num gap spans=%d\n' % (len(b64s), len(gaps)))
out.write('\ngap spans (dict-copy regions):\n')
for g in gaps:
    out.write('  off %d len %d\n' % (g[1], g[2]))
out.close()
print('done, matched', match_count, 'of', len(tw_b64))
