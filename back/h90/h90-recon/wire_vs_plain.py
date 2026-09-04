import os
here=os.path.dirname(os.path.abspath(__file__))
w=open(os.path.join(here,'req1_out.bin'),'rb').read()
p=open(os.path.join(here,'test_import_plaintext.bin'),'rb').read()
out=open(os.path.join(here,'wire_vs_plain.txt'),'w')
ALPH=set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
# compare data region byte by byte, characterize gap bytes in each
out.write('%-8s %-8s | %s | %s\n'%('off','area','req1(wire)','plain'))
for i in range(211,951):
    r=w[i]; p2=p[i]
    if r==p2 and r in ALPH:
        continue
    # some difference or non-alph
    rk='b64' if r in ALPH else 'gap'
    pk='b64' if p2 in ALPH else 'gap'
    if r==p2:
        out.write('%6d %8s | char=%c same non-alph\n'%(i,rk,chr(r) if r<128 else '?'))
    else:
        out.write('%6d %8s %8s | %02x %c | %02x %c\n'%(i,rk,pk,r,chr(r) if 32<=r<127 else '.',p2,chr(p2) if 32<=p2<127 else '.'))
out.close()
print('done')