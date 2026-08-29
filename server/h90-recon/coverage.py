import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
tw = json.load(open(os.path.join(here, 'twoway.json')))
out = io.open(os.path.join(here, 'coverage.txt'), 'w', encoding='utf-8')

tw_b64 = base64.b64encode(json.dumps(tw, separators=(',', ':')).encode()).decode()

# Walk tw_b64. For each character, find its earliest literal occurrence in the data region [211:951]
# that comes after the previous match position (greedy forward match in doc). Count matched vs gap.
region = b[211:951]
region_b64pos = [i for i in range(211, 951)]  # absolute doc offsets
# Build list of (doc_offset, byte) for b64 alphabet in region
quant = []
for i in range(211, 951):
    c = b[i]
    if (65 <= c <= 90) or (97 <= c <= 122) or (48 <= c <= 57) or c in (43, 47, 61):
        quant.append((i, c))

# Greedy: try to match tw_b64 chars against quant positions in order
matched_positions = []
qi = 0
matched_chars = 0
for ch in tw_b64:
    cc = ord(ch)
    found = -1
    while qi < len(quant):
        if quant[qi][1] == cc:
            found = quant[qi][0]
            qi += 1
            break
        qi += 1
    if found != -1:
        matched_chars += 1
        matched_positions.append(found)

out.write('tw b64 len=%d, literally matched chars=%d (%.0f%%), dict-copied=%d\n' % (
    len(tw_b64), matched_chars, 100.0 * matched_chars / len(tw_b64), len(tw_b64) - matched_chars))
out.write('This confirms how much of the JSON b64 is stored inline vs the previous-slot dictionary.\n')
out.close()
print('matched', matched_chars, '/', len(tw_b64))
