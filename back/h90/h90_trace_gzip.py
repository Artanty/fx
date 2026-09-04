#!/usr/bin/env python3
"""Trace the zlib deflate/dictionary path in H90 Control.exe.

Pipeline:
1. Parse PE sections (pefile) -> correct VA<->file-offset mapping.
2. Locate anchor strings ("deflateEnd failed (ignored)", z_errmsg entries)
   and the zlib z_errmsg[] pointer table in .rdata.
3. One linear capstone pass over .text builds:
   - rip-relative reference map (target VA -> [insn VAs])
   - call-target set (function starts) + callee->callers map
4. Xref anchors -> containing functions -> call graph around the JUCE
   GZIPCompressorOutputStream path -> candidate deflate/deflateSetDictionary.
"""
import pefile
import capstone
import re
import struct
import bisect
from collections import defaultdict

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
for sec in SECTIONS:
    print("section %-8s va=0x%x vsize=0x%x foff=0x%x raw=0x%x" %
          (sec["name"], sec["va"], sec["vsize"], sec["foff"], sec["rawsize"]))

TEXT = next(s for s in SECTIONS if s["name"] == ".text")
RDATA = next(s for s in SECTIONS if s["name"] == ".rdata")


def va_to_foff(va):
    for sec in SECTIONS:
        if sec["va"] <= va < sec["va"] + max(sec["vsize"], sec["rawsize"]):
            return sec["foff"] + (va - sec["va"])
    return None


def foff_to_va(foff):
    for sec in SECTIONS:
        if sec["foff"] <= foff < sec["foff"] + sec["rawsize"]:
            return sec["va"] + (foff - sec["foff"])
    return None


def read_cstr(va, maxlen=120):
    foff = va_to_foff(va)
    if foff is None:
        return None
    end = EXE.find(b"\x00", foff, foff + maxlen)
    if end < 0:
        return None
    return EXE[foff:end]


# --- 1. anchor strings -----------------------------------------------------
ANCHORS = {}
for name, pat in [
    ("deflateEnd failed", b"deflateEnd failed"),
    ("need dictionary", b"need dictionary\x00"),
    ("buffer error", b"buffer error\x00"),
    ("stream error", b"stream error\x00"),
    ("insufficient memory", b"insufficient memory\x00"),
    ("incompatible version", b"incompatible version\x00"),
    ("GZIPCompressorOutputStream.cpp", b"GZIPCompressorOutputStream.cpp"),
    ("zlib version 1.2.3", b"\x001.2.3\x00"),
    ("incorrect header check", b"incorrect header check\x00"),
    ("invalid distance too far", b"invalid distance too far back\x00"),
]:
    idx = EXE.find(pat)
    while idx >= 0:
        va = foff_to_va(idx + (1 if pat.startswith(b"\x00") else 0))
        if va is not None:
            ANCHORS.setdefault(name, []).append(va)
            break
        idx = EXE.find(pat, idx + 1)

print("\n=== anchor strings ===")
for name, vas in ANCHORS.items():
    for va in vas:
        print(f"  {name:35s} 0x{va:x}")

# --- 2. z_errmsg pointer table ---------------------------------------------
print("\n=== z_errmsg table hunt ===")
need_dict_va = ANCHORS["need dictionary"][0]
ptr = struct.pack("<Q", need_dict_va)
table_va = None
pos = RDATA["foff"]
while True:
    idx = EXE.find(ptr, pos, RDATA["foff"] + RDATA["rawsize"])
    if idx < 0:
        break
    # check previous qword is a pointer to "" or something, and next entries
    # look like pointers into .rdata
    ok = True
    entries = []
    for k in range(-1, 9):
        off = idx + k * 8
        if off < RDATA["foff"] or off + 8 > RDATA["foff"] + RDATA["rawsize"]:
            ok = False
            break
        val = struct.unpack_from("<Q", EXE, off)[0]
        entries.append(val)
    if ok:
        strs = []
        for val in entries:
            s = read_cstr(val) if val else b""
            strs.append(s[:30] if s and all(32 <= b < 127 or b in (0,) for b in s[:30]) else None)
        printable = sum(1 for s in strs if s)
        if printable >= 5:
            table_va = foff_to_va(idx)
            print(f"  candidate table at 0x{table_va:x}:")
            for k, (val, s) in enumerate(zip(entries, strs)):
                tag = {k: "<-- need dictionary"}.get(k, "")
                print(f"    [{k}] 0x{val:x} {s!r} {tag}")
            break
    pos = idx + 1

