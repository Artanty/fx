import lldb
import traceback

SIGS = [b'LFOShape-obj', b'PitchJumpInterval', b'terval-obj',
        b'DELAYMODE-obj', b'Tap2DelayDivision', b'Mix-obj', b'Depth-obj']
state = {'seg': 0}
log = open('/tmp/h90_dict_capture.log', 'a', buffering=1)


def get_reg(frame, name):
    try:
        regs = frame.GetRegisters()
        for i in range(regs.GetSize()):
            rs = regs.GetValueAtIndex(i)
            if not rs.IsValid():
                continue
            rname = rs.GetName() or ''
            if 'General' in rname or rname == 'GPR':
                v = rs.GetChildMemberWithName(name)
                if v.IsValid():
                    return v.GetValueAsUnsigned()
    except Exception:
        pass
    return 0


def scan_heap(target, process):
    hits = []
    try:
        addr = 0
        while True:
            info = lldb.SBMemoryRegionInfo()
            err = target.GetMemoryRegionInfo(addr, info)
            if not err.Success():
                break
            start = info.GetRegionBase()
            end = info.GetRegionEnd()
            if info.IsWritable() and end > start and end - start < 0x4000000:
                base = start
                while base < end:
                    chunk = min(0x100000, end - base)
                    data = process.ReadMemory(base, chunk)
                    if data:
                        for sig in SIGS:
                            idx = data.find(sig)
                            if idx >= 0:
                                hits.append((base + idx, sig))
                    base += chunk
            addr = end
            if addr <= 0 or addr > 0x7fff00000000:
                break
    except Exception:
        pass
    return hits


def on_midi_send(frame, bp_loc, internal_dict):
    try:
        thread = frame.GetThread()
        process = thread.GetProcess()
        target = process.GetTarget()
        log.write('STOP reason=%s\n' % thread.GetStopReason())
        x1 = get_reg(frame, 'x1')
        x2 = get_reg(frame, 'x2')
        c1 = int.from_bytes(process.ReadMemory(x1 + 16, 4), 'little') if x1 else 0
        c2 = int.from_bytes(process.ReadMemory(x2 + 16, 4), 'little') if x2 else 0
        log.write('  x1=0x%x c1=0x%x  x2=0x%x c2=0x%x\n' % (x1, c1, x2, c2))
        evtlist = None
        count = 0
        if c1 in (0x3e, 0x2e):
            evtlist, count = x1, c1
        elif c2 in (0x3e, 0x2e):
            evtlist, count = x2, c2
        if not evtlist:
            log.write('  not import - continuing\n')
            process.Continue()
            return
        state['seg'] += 1
        seg = state['seg']
        log.write('== IMPORT SEND %d count=0x%x ==\n' % (seg, count))
        nwords = int.from_bytes(process.ReadMemory(evtlist + 12, 4), 'little')
        if 0 < nwords < 4000:
            words = process.ReadMemory(evtlist, nwords * 4)
            if words:
                open('/tmp/import_seg_%d.bin' % seg, 'wb').write(words)
                log.write('  dumped %d words\n' % nwords)
        hits = scan_heap(target, process)
        for h in hits:
            log.write('  HIT 0x%x %s\n' % (h[0], h[1]))
        if hits:
            pre = max(0, hits[0][0] - 16384)
            dump = process.ReadMemory(pre, 65536)
            if dump:
                open('/tmp/h90_dict_capture.bin', 'wb').write(dump)
                log.write('  saved /tmp/h90_dict_capture.bin 64KB @ 0x%x\n' % pre)
            log.write('DONE hit found\n')
            return
        if seg >= 6:
            log.write('DONE no hit after %d sends\n' % seg)
            return
        log.write('  no hit yet, continuing\n')
        process.Continue()
    except Exception:
        try:
            log.write('ERROR: ' + traceback.format_exc())
        except Exception:
            pass
        try:
            frame.GetThread().GetProcess().Continue()
        except Exception:
            pass
