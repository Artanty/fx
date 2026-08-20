#!/usr/bin/env python3
"""Collect all `bl` call targets in an address range (for function mapping)."""
import sys
sys.path.insert(0, '/Users/artyomantoshkin/server/fx/server')
import h90_capstone as C

BIN = '/Applications/Eventide/H90 Control.app/Contents/MacOS/H90 Control'
data = open(BIN, 'rb').read()
mo = C.MachO(data)
xf = C.XRefFinder(mo, verbose=True)

lo = int(sys.argv[1], 16) if len(sys.argv) > 1 else 0x1002f131c
hi = int(sys.argv[2], 16) if len(sys.argv) > 2 else 0x1002f4000
insns = xf.disasm(lo, (hi - lo) // 4)
calls = []
for ins in insns:
    if ins.mnemonic == 'bl':
        tgt = ins.operands[0].imm
        calls.append((ins.address, tgt))
    elif ins.mnemonic == 'blr':
        calls.append((ins.address, None))
print(f"{len(insns)} instructions, {len(calls)} calls in [{lo:#x}:{hi:#x}]:")
for addr, tgt in calls:
    print(f"  {addr:#x}: bl {tgt:#x}" if tgt else f"  {addr:#x}: blr (indirect)")