# --- 3. linear capstone pass over .text (cached) ----------------------------
print("\n=== linear disassembly of .text (this takes a moment) ===")
import os
import pickle

CACHE = os.path.join(os.path.dirname(__file__), "h90-captures", "h90_text_scan.pkl")
text_foff = TEXT["foff"]
text_size = TEXT["rawsize"]
text_va = TEXT["va"]

if os.path.exists(CACHE):
    with open(CACHE, "rb") as f:
        cached = pickle.load(f)
    rip_refs = cached["rip_refs"]
    call_targets = cached["call_targets"]
    callers = cached["callers"]
    print("  loaded from cache", CACHE)
else:
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    RIP_RE = re.compile(r"\[rip ([+-]) (0x[0-9a-f]+)\]")

    rip_refs = defaultdict(list)      # target_va -> [(insn VAs)]
    call_targets = set()              # function starts (approximation)
    callers = defaultdict(set)        # callee -> set(caller insn va)

    code = EXE[text_foff:text_foff + text_size]
    n_insns = 0
    pos = 0
    while pos < len(code):
        advanced = False
        for insn in md.disasm(code[pos:], text_va + pos):
            n_insns += 1
            m = RIP_RE.search(insn.op_str)
            if m:
                disp = int(m.group(2), 16)
                if m.group(1) == "-":
                    disp = -disp
                tgt = insn.address + insn.size + disp
                rip_refs[tgt].append((insn.address, insn.mnemonic))
            if insn.mnemonic == "call":
                try:
                    tgt = int(insn.op_str, 16)
                except ValueError:
                    continue
                call_targets.add(tgt)
                callers[tgt].add(insn.address)
            pos = insn.address + insn.size - text_va
            advanced = True
        if not advanced:
            pos += 1  # skip invalid byte, resync
    print(f"  {n_insns} instructions, {len(call_targets)} call targets, "
          f"{len(rip_refs)} rip-ref targets")
    with open(CACHE, "wb") as f:
        pickle.dump({"rip_refs": dict(rip_refs), "call_targets": call_targets,
                     "callers": dict(callers)}, f)
    print("  cached to", CACHE)

rip_refs = defaultdict(list, rip_refs)
callers = defaultdict(set, callers)

starts = sorted(call_targets)


def func_of(va):
    i = bisect.bisect_right(starts, va) - 1
    if i < 0:
        return None
    return starts[i]


def func_end(start):
    i = bisect.bisect_right(starts, start)
    if i < len(starts):
        return starts[i]
    return text_va + text_size


# --- 4. xref anchors --------------------------------------------------------
print("\n=== code xrefs to anchors ===")
interesting_funcs = set()
for name, vas in ANCHORS.items():
    for va in vas:
        refs = rip_refs.get(va, [])
        print(f"  {name!r} @ 0x{va:x}: {len(refs)} refs")
        for raddr, mn in refs[:8]:
            fn = func_of(raddr)
            print(f"    0x{raddr:x} ({mn}) in func 0x{fn:x}" if fn else
                  f"    0x{raddr:x} ({mn}) [no func]")
            if fn:
                interesting_funcs.add(fn)

if table_va is not None:
    refs = rip_refs.get(table_va, [])
    print(f"\n  z_errmsg table @ 0x{table_va:x}: {len(refs)} direct refs")
    for raddr, mn in refs[:20]:
        fn = func_of(raddr)
        print(f"    0x{raddr:x} ({mn}) in func 0x{fn:x}" if fn else
              f"    0x{raddr:x} ({mn}) [no func]")
        if fn:
            interesting_funcs.add(fn)
    # also refs to individual entries (base+k*8 encoded in displacement)
    for k in range(1, 10):
        for raddr, mn in rip_refs.get(table_va + k * 8, []):
            fn = func_of(raddr)
            if fn:
                interesting_funcs.add(fn)

