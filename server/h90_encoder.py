#!/usr/bin/env python3
"""H90 import write-serialization encoder.

Builds the plaintext write serialization (the data that gets deflated)
for an arbitrary preset, using the captured TWO-WAY import as a structural
template. Then compresses, frames as TRPC, and 7-bit packs for sending.

The write format is:
  [0:32]     TRPC header (u32 fields: root_off, neg_offset, type=0x4f, root=12)
  [32:192]   ValueTree structure (field table, fixed metadata, float values)
  [192:211]  "tjknobs-knob4\\0\\0\\0xdl" separator
  [211:976]  B64-encoded JSON of preset params, with NUL marker pairs interspersed
  [951:976]  Trailer (NULs + u32 size fields)

The b64 region encodes the preset's JSON parameter dictionary. The NUL markers
are structural separators whose positions are FIXED for a given algorithm type.
The dict-copy positions (72 in req1) come from the LZ77 dictionary and are
NOT part of the plaintext — they're the compressed representation referencing
the dictionary (previous program's write serialization).

Key insight: the plaintext IS the document. LZ77 dict copies are compression
artifacts. When building plaintext from scratch (no dict), ALL positions are
literal bytes — we fill them with the correct b64 chars.
"""
import sys, os, json, base64, struct, zlib, re
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from h90_decode import pack_7bit, unpack_7bit

# ---- Load template (captured TWO-WAY write plaintext) ----
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
CAPTURES = os.path.join(SCRIPT_DIR, "h90-captures")
RECON = os.path.join(SCRIPT_DIR, "h90-recon")

def load_template():
    """Load the captured TWO-WAY write plaintext as the template."""
    from h90_dict_recover import deflate_track
    from h90_reconstruct import extract_deflate
    defl, _ = extract_deflate(os.path.join(CAPTURES, "h90_import_req.bin"))
    out, src, _ = deflate_track(defl, zdict=b"\x00" * 32768)
    return out, src

def load_req2():
    """Load the captured MURKY write plaintext."""
    from h90_dict_recover import deflate_track
    from h90_reconstruct import extract_deflate
    defl, _ = extract_deflate(os.path.join(CAPTURES, "h90_import2_req.bin"))
    out, src, _ = deflate_track(defl, zdict=b"\x00" * 32768)
    return out, src

def extract_json_from_plaintext(out, src):
    """Extract the JSON embedded in the write plaintext by decoding b64 runs."""
    B64SET = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")

    # Find all b64 runs
    runs = []
    i = 208  # start of first b64 after "tjknobs-knob4\0\0\0xdl"
    while i < len(out):
        if out[i] in B64SET:
            j = i
            while j < len(out) and out[j] in B64SET:
                j += 1
            runs.append((i, j))
            i = j
        else:
            i += 1

    # Try to decode all b64 bytes as one continuous stream (skipping markers)
    all_b64 = bytes(out[i] for i in range(208, len(out)) if out[i] in B64SET)
    print(f"Total b64 chars: {len(all_b64)}")

    # Decode with each phase
    for phase in range(4):
        padded = b"\x00" * phase + all_b64
        try:
            decoded = base64.b64decode(padded + b"=" * ((4 - len(padded) % 4) % 4))
            # Check if it looks like JSON
            text = decoded.decode("ascii", errors="replace")
            brace_pos = text.find("{")
            if brace_pos >= 0:
                print(f"  phase={phase}: {len(decoded)}B, '{{' at {brace_pos}")
                print(f"    ...{text[brace_pos:brace_pos+80]}...")
        except:
            pass

def map_b64_to_json(out):
    """Map each b64 byte in the output to its position in the embedded JSON."""
    B64SET = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")

    # Collect all b64 bytes
    b64_bytes = []
    for i in range(208, len(out)):
        if out[i] in B64SET:
            b64_bytes.append((i, out[i]))

    print(f"\nTotal b64 bytes in [208:{len(out)}]: {len(b64_bytes)}")

    # The NUL markers at specific positions break the b64 stream.
    # Key insight from the analysis: the stream is NOT phase-continuous.
    # But the 72 dict-copy positions are only in the non-b64 regions.
    # So the b64 runs themselves should be decodable.

    # Find marker positions (non-b64 in [208:976])
    markers = []
    for i in range(208, len(out)):
        if out[i] not in B64SET:
            markers.append(i)

    print(f"Non-b64 marker positions: {len(markers)}")
    # Group consecutive markers
    groups = []
    i = 0
    while i < len(markers):
        j = i
        while j < len(markers) and markers[j] == markers[i] + (j - i):
            j += 1
        groups.append((markers[i], markers[j-1]+1))
        i = j

    print(f"Marker groups: {len(groups)}")
    for s, e in groups:
        print(f"  [{s}:{e}] ({e-s}B) hex={out[s:e].hex()}")

    return b64_bytes, groups


