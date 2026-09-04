#!/usr/bin/env python3
"""Targeted angr analysis: find compression code paths in H90 Control.exe.

Strategy:
1. Use capstone to find all call targets from the import function chain
2. For each callee, use angr to create a targeted CFG (max_blocks) and decompile
3. Search for deflate/deflateSetDictionary patterns in the decompiled output
"""
import logging
logging.getLogger("angr.state_plugins.unicorn_engine").setLevel(logging.CRITICAL)

import angr
import angr.analyses
import capstone
import struct
import sys

BINARY = r"C:\Program Files\Eventide\H90 Control.exe"
IMG_BASE = 0x140000000
TEXT_FOFF = 0x400
TEXT_FSIZE = 0x6eb200

with open(BINARY, "rb") as f:
    EXE = f.read()


def get_code(va, size=400):
    foff = TEXT_FOFF + (va - IMG_BASE - 0x1000)
    return EXE[foff:foff + size]


def get_calls_and_leas(va, size=400):
    code = get_code(va, size)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    calls = []
    leas = []
    movs = []
    for insn in md.disasm(code, va):
        if insn.mnemonic == "call":
            try:
                calls.append((insn.address, int(insn.op_str, 16)))
            except ValueError:
                calls.append((insn.address, insn.op_str))
        if insn.mnemonic == "lea" and "rip" in insn.op_str:
            leas.append((insn.address, insn.op_str))
        if insn.mnemonic == "mov" and "rip" in insn.op_str:
            movs.append((insn.address, insn.op_str))
    return calls, leas, movs


def find_rip_refs(target_va, scan_start=None, scan_size=None):
    """Find all RIP-relative LEA/MOV refs to target_va in .text."""
    if scan_start is None:
        scan_start = IMG_BASE + 0x1000
    if scan_size is None:
        scan_size = TEXT_FSIZE
    code = EXE[TEXT_FOFF:TEXT_FOFF + scan_size]
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    refs = []
    for insn in md.disasm(code, scan_start):
        for op in insn.operands:
            if op.type == capstone.x86.X86_OP_MEM and op.mem.base == capstone.x86.X86_REG_RIP:
                disp = op.mem.disp
                tgt = insn.address + insn.size + disp
                if tgt == target_va:
                    refs.append((insn.address, insn.mnemonic, insn.op_str))
    return refs


def try_angr_decompile(addr, func_name=None):
    """Try to decompile a single function using angr with minimal CFG."""
    try:
        proj = angr.Project(BINARY, auto_load_libs=False)
        
        # Use CFGFast with max_bytes to limit analysis scope
        # Start from a small region around the target
        # angr doesn't support start_addr on AMD64, but we can try
        # force_complete_cfg=False + max_nodes to limit
        cfg = proj.analyses.CFGFast(
            force_complete_cfg=False,
            max_nodes=500,
            show_progressbar=False,
            symbols=False,
            function_prologues=False,
            resolve_indirect_jumps=False,
            collect_data_references=False,
        )
        
        func = cfg.functions.get(addr)
        if func is None:
            print(f"  0x{addr:x}: not found in CFG ({len(cfg.functions)} functions found)")
            return None
        
        print(f"  0x{addr:x}: found as '{func.name}', decompiling...")
        dec = proj.analyses.Decompiler(func=func, cfg=cfg, normalize=True)
        if dec.codegen and dec.codegen.text:
            return dec.codegen.text
        else:
            print(f"  0x{addr:x}: decompiler returned no output")
            return None
    except Exception as e:
        print(f"  0x{addr:x}: error: {e}")
        return None


# === Phase 1: Map the import function's full call tree ===
print("=" * 70)
print("Phase 1: Map call targets from import function chain")
print("=" * 70)

import_func = 0x1403b0120
print(f"\nImport function: 0x{import_func:x}")
calls, leas, movs = get_calls_and_leas(import_func, 1200)
print(f"  {len(calls)} calls, {len(leas)} LEA RIP, {len(movs)} MOV RIP")

# Direct call targets (not indirect)
direct_calls = [(a, t) for a, t in calls if isinstance(t, int)]
print(f"  Direct call targets:")
for addr, target in direct_calls:
    print(f"    0x{addr:x} -> 0x{target:x}")

# Key functions called before the send loop:
# 0x14016dd60 and 0x1401461c0 are the setup functions
# 0x1403afad0 is the segment sender (called in loop)
# 0x1403b04a8 -> 0x1403afad0 is inside the loop

# Trace deeper: what do the setup functions call?
setup_funcs = [0x14016dd60, 0x1401461c0, 0x14064d410, 0x1403afad0]
for func_addr in setup_funcs:
    calls2, _, _ = get_calls_and_leas(func_addr, 1000)
    direct2 = [(a, t) for a, t in calls2 if isinstance(t, int)]
    print(f"\n0x{func_addr:x} calls ({len(direct2)} direct):")
    for addr, target in direct2[:25]:
        print(f"    0x{addr:x} -> 0x{target:x}")

