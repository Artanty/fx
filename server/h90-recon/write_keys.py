import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
out = io.open(os.path.join(here, 'write_keys.txt'), 'w', encoding='utf-8')

b64alphabet = set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
# Decode every decodable b64 substring across the whole 976-byte doc that yields printable text
# Focus region: 190..951 (data blocks + separators)
def printable(dec):
    if not dec: return False
    return sum(1 for x in dec if 32 <= x < 127) / len(dec) > 0.95

text = []
for start in range(190, 951):
    # gather contiguous b64 run starting at start
    raw = bytearray()
    i = start
    while i < len(b) and b[i] in b64alphabet:
        raw.append(b[i]); i += 1
    if len(raw) < 4:
        continue
    for sub_start in range(0, min(4, len(raw))):
        r = bytes(raw[sub_start:])
        pad = (-len(r)) % 4
        try:
            dec = base64.b64decode(r + b'='*pad)
        except Exception:
            continue
        if printable(dec) and len(dec) > 3:
            # record at the doc offset
            text.append((start + sub_start, dec))
            break
    start = i  # skip ahead? careful: don't, offset loop continues; use while

# dedupe overlapping decodes (keep longest per raw region) - simpler: just list unique
seen_offsets = set()
regions = []
for off, dec in text:
    if off in seen_offsets:
        continue
    seen_offsets.add(off)
    regions.append((off, dec))

regions.sort()
out.write('decodable printable regions:\n')
for off, dec in regions:
    out.write('  off %d (%d bytes): %r\n' % (off, len(dec), dec[:60]))

# Try to reconstruct full JSON by concatenating decoded text across regions that are contiguous decodable
# (i.e., where the source b64 chars are contiguous). Group regions by adjacency in source.
out.write('\n--- joined text ---\n')
joined = b''
out.write(''.join(dec.decode('ascii','replace') for off, dec in regions) + '\n')
out.close()
print('done')