def build_plaintext_for_preset(preset_json, template_out=None):
    """Build the write-serialization plaintext for a given preset JSON dict.

    Uses the TWO-WAY captured output as a structural template. The approach:
    - Keep the TRPC header [0:32] and ValueTree structure [32:192] from template
    - Keep the separator [192:211]
    - Rebuild the b64 region [211:976] from the new JSON
    - Keep the trailer from template
    """
    if template_out is None:
        template_out, _ = load_template()

    out = bytearray(template_out)

    # Encode the preset JSON
    json_str = json.dumps(preset_json, separators=(",", ":"))
    json_b64 = base64.b64encode(json_str.encode("ascii"))
    print(f"JSON: {len(json_str)} chars -> b64: {len(json_b64)} chars")

    # The write format b64 region contains the JSON encoded in base64,
    # but with NUL separators at fixed positions.
    # For the template (TWO-WAY), the b64 chars occupy specific positions.
    # We need to figure out the mapping.

    # Strategy: identify which output positions are "b64 data" positions
    # (i.e., would be literal b64 chars when the dict matches).
    # Then fill those positions with the new JSON's b64 chars.

    # From the analysis, positions that are NOT dict copies or NUL markers
    # in the template are literal b64 chars.
    _, src = load_template()
    B64SET = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/")

    b64_positions = []
    for i in range(211, 976):
        s = src[i]
        b = out[i]
        if s[0] == "lit" and b in B64SET:
            b64_positions.append(i)
        elif s[0] == "copy" and s[1] >= 32768 and b in B64SET:
            # Output-self-ref copy that happens to be a b64 char
            b64_positions.append(i)

    print(f"B64 data positions in [211:976]: {len(b64_positions)}")
    print(f"JSON b64 length: {len(json_b64)}")

    if len(b64_positions) == len(json_b64):
        print("Perfect match! Filling b64 positions from JSON.")
        for pos, b in zip(b64_positions, json_b64):
            out[pos] = b
    else:
        print(f"Mismatch: {len(b64_positions)} positions vs {len(json_b64)} b64 chars")
        # Fill what we can
        n = min(len(b64_positions), len(json_b64))
        for pos, b in zip(b64_positions[:n], json_b64[:n]):
            out[pos] = b

    return bytes(out)


def compress_plaintext(plaintext, zdict=b""):
    """Compress the plaintext with raw DEFLATE using an optional preset dictionary."""
    if zdict:
        # Use raw deflate with a preset dictionary
        co = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
        co.compress(plaintext)
        compressed = co.flush(zlib.Z_FINISH)
    else:
        # Raw deflate, no dictionary
        co = zlib.compressobj(zlib.Z_DEFAULT_COMPRESSION, zlib.DEFLATED, -15)
        compressed = co.compress(plaintext)
        compressed += co.flush(zlib.Z_FINISH)
    return compressed


def build_trpc_frame(type_high, type_low, payload):
    """Build an H90 TRPC SysEx frame.

    Header: F0 1C 77 00 <f4> <f5> <f6> <f7>
    msgid = (f4 << 7) | f5
    type = (f6 << 7) | f7
    """
    # Type 0x4F = import/export request
    msgid = 0x03  # arbitrary
    mtype = type_high << 7 | type_low
    f4 = (msgid >> 7) & 0x7F
    f5 = msgid & 0x7F
    f6 = (mtype >> 7) & 0x7F
    f7 = mtype & 0x7F
    header = bytes([0xF0, 0x1C, 0x77, 0x00, f4, f5, f6, f7])

    # 7-bit pack the payload
    packed = pack_7bit(payload)

    return header + packed + b"\xF7"