# --- 5. call graph around the JUCE gzip wrapper -----------------------------
print("\n=== functions referencing 'deflateEnd failed' / gzip cpp string ===")
juce_funcs = set()
for name in ("deflateEnd failed", "GZIPCompressorOutputStream.cpp"):
    for va in ANCHORS.get(name, []):
        for raddr, _mn in rip_refs.get(va, []):
            fn = func_of(raddr)
            if fn:
                juce_funcs.add(fn)

for fn in sorted(juce_funcs):
    end = func_end(fn)
    print(f"\n-- func 0x{fn:x} .. 0x{end:x} ({end - fn} bytes)")
    # callees
    callees = sorted({int(insn.op_str, 16)
                      for insn in md.disasm(EXE[va_to_foff(fn):va_to_foff(fn) + min(end - fn, 0x3000)], fn)
                      if insn.mnemonic == "call" and insn.op_str.startswith("0x")})
    print(f"   callees ({len(callees)}):")
    for c in callees[:40]:
        cend = func_end(c)
        size = cend - c
        ncallers = len(callers.get(c, ()))
        print(f"     0x{c:x}  size={size:6d}  callers={ncallers}")

print("\n=== zlib-candidate functions (ref z_errmsg table, called from juce funcs) ===")
zlib_anchors = [table_va + k * 8 for k in range(0, 10)] if table_va else []
zlib_ref_funcs = set()
for tva in zlib_anchors:
    for raddr, _mn in rip_refs.get(tva, []):
        fn = func_of(raddr)
        if fn:
            zlib_ref_funcs.add(fn)
print(f"  {len(zlib_ref_funcs)} functions reference z_errmsg entries:")
for fn in sorted(zlib_ref_funcs):
    end = func_end(fn)
    ncallers = len(callers.get(fn, ()))
    print(f"    0x{fn:x} size={end - fn:7d} callers={ncallers}")

# --- 6. disassembly dump of candidates --------------------------------------
print("\n=== dumping candidate disassembly ===")
OUTDIR = os.path.join(os.path.dirname(__file__), "h90-captures", "h90_zlib_disasm")
os.makedirs(OUTDIR, exist_ok=True)

md2 = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)


def dump_func(fn, extra=()):
    end = func_end(fn)
    blob = EXE[va_to_foff(fn):va_to_foff(fn) + (end - fn)]
    lines = []
    for insn in md2.disasm(blob, fn):
        ann = ""
        m = RIP_RE.search(insn.op_str)
        if m:
            disp = int(m.group(2), 16) * (-1 if m.group(1) == "-" else 1)
            tgt = insn.address + insn.size + disp
            s = read_cstr(tgt)
            if s and len(s) >= 3:
                try:
                    ann = f"   ; \"{s.decode('ascii')}\""
                except UnicodeDecodeError:
                    ann = f"   ; -> 0x{tgt:x}"
            else:
                ann = f"   ; -> 0x{tgt:x}"
        lines.append(f"0x{insn.address:x}: {insn.mnemonic} {insn.op_str}{ann}")
    path = os.path.join(OUTDIR, f"{fn:x}.asm")
    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    return path


CANDIDATES = sorted(set(juce_funcs) | zlib_ref_funcs |
                    {0x140450860, 0x140451440, 0x1404515f0, 0x140450950})
for fn in CANDIDATES:
    path = dump_func(fn)
    end = func_end(fn)
    cl = sorted(callers.get(fn, ()))
    caller_funcs = sorted({func_of(c) for c in cl})
    print(f"  0x{fn:x} ({end - fn} B) -> {path}")
    print(f"    callers ({len(cl)}): " +
          ", ".join(f"0x{c:x}" for c in cl[:12]) +
          (f" ... funcs: {[hex(f) for f in caller_funcs[:8]]}" if caller_funcs else ""))

print("\ndone")
