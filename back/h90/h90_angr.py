#!/usr/bin/env python3
"""angr-based analyzer for the Windows x64 H90 Control.exe (v1.9.13).

Companion to h90_capstone.py (which targets the macOS arm64 slice). angr adds
CFG recovery, decompilation and string/xref analysis on top of raw
disassembly. Goal: locate the write-path zlib DEFLATE dictionary construction
(`deflateSetDictionary` / JUCE GZIPCompressorOutputStream caller) so the dict
can be recovered and scored against req1/req2_dict_constraints.json.

Usage:
  python h90_angr.py BINARY --info
  python h90_angr.py BINARY --funcs [N]                # CFGFast function list
  python h90_angr.py BINARY --decompile 0x14013b610    # decompile a function
  python h90_angr.py BINARY --findstr "1.2.3" "deflateEnd failed (ignored)"
  python h90_angr.py BINARY --xrefs 0x<VA>             # code xrefs to a VA
  python h90_angr.py BINARY --callers 0x<VA>           # callers via callgraph
  python h90_angr.py BINARY --flirt [sigs_path]        # FLIRT signature match

Flags: --no-cfg (use lightweight fast path where possible), --cache CFGJSON.
"""
import argparse
import json
import logging
import os
import sys

# silence the harmless pyvex-skew unicorn warning on this build (must be set
# BEFORE angr is imported — the engine module logs during `import angr`)
logging.getLogger("angr.state_plugins.unicorn_engine").setLevel(logging.CRITICAL)

import angr
import angr.analyses  # noqa: F401  (registers analyses)
import angr.flirt


def make_project(binary, keep_cfg=None):
    proj = angr.Project(binary, auto_load_libs=False)
    return proj


_CFG_CACHE = {}


def build_cfg(proj):
    key = proj.filename
    if key in _CFG_CACHE:
        return _CFG_CACHE[key]
    print("[*] building CFGFast (this can take minutes on JUCE apps)...", flush=True)
    cfg = proj.analyses.CFGFast()
    print("[*] CFGFast done: %d functions" % len(cfg.functions), flush=True)
    _CFG_CACHE[key] = cfg
    return cfg


def va_of_string(proj, s):
    mem = proj.loader.memory
    for seg in proj.loader.main_object.segments:
        if seg.filesize <= 0 or seg.memsize <= 0:
            continue
        try:
            data = mem.load(seg.vaddr, seg.filesize)
        except KeyError:
            continue
        idx = data.find(s.encode("ascii"))
        if idx >= 0:
            return seg.vaddr + idx
    return None


def cmd_info(proj, args):
    m = proj.loader.main_object
    print("binary      :", os.path.basename(m.binary))
    print("arch        :", proj.arch.name)
    print("entry       :", hex(proj.entry))
    print("image base  :", hex(m.mapped_base if hasattr(m, "mapped_base") else proj.loader.main_object.min_addr))
    print("min/max addr:", hex(proj.loader.main_object.min_addr), hex(proj.loader.main_object.max_addr))
    print("imports     :", len(m.imports))
    print("segments    :")
    for seg in m.segments:
        print("   %s vaddr=%#x memsz=%#x filesz=%#x" % (seg.name, seg.vaddr, seg.memsize, seg.filesize))


def cmd_funcs(proj, args):
    cfg = build_cfg(proj)
    n = args.funcs if args.funcs else 30
    items = sorted(cfg.functions.items(), key=lambda kv: kv[0])
    print("%-18s %-10s %s" % ("addr", "size", "name"))
    for addr, f in items[:n]:
        size = 0
        try:
            if f.code_block is not None:
                size = sum(f.code_block.addr_to_size.values())
        except Exception:
            pass
        print("%#-18x %-10d %s" % (addr, size, f.name))


def cmd_decompile(proj, args):
    cfg = build_cfg(proj)
    func = cfg.functions.get(args.decompile)
    if func is None:
        print("!! no function at %#x" % args.decompile)
        return
    print("[*] decompiling %#x (%s)..." % (func.addr, func.name), flush=True)
    dec = proj.analyses.Decompiler(func=func, cfg=cfg)
    if dec.codegen is not None:
        print(dec.codegen.text)
    else:
        print("!! decompiler produced no output")


def cmd_findstr(proj, args):
    for s in args.findstr:
        va = va_of_string(proj, s)
        if va is None:
            print("%-40s -> NOT FOUND" % (s,))
        else:
            print("%-40s -> %#x" % (s, va))


