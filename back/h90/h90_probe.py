#!/usr/bin/env python3
"""Probe H90 pedal state via MIDI read-query, watching for knob changes.

Periodically sends the H90 read-state query and logs a compact fingerprint of
each SysEx response. Run `h90_ui.py --set <knob> <value>` in another shell
while this runs, then diff the fingerprints to see which bytes the knob
changed.

This mimics the single successful raw-RX session: python-rtmidi callback +
line-code read-state query.
"""
import sys, time, argparse, threading, os
import rtmidi

OUT_PORT = "H90 Pedal 1"
IN_PORT = "H90 Pedal 0"

QUERY = bytes([
    0xF0,0x1C,0x77,0x00,0x01,0x16,0x00,0x03,
    0x0C,0x00,0x00,0x00,0x00,0x01,0x00,0x06,
    0x00,0x0E,0x00,0x40,0x00,0x00,0x02,0x00,
    0x00,0x00,0x00,0x00,0x00,0x60,0x00,0x04,
    0x00,0x00,0x00,0x20,0x00,0x00,0x01,0x00,
    0x04,0x00,0x00,0x00,0x00,0x00,0xF7,
])

def find_port(cls, name):
    for i, p in enumerate(cls.get_ports()):
        if name in p:
            return i
    return None

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--duration", type=float, default=30.0)
    ap.add_argument("--full", action="store_true", help="dump full hex of each frame")
    args = ap.parse_args()

    mo = rtmidi.MidiOut()
    oi = find_port(mo, OUT_PORT)
    if oi is None:
        print("OUT port not found"); return
    mo.open_port(oi)

    mi = rtmidi.MidiIn()
    ii = find_port(mi, IN_PORT)
    if ii is None:
        print("IN port not found"); return
    mi.open_port(ii)
    mi.ignore_types(False, False, False)  # capture short msgs + sysex + clock

    buf = []
    lock = threading.Lock()

    def cb(event, data):
        msg, delta = event
        b = bytes(msg)
        with lock:
            if b and b[0] == 0xF0:
                buf.append(b)

    mi.set_callback(cb)

    print(f"probe start: query every {args.interval}s for {args.duration}s")
    print("Press Ctrl+C to stop early.")
    start = time.time()
    seq = 0
    try:
        while time.time() - start < args.duration:
            seq += 1
            with lock:
                buf.clear()
            mo.send_message(QUERY)
            # count responses within this window
            t0 = time.time()
            got = []
            while time.time() - t0 < 1.2:
                with lock:
                    if buf:
                        got = list(buf)
                        buf.clear()
                        break
                time.sleep(0.02)
            if got:
                for i, f in enumerate(got):
                    if args.full:
                        print(f"[{seq}.{i}] {f.hex()}")
                    else:
                        # compact fingerprint
                        print(f"[{seq}.{i}] len={len(f)} head={f[:16].hex()} tail={f[-12:].hex()}")
            else:
                print(f"[{seq}] (no response)")
            time.sleep(max(0.0, args.interval - 1.2))
    except KeyboardInterrupt:
        print("stopped")

if __name__ == "__main__":
    main()
