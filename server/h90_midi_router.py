#!/usr/bin/env python3
"""H90 MIDI router/capture for Windows (python-rtmidi).

Sits between the H90 Control app and the physical H90, forwarding SysEx in both
directions and logging everything, so we can capture the app's real import
traffic (resolving the LZ77 dictionary + JSON subset) and replay verified
frames.

Topology with Bome MIDI Translator virtual ports:
   App output --(virtual IN)--> [router] --(physical H90 OUT)--> pedal
   pedal --(physical H90 IN)--> [router] --(virtual OUT)--> App input

Usage:
  python h90_midi_router.py --app-in PORT --app-out PORT \
        --pedal-in PORT --pedal-out PORT [--outdir DIR]
"""
import sys, os, time, argparse, threading
import rtmidi


def find_port(lst, name, clist):
    for i, p in enumerate(lst):
        if name.lower() in p.lower():
            return i, p
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app-in", required=True, help="App output -> router (virtual IN)")
    ap.add_argument("--app-out", required=True, help="Router -> App input (virtual OUT)")
    ap.add_argument("--pedal-in", required=True, help="Pedal -> router (physical H90 IN)")
    ap.add_argument("--pedal-out", required=True, help="Router -> pedal (physical H90 OUT)")
    ap.add_argument("--outdir", default=r"C:\Users\Thoma\AppData\Local\Temp\opencode\h90_router_capture")
    ap.add_argument("--timeout", type=float, default=0, help="auto-stop seconds (0=until Ctrl-C)")
    args = ap.parse_args()

    os.makedirs(args.outdir, exist_ok=True)
    log_tx = open(os.path.join(args.outdir, "tx.log"), "a")
    log_rx = open(os.path.join(args.outdir, "rx.log"), "a")
    seq = {"n": 0}

    def emit(thefile, direction, data):
        seq["n"] += 1
        n = seq["n"]
        ts = time.strftime("%H:%M:%S") + f".{int(time.time()*1000)%1000:03d}"
        line = f"{ts} [{direction}] len={len(data)} {data.hex()}\n"
        thefile.write(line)
        thefile.flush()
        print(line.rstrip())

    # ---- open ports ----
    mo = rtmidi.MidiOut()
    mi = rtmidi.MidiIn()

    # app side
    aos = [p for p in mo.get_ports()]
    ais = [p for p in mi.get_ports()]

    ai_idx, ai_name = find_port(ais, args.app_in, "app-in")
    ao_idx, ao_name = find_port(aos, args.app_out, "app-out")
    # pedal side
    pi_idx, pi_name = find_port(ais, args.pedal_in, "pedal-in")
    po_idx, po_name = find_port(aos, args.pedal_out, "pedal-out")

    for name, idx in [("app-in", ai_idx), ("app-out", ao_idx),
                      ("pedal-in", pi_idx), ("pedal-out", po_idx)]:
        if idx is None:
            print(f"ABORT: port '{name}' not found.")
            sys.exit(1)

    print(f"app-in   = port[{ai_idx}] {ai_name}")
    print(f"app-out  = port[{ao_idx}] {ao_name}")
    print(f"pedal-in = port[{pi_idx}] {pi_name}")
    print(f"pedal-out= port[{po_idx}] {po_name}")

    # app-in: the app writes here; forward to pedal-out
    def app_input_cb(data_bytes, delta, ud=None):
        b = bytes(data_bytes)
        emit(log_tx, "TX(app->pedal)", b)
        try:
            po.send_message(list(b))
        except Exception as e:
            print("  !! pedal-out write err", e)

    # pedal-in: the pedal writes here; forward to app-out
    def pedal_input_cb(data_bytes, delta, ud=None):
        b = bytes(data_bytes)
        emit(log_rx, "RX(pedal->app)", b)
        try:
            ao.send_message(list(b))
        except Exception as e:
            print("  !! app-out write err", e)

    mi.ignore_types(False, False, False)

    ai = rtmidi.MidiIn()
    ai.open_port(ai_idx)
    ai.set_callback(app_input_cb)
    pi = rtmidi.MidiIn()
    pi.open_port(pi_idx)
    pi.set_callback(pedal_input_cb)

    ao = rtmidi.MidiOut()
    ao.open_port(ao_idx)
    po = rtmidi.MidiOut()
    po.open_port(po_idx)

    print("Router running. Logging to", args.outdir, "  (Ctrl-C to stop)")
    try:
        if args.timeout:
            time.sleep(args.timeout)
        else:
            while True:
                time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        ai.cancel_callback(); pi.cancel_callback()
        ai.close_port(); pi.close_port(); ao.close_port(); po.close_port()
        log_tx.close(); log_rx.close()
        print("Router stopped.")


if __name__ == "__main__":
    main()
