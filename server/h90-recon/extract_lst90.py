import re, base64, json, io, os, sys

src = r'C:/server/fx/input/User 2.lst90'
outdir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'lst90_json')
os.makedirs(outdir, exist_ok=True)

b = open(src, 'rb').read()
manifest = io.open(os.path.join(outdir, 'manifest.txt'), 'w', encoding='utf-8')
b64re = re.compile(rb'[A-Za-z0-9+/=]{60,}')
seen = set()
idx = 0
for m in b64re.finditer(b):
    s = m.group()
    if m.start() in seen:
        continue
    try:
        dec = base64.b64decode(s)
        j = json.loads(dec)
        if not isinstance(j, dict):
            continue
        seen.add(m.start())
        name = (j.get('preset_name') or j.get('algorithm_name') or 'unknown').replace(' ', '_').replace('/', '_')
        fn = os.path.join(outdir, '%02d_%s.json' % (idx, name))
        with open(fn, 'w', encoding='utf-8') as f:
            f.write(json.dumps(j, indent=2))
        manifest.write('#%d: off=%d alg=%s preset=%s nKeys=%d file=%s\n' % (
            idx, m.start(), j.get('algorithm_name'), j.get('preset_name'), len(j), os.path.basename(fn)))
        idx += 1
    except Exception:
        pass
manifest.close()
print('extracted', idx, 'programs')
