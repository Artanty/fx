#!/usr/bin/env python3
"""Enumerate the zlib neighborhood in H90 Control.exe and identify
deflateSetDictionary / deflate / JUCE gzip wrapper via call structure."""
import os
import pickle
import bisect
import struct
import pefile
import capstone
import re

HERE = os.path.dirname(__file__)
BINARY = r"C:\Program Files\Eventide\H90 Control.exe"

with open(BINARY, "rb") as f:
    EXE = f.read()

pe = pefile.PE(BINARY, fast_load=True)
IMG_BASE = pe.OPTIONAL_HEADER.ImageBase
SECTIONS = []
for s in pe.sections:
    SECTIONS.append({
        "name": s.Name.rstrip(b"\x00").decode("ascii", "replace"),
        "va": IMG_BASE + s.VirtualAddress,
        "vsize": s.Misc_VirtualSize,
        "foff": s.PointerToRawData,
        "rawsize": s.SizeOfRawData,
    })
TEXT = next(s for s in SECTIONS if s["name"] == ".text")


def va_to_foff(va):
    for sec in SECTIONS:
        if sec["va"] <= va < sec["va"] + max(sec["vsize"], sec["rawsize"]):
            return sec["foff"] + (va - sec["va"])
    return None


with open(os.path.join(HERE, "h90-captures", "h90_text_scan.pkl"), "rb") as f:
    cached = pickle.load(f)
call_targets = cached["call_targets"]
callers = cached["callers"]
starts = sorted(call_targets)


def func_of(va):
    i = bisect.bisect_right(starts, va) - 1
    return starts[i] if i >= 0 else None


def func_end(start):
    i = bisect.bisect_right(starts, start)
    return starts[i] if i < len(starts) else TEXT["va"] + TEXT["rawsize"]


md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
RIP_RE = re.compile(r"\[rip ([+-]) (0x[0-9a-f]+)\]")


def func_callees(fn):
    end = func_end(fn)
    blob = EXE[va_to_foff(fn):va_to_foff(fn) + min(end - fn, 0x8000)]
    out = []
    for insn in md.disasm(blob, fn):
        if insn.mnemonic == "call":
            try:
                out.append(int(insn.op_str, 16))
            except ValueError:
                pass
    return sorted(set(out))


KNOWN = {
    0x140450860: "deflateEnd",
    0x140450950: "deflate?",
    0x1404512a0: "?calls-deflate",
    0x140451440: "deflateReset",
    0x1404515f0: "deflateInit2_",
    0x14044d700: "inflate?",
    0x14044f1b0: "inflate-helper?",
}

LO, HI = 0x14044b000, 0x140452400
print(f"=== functions in 0x{LO:x}..0x{HI:x} ===")
i = bisect.bisect_left(starts, LO)
while i < len(starts) and starts[i] < HI:
    fn = starts[i]
    end = func_end(fn)
    size = end - fn
    ncallers = len(callers.get(fn, set()))
    callees = func_callees(fn)
    known_callees = [f"{KNOWN[c]}(0x{c:x})" for c in callees if c in KNOWN]
    print(f"0x{fn:x} size={size:6d} callers={ncallers:3d} callees={len(callees):2d}"
          + ("" if not known_callees else "  -> " + ",".join(known_callees)))
    i += 1

# who calls deflateInit2_ / deflate? outside zlib
print("\n=== callers of deflateInit2_ (0x1404515f0) ===")
for c in sorted(callers.get(0x1404515f0, ())):
    print(f"  call site 0x{c:x} in func 0x{func_of(c):x}")

print("\n=== callers of deflate? (0x140450950) ===")
for c in sorted(callers.get(0x140450950, ())):
    print(f"  call site 0x{c:x} in func 0x{func_of(c):x}")

# configuration_table xrefs
print("\n=== rip-refs to configuration_table 0x140816b30 ===")
rip_refs = cached["rip_refs"]
for raddr, mn in sorted(rip_refs.get(0x140816b30, [])):
    print(f"  0x{raddr:x} ({mn}) in func 0x{func_of(raddr):x}")