def rip_relative_refs(proj, target_vas):
    """Scan .text with capstone for RIP-relative LEA/MOV refs to target VAs.

    Returns {target_va: [(insn_addr, mnemonic, operand_text), ...]}. Fast, no CFG.
    """
    import capstone

    m = proj.loader.main_object
    text = [s for s in m.sections if s.name == ".text"][0]
    code = proj.loader.memory.load(text.vaddr, text.memsize)
    md = capstone.Cs(capstone.CS_ARCH_X86, capstone.CS_MODE_64)
    md.detail = True
    hits = {t: [] for t in target_vas}
    for insn in md.disasm(code, text.vaddr):
        if insn.mnemonic not in ("lea", "mov"):
            continue
        for op in insn.operands:
            if op.type != capstone.x86.X86_OP_MEM or op.mem.base != capstone.x86.X86_REG_RIP:
                continue
            tgt = insn.address + insn.size + op.mem.disp
            if tgt in target_vas:
                hits[tgt].append((insn.address, insn.mnemonic, insn.op_str))
    return hits


def cmd_scanstr(proj, args):
    targets = []
    for t in args.scanstr:
        if t.startswith("0x"):
            targets.append(int(t, 16))
        else:
            va = va_of_string(proj, t)
            if va is None:
                print("!! string not found: %r" % t)
            else:
                targets.append(va)
    if not targets:
        return
    print("[*] scanning .text for RIP-relative refs to %d target(s)..." % len(targets))
    hits = rip_relative_refs(proj, targets)
    for t in targets:
        refs = hits[t]
        print("target %#x : %d ref(s)" % (t, len(refs)))
        for insn_addr, mnem, op in refs:
            print("   %#x: %s %s" % (insn_addr, mnem, op))


def cmd_xrefs(proj, args):
    targets = []
    for t in args.xrefs:
        if t.startswith("0x"):
            va = int(t, 16)
        else:
            va = va_of_string(proj, t)
            if va is None:
                print("!! string not found: %r" % t)
                continue
        targets.append((va, t))
    if not targets:
        return
    cfg = build_cfg(proj)
    for va, label in targets:
        print("[*] xrefs to %#x (label %r)..." % (va, label))
        res = proj.analyses.XRefs(func=cfg.functions.get(va) or va)
        for dst, xrefs in res.xrefs_by_dst.items():
            for x in xrefs:
                print("   %#x -> %#x (%s)" % (x.insn_addr, x.block_addr, type(x).__name__))


def cmd_callers(proj, args):
    cfg = build_cfg(proj)
    cg = cfg.functions.callgraph
    preds = sorted(cg.predecessors(args.callers))
    print("[*] callers of %#x (%d)" % (args.callers, len(preds)))
    for p in preds:
        f = cfg.functions.get(p)
        print("   %#x  %s" % (p, f.name if f else ""))


def cmd_flirt(proj, args):
    import angr.analyses.flirt  # noqa: F401

    path = args.flirt
    if path:
        angr.flirt.load_signatures(path)
    else:
        # fall back to the bundled sig dir if present in this checkout
        bundled = os.path.join(os.path.dirname(angr.__file__), "flirt", "sigs")
        if not os.path.isdir(bundled):
            print("!! no FLIRT sig path given and no bundled sigs (dev build has none)")
            print("   fetch sigs e.g. from the angr release wheel's angr/flirt/sigs")
            return
        angr.flirt.load_signatures(bundled)
    build_cfg(proj)
    print("[*] running FlirtAnalysis...", flush=True)
    fa = proj.analyses.FlirtAnalysis()
    for lib, (sig, suggestions) in fa.matched_suggestions.items():
        print("=== library %s (sig %s): %d suggestions ===" % (lib, sig.sig_name, len(suggestions)))
        for addr, name in sorted(suggestions.items()):
            print("   %#x  %s" % (addr, name))


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("binary")
    ap.add_argument("--info", action="store_true")
    ap.add_argument("--funcs", nargs="?", type=int, const=30, metavar="N")
    ap.add_argument("--decompile", metavar="0xADDR")
    ap.add_argument("--findstr", nargs="+", metavar="STR")
    ap.add_argument("--scanstr", nargs="+", metavar="0xVA|STR", help="capstone RIP-rel xref scan (no CFG)")
    ap.add_argument("--xrefs", nargs="+", metavar="0xVA|STR")
    ap.add_argument("--callers", metavar="0xADDR")
    ap.add_argument("--flirt", nargs="?", const=True, metavar="SIGS_DIR")
    args = ap.parse_args()

    proj = make_project(args.binary)

    if args.info:
        cmd_info(proj, args)
    if args.funcs is not None:
        cmd_funcs(proj, args)
    if args.decompile:
        cmd_decompile(proj, args)
    if args.findstr:
        cmd_findstr(proj, args)
    if args.scanstr:
        cmd_scanstr(proj, args)
    if args.xrefs:
        cmd_xrefs(proj, args)
    if args.callers:
        cmd_callers(proj, args)
    if args.flirt is not None:
        cmd_flirt(proj, args)

    if not any([args.info, args.funcs is not None, args.decompile, args.findstr,
                args.scanstr, args.xrefs, args.callers, args.flirt is not None]):
        ap.print_help()


if __name__ == "__main__":
    main()
