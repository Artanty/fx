import re, io, os, base64, json

here = os.path.dirname(os.path.abspath(__file__))
src = r'C:/server/fx/input/User 2.lst90'
b = open(src, 'rb').read()
out = io.open(os.path.join(here, 'knob_tags.txt'), 'w', encoding='utf-8')

# For each record, find its JSON (preset name + algorithm) and its tjknobs-knobN separator tags.
# The JSON b64 is preceded (in its record) by a "tjknobs-knobN" separator. Each knob has one tag.
# Strategy: iterate over base64 JSON blocks in order; for each, associate with nearest preceding
# chunk of tjknobs-knobN tags and the algorithm/preset from decoded JSON.

b64re = re.compile(rb'eyJ[A-Za-z0-9+/=]{20,}')
# Find JSON blocks ordered by offset
blocks = []
for m in b64re.finditer(b):
    s = m.group()
    try:
        dec = base64.b64decode(s + b'='*((-len(s)) % 4))
        j = json.loads(dec)
        if isinstance(j, dict):
            blocks.append((m.start(), j.get('algorithm_name'), j.get('preset_name')))
    except Exception:
        pass

# Find all tjknobs-knobN tags with offsets
tags = [(m.start(), m.group().decode()) for m in re.finditer(rb'tjknobs-knob\d+', b)]

import bisect
tag_offsets = [t[0] for t in tags]

out.write('per-record knob tags (header knob ordering):\n\n')
for off, alg, preset in blocks:
    # collect tags preceding this JSON but after previous JSON
    # get tags with offset between (previous block end) and this JSON offset
    # simple: tags with offset < off, take the last cluster
    # find index of first tag >= off
    i = bisect.bisect_left(tag_offsets, off)
    cluster = []
    for ti in range(max(0, i-20), i):
        cluster.append(tags[ti])
    # cluster may include tags from the prior record; limit to tags within ~3000 bytes before off
    cluster = [t for t in cluster if off - t[0] < 3000]
    out.write('%-28s %-14s off=%d  knobtags=%s\n' % (str(alg), str(preset), off, [t[1] for t in cluster]))
out.close()
print('done')