# === Phase 2: Find deflate by searching for known patterns ===
print("\n" + "=" * 70)
print("Phase 2: Search for zlib deflate/deflateSetDictionary")
print("=" * 70)

# Known string VAs in .rdata
ZLIB_STRINGS = {
    0x1408324a0: "deflateEnd failed (ignored)",
    0x140831680: "incorrect header check",
    0x1407ec270: "1.2.3",
    0x140814711: "GZIPCompressorOutputStream.cpp",
    0x140814700: "GZIPDecompressorInputStream.cpp",
    0x1408e6d48: "Importing algorithm...",
    0x1407dee5a: "ImportAlgorithmToCurrentProgra",
    0x1407deeb8: "Import already in progress",
    0x1408e6d60: "Error sending segment",
}

for va, name in ZLIB_STRINGS.items():
    refs = find_rip_refs(va)
    print(f"  {name!r:45s} @ 0x{va:x}: {len(refs)} refs")
    for raddr, mn, op in refs[:5]:
        print(f"       0x{raddr:x}: {mn} {op}")

# === Phase 3: Search for deflateSetDictionary by instruction pattern ===
# deflateSetDictionary typically:
# 1. mov [rcx+?], rdx  (store dict pointer into z_stream)
# 2. mov [rcx+?], r8d  (store dict length)
# 3. call fill_hash_table
# 4. Returns length of bytes still needing processing
# Let's search for the pattern where a function stores into z_stream offsets
# and calls another function (fill_hash_table)

print("\n" + "=" * 70)
print("Phase 3: Search for deflate function by 'deflateEnd failed' xref")
print("=" * 70)

# Since direct LEA refs aren't found, try indirect: search for the STRING
# being loaded via a pointer that's in .rdata
# Look for 8-byte pointers to 0x1408324a0 in .rdata
target_ptr = struct.pack("<Q", 0x1408324a0)
rdata_foff = 0x6ef600  # file offset of .rdata
rdata_size = 0x31bc00
pos = 0
pointer_locs = []
while True:
    idx = EXE.find(target_ptr, rdata_foff, rdata_foff + rdata_size)
    if idx < 0:
        break
    ptr_va = IMG_BASE + idx
    pointer_locs.append(ptr_va)
    print(f"  Pointer to 'deflateEnd failed' found at .rdata VA 0x{ptr_va:x}")
    # Now find code refs to this pointer
    code_refs = find_rip_refs(ptr_va)
    print(f"    Code refs to pointer: {len(code_refs)}")
    for raddr, mn, op in code_refs[:5]:
        print(f"       0x{raddr:x}: {mn} {op}")
    pos = idx + 1

if not pointer_locs:
    print("  No pointer found, trying nearby addresses...")
    # The string might be at a slightly different address; scan a range
    for delta in range(-16, 17):
        test_va = 0x1408324a0 + delta
        refs = find_rip_refs(test_va)
        if refs:
            print(f"    Found ref to 0x{test_va:x} (delta={delta:+d})")
            for raddr, mn, op in refs[:3]:
                print(f"       0x{raddr:x}: {mn} {op}")

# === Phase 4: Search for deflatE by unique instruction sequences ===
print("\n" + "=" * 70)
print("Phase 4: Search for deflate() by instruction pattern in .text")
print("=" * 70)

# deflate() in zlib 1.2.x starts with:
#   push rbx / sub rsp, XX / test ecx, ecx / ...
# Key: it accesses z_stream fields at known struct offsets
# z_stream layout (zlib 1.2.x):
#   +0: next_in, +8: avail_in, +16: next_out, +24: avail_out
#   +32: msg, +40: state, +48: zalloc, +56: zfree, +64: opaque
#   +72: data_type, +80: adler, +88: reserved
# deflate() accesses state at [rax+40] (z_stream->state)

# The deflate function is typically large (>200 instructions)
# It references many internal zlib strings

# Alternative: search for the zlib version string "1.2.3" xref
# If we find the code that references "1.2.3", it's likely deflate() or inflate()
refs_123 = find_rip_refs(0x1407ec270)
print(f"  Refs to '1.2.3': {len(refs_123)}")
for raddr, mn, op in refs_123[:10]:
    print(f"    0x{raddr:x}: {mn} {op}")
    # Show context: 5 insns before and after
    ctx_code = get_code(raddr - 30, 80)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    ctx_insns = list(md.disasm(ctx_code, raddr - 30))
    for ci in ctx_insns:
        marker = " <<<" if ci.address == raddr else ""
        print(f"      0x{ci.address:x}: {ci.mnemonic} {ci.op_str}{marker}")
