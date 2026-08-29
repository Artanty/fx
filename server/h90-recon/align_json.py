import io, os, base64, json
here=os.path.dirname(os.path.abspath(__file__))
b1=open(os.path.join(here,'req1_out.bin'),'rb').read()
b2=open(os.path.join(here,'test_import_plaintext.bin'),'rb').read()
out=io.open(os.path.join(here,'align_json.txt'),'w',encoding='utf-8')
out.write('header identical [0:210]: %s\n\n'%(b1[0:210]==b2[0:210]))

# req1 data region [211:951]. Show the base64 stream runs.
import re
def runs(b,start,end):
    seg=b[start:end]
    return [(m.start()+start,m.group().decode()) for m in re.finditer(rb'[A-Za-z0-9+/=]{30,}',seg)]
r1=runs(b1,211,951); r2=runs(b2,211,951)
out.write('req1 base64 runs in [211:951]:\n')
for o,s in r1: out.write('  @%d len=%d  %s...\n'%(o,len(s),s[:50]))
out.write('\nplain base64 runs in [211:951]:\n')
for o,s in r2: out.write('  @%d len=%d  %s...\n'%(o,len(s),s[:50]))

# gather ALL base64 chars in order from req1 (concatenating runs, noting gaps)
def collect(b,start,end):
    chars=[]
    for i in range(start,end):
        c=chr(b[i])
        if c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=':
            chars.append(c)
    return ''.join(chars)
c1=collect(b1,211,951); c2=collect(b2,211,951)
out.write('\nreq1 collected b64 chars: %d\n'%len(c1))
out.write('plain collected b64 chars: %d\n'%len(c2))
out.write('\nreq1 b64 head: %s\n'%c1[:120])
out.write('plain b64 head: %s\n'%c2[:120])
out.write('\nreq1 b64 tail: %s\n'%c1[-120:])
out.write('plain b64 tail: %s\n'%c2[-120:])
out.close()
print('done')