def encode_import(preset_json, zdict=b"", verbose=True):
    """Full pipeline: JSON -> write plaintext -> compress -> TRPC frame."""
    # Build the plaintext
    plaintext = build_plaintext_for_preset(preset_json)
    if verbose:
        print(f"Plaintext: {len(plaintext)} bytes")

    # Compress
    compressed = compress_plaintext(plaintext, zdict)
    if verbose:
        print(f"Compressed: {len(compressed)} bytes (dict={'yes' if zdict else 'no'})")

    # Add zlib header (78 9c) and adler32 trailer
    adler = zlib.adler32(plaintext) & 0xFFFFFFFF
    zlib_stream = b"\x78\x9c" + compressed + struct.pack(">I", adler)
    if verbose:
        print(f"Zlib stream: {len(zlib_stream)} bytes")

    # Build TRPC frame (type 0x03/0x4F = import)
    frame = build_trpc_frame(0x03, 0x4F, zlib_stream)
    if verbose:
        print(f"TRPC frame: {len(frame)} bytes")

    return frame, plaintext, compressed, adler


def verify_against_capture(frame, capture_path):
    """Compare our generated frame against a captured import frame."""
    captured = open(capture_path, "rb").read()
    # Extract our payload after the 8-byte header (skip header and trailing F7)
    our_payload = frame[8:-1] if frame.endswith(b"\xF7") else frame[8:]
    cap_payload = captured[8:-1] if captured.endswith(b"\xF7") else captured[8:]

    print(f"\nOur payload: {len(our_payload)} bytes")
    print(f"Captured:   {len(cap_payload)} bytes")

    if our_payload == cap_payload:
        print("EXACT MATCH!")
        return True

    # Find first difference
    for i in range(min(len(our_payload), len(cap_payload))):
        if our_payload[i] != cap_payload[i]:
            print(f"First diff at byte {i}: ours=0x{our_payload[i]:02x} cap=0x{cap_payload[i]:02x}")
            print(f"  context ours:   {our_payload[max(0,i-4):i+8].hex()}")
            print(f"  context cap:    {cap_payload[max(0,i-4):i+8].hex()}")
            break
    else:
        print(f"Payloads match for first {min(len(our_payload), len(cap_payload))} bytes")
        if len(our_payload) != len(cap_payload):
            print(f"Length mismatch: {len(our_payload)} vs {len(cap_payload)}")

    return False


def main():
    import argparse
    parser = argparse.ArgumentParser(description="H90 import write-serialization encoder")
    parser.add_argument("--json", help="Preset JSON file (or 'twoway' for built-in)")
    parser.add_argument("--verify", action="store_true", help="Verify against captured import")
    parser.add_argument("--analyze", action="store_true", help="Analyze template structure")
    parser.add_argument("--dict", help="Dictionary file for compression")
    parser.add_argument("--output", help="Output frame file")
    args = parser.parse_args()

    if args.analyze:
        print("=== Template analysis ===")
        out, src = load_template()
        print(f"Template: {len(out)} bytes")
        extract_json_from_plaintext(out, src)
        map_b64_to_json(out)
        return

    # Load preset JSON
    if args.json == "twoway" or not args.json:
        twoway = json.loads(open(os.path.join(RECON, "twoway.json")).read())
        preset = twoway
    else:
        preset = json.loads(open(args.json).read())

    # Load dictionary
    zdict = b""
    if args.dict:
        zdict = open(args.dict, "rb").read()
        print(f"Dictionary: {len(zdict)} bytes")

    # Encode
    frame, plaintext, compressed, adler = encode_import(preset, zdict)

    # Save
    out_path = args.output or os.path.join(RECON, "test_import.bin")
    open(out_path, "wb").write(frame)
    print(f"Wrote {out_path}")

    # Also save the plaintext for inspection
    pt_path = out_path.replace(".bin", "_plaintext.bin")
    open(pt_path, "wb").write(plaintext)
    print(f"Wrote {pt_path}")

    # Verify against capture
    if args.verify:
        verify_against_capture(frame, os.path.join(CAPTURES, "h90_import_req.bin"))

        # Also verify adler32
        cap_defl, cap_up = _extract_raw(os.path.join(CAPTURES, "h90_import_req.bin"))
        cap_adler = struct.unpack_from(">I", cap_up, len(cap_up)-4)[0] if len(cap_up) > 4 else 0
        print(f"\nAdler32: ours=0x{adler:08x} captured=0x{cap_adler:08x} match={adler==cap_adler}")


def _extract_raw(path):
    from h90_reconstruct import extract_deflate
    defl, up = extract_deflate(path)
    return defl, up


if __name__ == "__main__":
    main()
