import os, base64, json
here=os.path.dirname(os.path.abspath(__file__))
w=open(os.path.join(here,'req1_out.bin'),'rb').read()
p=open(os.path.join(here,'test_import_plaintext.bin'),'rb').read()
tw=json.load(open(os.path.join(here,'twoway.json')))
tw_b64=base64.b64encode(json.dumps(tw,separators=(',',':')).encode()).decode()
ALPH=set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
for name,bb in [('req1',w),('plain',p)]:
    real=''.join(chr(x) for x in bb[211:951] if x in ALPH)
    idx=tw_b64.find(real)
    print('%-5s real len=%d  starts-at-tw-index=%d'%(name,len(real),idx))
    print('    real head: %s'%real[:45])
    print('    tw[idx:]:  %s'%(tw_b64[idx:idx+45] if idx>=0 else 'N/A'))
    print()