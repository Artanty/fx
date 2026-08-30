import base64, json, io, re, os

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
out = io.open(os.path.join(here, 'write_correlate.txt'), 'w', encoding='utf-8')

b64alphabet = b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='

# Find base64 characters in the whole doc, but keep the per-run positions
seg = b
positions = [(i, c) for i, c in enumerate(seg) if c in b64alphabet]
out.write('total b64 chars=%d\n' % len(positions))

# Group into runs separated by gaps > threshold, and decode each possible contiguous b64 string
run_starts = []
cur = None
prev = -10
for i, c in positions:
    if i - prev > 1:
        if cur is not None:
            run_starts.append(cur)
        cur = i
    prev = i
if cur is not None:
    run_starts.append(cur)

# print runs with start offset and length
runs = []
ridx = 0
plist = positions
i = 0
while i < len(plist):
    j = i
    while j + 1 < len(plist) and plist[j+1][0] == plist[j][0] + 1:
        j += 1
    runs.append((plist[i][0], plist[j][0], j - i + 1))
    i = j + 1

out.write('b64 runs in document:\n')
full = b''
last_start = None
for (s, e, n) in runs:
    out.write('  off=%d len=%d\n' % (s, n))
    full += bytes(c for _, c in plist[s:s] if False)

# Now: build the "decoded" JSON by iterating the base64 stream properly.
# Real approach: concatenate b64 alphabet chars in order and try decoding every offset to find a clean JSON.
best = None
chars = bytes(c for _, c in positions)
for start in range(0, min(8, len(chars))):
    for end in range(len(chars), len(chars)-8, -1):
        sub = chars[start:end]
        pad = (-len(sub)) % 4
        try:
            dec = base64.b64decode(sub + b'='*pad)
            j = json.loads(dec)
            if isinstance(j, dict):
                best = (start, end, dec, j)
                break
        except Exception:
            continue
    if best:
        break

if best:
    start, end, dec, j = best
    out.write('\nFOUND VALID JSON: start=%d end=%d (of %d b64 chars)\n' % (start, end, len(chars)))
    out.write('decoded bytes=%d\n' % len(dec))
    out.write('KEYS(%d): %s\n' % (len(j), list(j.keys())))
    out.write('JSON:\n' + json.dumps(j, indent=2) + '\n')
else:
    out.write('\nno full valid JSON found via char-stitch\n')

out.close()
print('done')
