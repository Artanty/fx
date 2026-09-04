#!/usr/bin/env python3
"""Resolve LEA targets and find deflate in H90 Control.exe."""
import capstone, struct, sys

BINARY = r"C:\Program Files\Eventide\H90 Control.exe"
IMG_BASE = 0x140000000
TEXT_FOFF = 0x400

with open(BINARY, "rb") as f:
    EXE = f.read()

def resolve_lea(func_va, size=2000):
    foff = TEXT_FOFF + (func_va - IMG_BASE - 0x1000)
    code = EXE[foff:foff+size]
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    results = []
    for insn in md.disasm(code, func_va):
        if insn.mnemonic != "lea":
            continue
        for op in insn.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                disp = op.mem.disp
                target = insn.address + insn.size + disp
                # Read string at target
                toff = target - IMG_BASE
                if 0 <= toff < len(EXE) - 4:
                    raw = EXE[toff:toff+80]
                    end = raw.find(b"\x00")
                    if end < 0:
                        end = 40
                    s = raw[:end]
                    # Check if it's printable ASCII
                    ascii_chars = sum(1 for b in s if 32 <= b < 127)
                    if ascii_chars > len(s) * 0.5 and len(s) > 3:
                        results.append((insn.address, target, s.decode("ascii", errors="replace")))
                    else:
                        results.append((insn.address, target, repr(s)))
    return results

# 0x14043fae0 receives "1.2.3" - likely deflateInit_ wrapper
print("=== 0x14043fae0 string refs ===")
for addr, target, text in resolve_lea(0x14043fae0):
    print(f"  0x{addr:x} -> 0x{target:x}: {text[:60]}")

# 0x14045e670 - called before deflateInit
print("\n=== 0x14045e670 string refs ===")
for addr, target, text in resolve_lea(0x14045e670):
    print(f"  0x{addr:x} -> 0x{target:x}: {text[:60]}")

# Find function start for 0x1400988c9
print("\n=== Looking for function containing 0x1400988c9 ===")
func_va = 0x1400988c9
for offset in range(0x20, 0x2000):
    test_va = func_va - offset
    foff2 = TEXT_FOFF + (test_va - IMG_BASE - 0x1000)
    if foff2 < 0:
        continue
    b = EXE[foff2:foff2+4]
    # Check for function prologue
    if b[:3] == b'\x48\x81\xec' or b[:3] == b'\x48\x83\xec':
        b_prev = EXE[foff2-3:foff2]
        if any(x in b_prev for x in [0x53, 0x55, 0x56, 0x57]):
            region_code = EXE[foff2:foff2+offset+4]
            md2 = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
            has_ret = False
            for insn in md2.disasm(region_code, test_va):
                if insn.address >= func_va:
                    break
                if insn.mnemonic in ('ret', 'retn'):
                    has_ret = True
                    break
            if not has_ret:
                print(f"  Start: 0x{test_va:x}")
                # Resolve its string refs
                for a, t, text in resolve_lea(test_va, 2000):
                    print(f"    0x{a:x} -> {text[:70]}")
                break

# Now search for deflate() function.
# deflate() references strings like "buffer error", "insufficient memory", etc.
# Also, deflate() has a very specific pattern: it accesses z_stream->state
# Let's look for the 'incorrect header check' string and other zlib strings
# that might be referenced differently (via MOV from global pointer)

# Search for all strings containing "deflat" or "inflat" or "zlib" in .rdata
print("\n=== Searching for deflate-related strings ===")
RDATA_START = 0x6ed000
RDATA_SIZE = 0x31bc00
seen = set()
for pattern in [b"deflat", b"inflat", b"buffer error", b"insufficient mem",
                b"stream error", b"bad block", b"block compress",
                b"need dictionary"]:
    pos = RDATA_START
    while True:
        idx = EXE.find(pattern, pos, RDATA_START + RDATA_SIZE)
        if idx < 0:
            break
        va = IMG_BASE + idx
        end = EXE.find(b"\x00", idx)
        s = EXE[idx:min(idx+60, end if end > idx else idx+60)]
        text = s.decode("ascii", errors="replace")
        if va not in seen:
            seen.add(va)
            print(f"  0x{va:x}: {text[:70]}")
        pos = idx + 1
