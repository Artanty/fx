import os, base64, json
here=os.path.dirname(os.path.abspath(__file__))
b=open(os.path.join(here,'test_import_plaintext.bin'),'rb').read()
tw=json.load(open(os.path.join(here,'twoway.json')))
comp=json.dumps(tw,separators=(',',':'))
tw_b64=base64.b64encode(comp.encode()).decode()

# The write's data region = tw_b64 prefix, with 00 00 bytes replacing chars that
# were deflate-dict-copied (the gaps). Reconstruct the FULL literal plaintext:
# every real base64 char stays; every gap byte position becomes the corresponding
# tw_b64 char char (filling in order).
ALPH=set(b'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=')
seg=bytearray(b)
# Walk region [211:951], building filled output
out=bytearray()
real_i=0
i=211
end=951
while i<end:
    if seg[i] in ALPH:
        out.append(seg[i]); real_i+=1; i+=1
    else:
        # gap -> fill with tw_b64 char at real_i
        while i<end and seg[i] not in ALPH:
            out.append(ord(tw_b64[real_i]))  # held char
            real_i+=1
            i+=1
# out now is full data region literal. Verify length matches requirement
print('filled bytes:', len(out))
print('real_i reached:', real_i, '(should be 637+, into truncation)')
print('last filled base64 char:', chr(out[-1]) if out else None)
# sanity: the reconstructed region should contain tw_b64[:637] as its base64 chars
recon_b64=''.join(chr(x) for x in out if x in ALPH)
print('recon b64 == tw[:637]:', recon_b64==tw_b64[:637])

# Save reconstructed reference: header [0:211] + filled region + trailer [951:]
# The trailer [951:976] is zeros (from earlier mapping).
full=bytearray(b[0:211])+out+bytearray(b[951:976])
print('total len', len(full))
open(os.path.join(here,'ref_write_plain.bin'),'wb').write(bytes(full))
print('saved ref_write_plain.bin')
# also save the filled-Region-only for reference
open(os.path.join(here,'ref_data_region.bin'),'wb').write(bytes(out))
print('saved ref_data_region.bin (%d bytes)'%len(out))