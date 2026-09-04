import base64, io, os, json

here = os.path.dirname(os.path.abspath(__file__))
b = open(os.path.join(here, 'req1_out.bin'), 'rb').read()
out = io.open(os.path.join(here, 'write_json_recon.txt'), 'w', encoding='utf-8')

# Find contiguous base64 runs in the whole document, decode each, keep only printable runs
b64alphabet = set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
runs = []
i = 0
in_run = False
start = 0
buf = bytearray()
for idx in range(len(b)):
    c = b[idx]
    act = (65 <= c <= 90) or (97 <= c <= 122) or (48 <= c <= 57) or c in (43, 47, 61)
    if act and not in_run:
        in_run = True
        start = idx
        buf = bytearray()
        buf.append(c)
    elif act and in_run:
        buf.append(c)
    elif not act and in_run:
        runs.append((start, idx - 1, bytes(buf)))
        in_run = False
if in_run:
    runs.append((start, len(b) - 1, bytes(buf)))

out.write('found %d base64 runs\n' % len(runs))

decoded_ascii = bytearray()
out.write('\n--- runs decoded to ascii ---\n')
for (s, e, raw) in runs:
    pad = (-len(raw)) % 4
    try:
        dec = base64.b64decode(raw + b'='*pad)
    except Exception as ex:
        out.write('  off %d len %d DECODE FAIL\n' % (s, len(raw)))
        continue
    # printable-ish?
    printable = sum(1 for x in dec if 32 <= x < 127 or x in (10, 9))
    ratio = printable / len(dec) if dec else 0
    out.write('  off %d len %d dec_len %d printable %.2f :: %r\n' % (s, len(raw), len(dec), ratio, dec[:70]))
    if ratio > 0.9 and len(dec) > 2:
        decoded_ascii += dec

out.write('\n--- concatenated printable decoded (the JSON text) ---\n')
out.write(decoded_ascii.decode('ascii', 'replace') + '\n')
out.write('\n--- len %d ---\n' % len(decoded_ascii))
out.close()
print('done')
