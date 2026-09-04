import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
tw = json.load(open(os.path.join(here, 'twoway.json')))
out = io.open(os.path.join(here, 'verify_twoway_b64.txt'), 'w', encoding='utf-8')

# Compact base64 of twoway.json (no spaces, preserving key order)
tw_compact = json.dumps(tw, separators=(',', ':'))
tw_b64 = base64.b64encode(tw_compact.encode('utf-8'))
out.write('twoway compact len=%d b64=%d\n' % (len(tw_compact), len(tw_b64)))
out.write('b64: %s\n\n' % tw_b64.decode())

# The clean run at off 275 (274 chars) decodes to start. Get that decoded text.
run_off = 275
# find the b64 run at 275: gather contiguous b64 from 275
raw = bytearray()
i = run_off
while i < len(b) and b[i] in (set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')):
    raw.append(b[i]); i += 1
dec = base64.b64decode(bytes(raw) + b'='*((-len(raw))%4)).decode('ascii', 'replace')
out.write('run@275 decodes to:\n%s\n\n' % dec)
out.write('is substring of compact twoway json? %r\n' % (dec in tw_compact))
out.write('contains them sequentially:\n')

# Does the readable run appear inside the compact JSON base64 stream?
dec_b64 = base64.b64encode(dec.encode('utf-8'))
out.write('is run raw a substring of tw_b64? %r\n' % (bytes(raw) in tw_b64))
out.write('raw run start: %s\n' % bytes(raw)[:40])
out.write('tw_b64 head:   %s\n' % tw_b64[:40])
out.close()
print('done')
