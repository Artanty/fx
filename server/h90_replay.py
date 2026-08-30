#!/usr/bin/env python3
"""Replay a captured H90 import frame via MIDI SysEx (python-rtmidi).

Sends the raw TRPC frame to the H90 and reads back any response.
IMPORTANT: must use a rtmidi CALLBACK receiver; plain get_message() polling
misses the H90 responses on the Windows USB MIDI driver.

Usage:
    python h90_replay.py [--file h90_import_req.bin] [--dry-run]
"""
import sys, os, time, argparse, threading
import rtmidi

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
DEFAULT_FILE = os.path.join(SCRIPT_DIR, "h90-captures", "h90_import_req.bin")
OUT_PORT = "H90 Pedal 1"
IN_PORT = "H90 Pedal 0"


def find_port(midi_cls, name, want):
    ports = midi_cls.get_ports()
    for i, p in enumerate(ports):
        if name in p:
            return i, p
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--file", default=DEFAULT_FILE)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--listen-only", action="store_true")
    ap.add_argument("--timeout", type=float, default=4.0)
    args = ap.parse_args()

    if args.list:
        print("MIDI output ports:")
        mo = rtmidi.MidiOut()
        for i, p in enumerate(mo.get_ports()):
            print(f"  [{i}] {p}")
        print("MIDI input ports:")
        mi = rtmidi.MidiIn()
        for i, p in enumerate(mi.get_ports()):
            print(f"  [{i}] {p}")
        return

    # ---- Read capture ----
    frame = bytearray(open(args.file, "rb").read())
    print(f"File: {args.file}")
    print(f"Size: {len(frame)} bytes")

    if frame[0] != 0xF0:
        print("ERROR: file does not start with 0xF0")
        sys.exit(1)
    if frame[-1] != 0xF7:
        print("Appending missing 0xF7 (SysEx end) trailer")
        frame.append(0xF7)

    header = frame[:8]
    msgid = (header[4] << 7) | header[5]
    mtype = (header[6] << 7) | header[7]
    payload = bytes(frame[8:-1])
    print(f"Header: {header.hex()}")
    print(f"  msgid: 0x{msgid:04x}  type: 0x{mtype:04x}")
    print(f"Payload: {len(payload)} bytes")
    print(f"  First: {payload[:12].hex()}")
    if payload[:2] == b"\x78\x9c":
        print(f"  Zlib header confirmed (78 9c)")

    if args.dry_run:
        print("\nDRY RUN - not sending")
        return

    # ---- Open input for response ----
    mi = rtmidi.MidiIn()
    in_idx, _ = find_port(mi, IN_PORT, "input")
    if in_idx is None:
        print(f"ABORT: input port '{IN_PORT}' not found")
        sys.exit(1)
    mi.open_port(in_idx)

    # ---- Read responses via callback (must be set up BEFORE sending) ----
    from ctypes import cdll
    responses = []
    lock = threading.Lock()

    def cb(data_bytes, delta, userdata=None):
        with lock:
            responses.append(bytes(data_bytes))
            print(f"  RX {len(responses)}: {len(data_bytes)} bytes  " +
                  f"hex={bytes(data_bytes).hex()[:80]}")

    mi.ignore_types(False, False, False)
    mi.set_callback(cb)

    # ---- Open output ----
    mo = rtmidi.MidiOut()
    out_idx, name = find_port(mo, OUT_PORT, "output")
    if out_idx is None:
        print(f"ABORT: output port '{OUT_PORT}' not found")
        sys.exit(1)
    mo.open_port(out_idx)
    print(f"\nH90 output: port[{out_idx}] '{name}'")
    print(f"Listening on: port[{in_idx}] '{mi.get_ports()[in_idx]}'")

    if args.listen_only:
        print("Listen-only mode. Waiting for incoming SysEx...")
    else:
        # ---- Send ----
        sysex = list(frame)  # include F0 and F7
        print(f"\nSending {len(sysex)} bytes (including F0...F7)...")
        mo.send_message(sysex)
        print("Sent.")

        # ---- Read responses ----
    begin = time.time()
    while time.time() - begin < args.timeout:
        time.sleep(0.1)
    print(f"\nTotal responses: {len(responses)} (listened {args.timeout:.1f}s)")

    # Save responses
    for i, r in enumerate(responses):
        path = os.path.join(SCRIPT_DIR, "h90-captures", f"replay_resp_{i}.bin")
        with open(path, "wb") as f:
            f.write(r)
        print(f"Saved {path} ({len(r)} bytes)")

    mi.cancel_callback()

    mi.close_port()
    mo.close_port()
    print("Ports closed.")


if __name__ == "__main__":
    main()
