import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
out = io.open(os.path.join(here, 'write_json_aligned.txt'), 'w', encoding='utf-8')

b64alphabet = set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
# collect b64 chars IN document order (this should be the interleaved base64 stream)
chars = [c for c in b if c in b64alphabet]
out.write('total b64 chars in doc=%d\n' % len(chars))

# Try decoding a contiguous window of chars, scanning start/end, to find valid JSON.
def try_decode(chars_seq):
    for s in range(0, min(12, len(chars_seq))):
        for e in range(len(chars_seq), len(chars_seq)-12, -1):
            sub = bytes(chars_seq[s:e])
            pad = (-len(sub)) % 4
            try:
                dec = base64.b64decode(sub + b'='*pad)
                j = json.loads(dec)
                if isinstance(j, dict):
                    return (s, e, dec, j)
            except Exception:
                continue
    return None

res = try_decode(chars)
if res:
    s, e, dec, j = res
    out.write('VALID JSON: chars[%d:%d] of %d\n' % (s, e, len(chars)))
    out.write('decoded %d bytes\n' % len(dec))
    out.write('keys(%d): %s\n' % (len(j), list(j.keys())))
    out.write(json.dumps(j, indent=2) + '\n')
else:
    out.write('no valid JSON via single aligned window\n')

out.close()
print('done')
