import os, base64, json
here=os.path.dirname(os.path.abspath(__file__))
b=open(os.path.join(here,'test_import_plaintext.bin'),'rb').read()
tw=json.load(open(os.path.join(here,'twoway.json')))
comp=json.dumps(tw,separators=(',',':'))
tw_b64=base64.b64encode(comp.encode()).decode()
ALPH=set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
real=''.join(chr(x) for x in b[211:951] if x in ALPH)
print('real len',len(real),'tw len',len(tw_b64))
print('real==tw[:637]:', real==tw_b64[:637])
print('real==tw[-637:]:', real==tw_b64[-637:])
# where does real sit in tw?
idx=tw_b64.find(real)
print('real found in tw at index:', idx)
print()
print('real head:', real[:50])
print('tw[?] :', tw_b64[idx:idx+50] if idx>=0 else '')
print()
# Does the write contain any OTHER base64 beyond this region? Check whole file for base64
import re
print('all base64 runs in plain (>=20):')
for m in re.finditer(rb'[A-Za-z0-9+/=]{20,}', b):
    print('  @%d len=%d %s'%(m.start(),len(m.group()),m.group()[:30]))
print('file len',len(b))