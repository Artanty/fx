#!/usr/bin/env python3
"""capstone-based analyzer for H90 Control.app arm64 slice.

Finds xrefs (ADRP/ADD, ADR) to target VAs in __TEXT and disassembles the
referencing functions, to locate the write-payload JSON builder, base64
encoder and deflate dictionary construction.
"""
import argparse
import struct
import sys

import capstone

ARM64 = 0x0100000C
LC_SEGMENT_64 = 0x19
LC_UNIXTHREAD = 0x5
LC_SYMTAB = 0x2
N_PBUD = 0x8
N_ABS = 0x2


class MachO:
    def __init__(self, data):
        self.data = data
        self.sections = []  # (segname, sectname, addr, size, fileoff)
        self.is_fat = False
        if data[:4] == b'\xca\xfe\xba\xbe':
            self._parse_fat()
        else:
            self._parse_thin()

    def _parse_fat(self):
        nfat = struct.unpack('>I', self.data[4:8])[0]
        for i in range(nfat):
            off = 8 + i * 20
            cputype, _, sl_off, sl_size, _ = struct.unpack('>IIIII', self.data[off:off + 20])
            if cputype == ARM64:
                self.is_fat = True
                self._parse_thin(sl_off, sl_size)
                return
        raise ValueError('no arm64 slice in fat binary')

    def _parse_thin(self, base=0, length=None):
        data = self.data
        if length is None:
            length = len(data) - base
        self.base = base
        magic, ncmds = struct.unpack_from('<II', data, base)
        if magic not in (0xfeedfacf,):
            raise ValueError(f'not a 64-bit Mach-O (magic {magic:#x})')
        hdr_size = 32
        off = base + hdr_size
        self.arm64_base = base
        self.arm64_len = length
        for _ in range(ncmds):
            cmd, cmdsize = struct.unpack_from('<II', data, off)
            if cmd == LC_SEGMENT_64:
                segname = data[off + 8:off + 24].rstrip(b'\x00').decode()
                vmaddr, vmsize = struct.unpack_from('<QQ', data, off + 24)
                fileoff, filesize = struct.unpack_from('<QQ', data, off + 40)
                nsects = struct.unpack_from('<I', data, off + 64)[0]
                s = off + 72
                for _ in range(nsects):
                    sectname = data[s:s + 16].rstrip(b'\x00').decode()
                    sname = data[s + 16:s + 32].rstrip(b'\x00').decode()
                    saddr, ssize = struct.unpack_from('<QQ', data, s + 32)
                    soff = struct.unpack_from('<I', data, s + 48)[0]
                    self.sections.append((segname, sectname, saddr, ssize, base + soff))
                    s += 80
            off += cmdsize

    def va_to_off(self, va):
        for _, _, saddr, ssize, soff in self.sections:
            if saddr <= va < saddr + ssize:
                return soff + (va - saddr)
        return None

    def get_text(self):
        for seg, sec, addr, size, off in self.sections:
            if (seg, sec) == ('__TEXT', '__text'):
                return addr, size, off
        raise ValueError('no __text')


class XRefFinder:
    def __init__(self, mo, verbose=False):
        self.mo = mo
        self.verbose = verbose

    def find(self, targets, window=32):
        """Return {target_va: [ref_address,...]} for ADRP+ADD / ADR xrefs."""
        text_va, text_size, text_off = self.mo.get_text()
        text = self.mo.data[text_off:text_off + text_size]
        md = capstone.Cs(capstone.CS_ARCH_AARCH64, capstone.CS_MODE_ARM)
        md.detail = True
        want = set(targets)
        result = {t: [] for t in want}
        # last page seen per register, within window
        last_page = {}
        seen = 0
        for ins in md.disasm(text, text_va):
            seen += 1
            ops = ins.operands
            mnem = ins.mnemonic
            if mnem == 'adrp':
                reg, page = self._adrp(ins, ops)
                if reg is not None:
                    last_page[reg] = (ins.address, page)
            elif mnem == 'add':
                tgt = self._add(ins, ops, last_page, window)
                if tgt is not None and tgt in want:
                    result[tgt].append(ins.address)
            elif mnem == 'adr':
                tgt = self._adr(ins, ops)
                if tgt is not None and tgt in want:
                    result[tgt].append(ins.address)
            # prune stale page entries
            cur = ins.address
            for reg in list(last_page):
                if cur - last_page[reg][0] > window * 4:
                    del last_page[reg]
        return result

    def _adrp(self, ins, ops):
        if len(ops) < 2:
            return None, None
        reg = ops[0].reg
        imm = ops[1].imm
        if (imm >> 12) << 12 == imm:
            # capstone reports the absolute page address directly
            page = imm
        else:
            page = ((ins.address >> 12) << 12) + (imm << 12) & ((1 << 64) - 1)
        return reg, page

    def _add(self, ins, ops, last_page, window):
        if len(ops) < 3:
            return None
        rd, rn, imm = ops[0].reg, ops[1].reg, ops[2].imm
        if rd != rn:
            return None
        entry = last_page.get(rn)
        if entry is None:
            return None
        addr, page = entry
        if ins.address - addr > window * 4:
            return None
        return (page + imm) & ((1 << 64) - 1)

    def _adr(self, ins, ops):
        if len(ops) < 2:
            return None
        return (ins.address + ops[1].imm) & ((1 << 64) - 1)

    def disasm(self, va, count=80):
        """Disassemble forward from va for up to `count` instructions."""
        off = self.mo.va_to_off(va)
        if off is None:
            return []
        md = capstone.Cs(capstone.CS_ARCH_AARCH64, capstone.CS_MODE_ARM)
        md.detail = True
        out = []
        buf = self.mo.data[off:off + count * 4 + 4]
        for ins in md.disasm(buf, va):
            out.append(ins)
            if len(out) >= count:
                break
        return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('binary')
    ap.add_argument('--find', nargs='+', help='string literals (or @hex offsets) to xref')
    ap.add_argument('--disasm', help='hex VA to disassemble around')
    ap.add_argument('--window', type=int, default=32)
    ap.add_argument('--show', action='store_true', help='print referencing function disassembly')
    ap.add_argument('--vm', type=lambda s: int(s, 16), default=0x100000000, help='vmaddr of slice start (VA = fileoff + vm)')
    args = ap.parse_args()

    data = open(args.binary, 'rb').read()
    mo = MachO(data)

    if args.disasm:
        xf = XRefFinder(mo, verbose=True)
        insns = xf.disasm(int(args.disasm, 16))
        for ins in insns:
            print(f'{ins.address:016x}: {ins.mnemonic:8s} {ins.op_str}')
        return

    targets = []
    for t in args.find:
        if t.startswith('0x'):
            targets.append(int(t, 16))
        else:
            sl = data[mo.arm64_base:mo.arm64_base + mo.arm64_len]
            i = sl.find(t.encode())
            if i < 0:
                print(f'!! {t!r} not found in arm64 slice')
                continue
            va = (int(args.vm, 16) if isinstance(args.vm, str) else args.vm) + i
            targets.append(va)
            print(f'{t!r:32s} -> slice off {i:#x}  VA {va:#x}')

    xf = XRefFinder(mo)
    result = xf.find(targets, window=args.window)
    for t, refs in result.items():
        print(f'\n=== xrefs to VA {t:#x} ===')
        if not refs:
            print('  (none)')
        for r in refs:
            print(f'  {r:#x}')
            if args.show:
                for ins in xf.disasm(r - 8, 12):
                    print(f'    {ins.address:016x}: {ins.mnemonic:8s} {ins.op_str}')


if __name__ == '__main__':
    main()
