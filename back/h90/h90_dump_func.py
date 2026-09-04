#!/usr/bin/env python3
"""Dump annotated disassembly of a function from H90 Control.exe.
Usage: python h90_dump_func.py 0x14013e970 [more_addrs...]"""
import os
import sys
import pickle
import bisect
import pefile
import capstone
import re

HERE = os.path.dirname(os.path.abspath(__file__))
BINARY = r"C:\Program Files\Eventide\H90 Control.exe"
OUTDIR = os.path.join(HERE, "h90-captures", "h90_zlib_disasm")

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


def read_cstr(va, maxlen=120):
    foff = va_to_foff(va)
    if foff is None:
        return None
    end = EXE.find(b"\x00", foff, foff + maxlen)
    if end < 0:
        return None
    return EXE[foff:end]


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


def dump(fn):
    end = func_end(fn)
    blob = EXE[va_to_foff(fn):va_to_foff(fn) + (end - fn)]
    lines = []
    for insn in md.disasm(blob, fn):
        ann = ""
        m = RIP_RE.search(insn.op_str)
        if m:
            disp = int(m.group(2), 16) * (-1 if m.group(1) == "-" else 1)
            tgt = insn.address + insn.size + disp
            s = read_cstr(tgt)
            if s and len(s) >= 3:
                try:
                    ann = '   ; "%s"' % s.decode("ascii")
                except UnicodeDecodeError:
                    ann = "   ; -> 0x%x" % tgt
            else:
                ann = "   ; -> 0x%x" % tgt
        if insn.mnemonic == "call":
            ann += "   [CALL]"
        lines.append("0x%x: %s %s%s" % (insn.address, insn.mnemonic, insn.op_str, ann))
    path = os.path.join(OUTDIR, "%x.asm" % fn)
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    print("dumped 0x%x..0x%x (%d B) -> %s" % (fn, end, end - fn, path))


for arg in sys.argv[1:]:
    dump(int(arg, 16))
