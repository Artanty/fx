"""Feasibility probe: can we enumerate Ducked Delay knob values over MIDI CC?

1. Connect to the running Eventide Control app, pin the window.
2. List current parameter rows (labels + value rect + w/h) — see the loaded effect.
3. Assign Wet Mix -> MIDI CC 50 (reuse assign_cc.assign_knob).
4. Stream CC50 values 0..127 through the node midi pipe, reading the live
   readout each step, and print where the readout moves.

This validates the whole "CC value -> app readout" path before the full sweep.
"""

import json
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import assign_cc
import h90_app
import uia_driver


def readout(row):
    return uia_driver.readout_text(row)


def knob_tuple_from_row(row):
    r = row["edit"].element_info.rectangle
    return (row["label"], r.left, r.top, r.width(), r.height())


def main():
    pid = h90_app.find_pid()
    print("PID", pid)
    d = h90_app.desktop()
    h90_app.pin_window()
    from pywinauto.keyboard import send_keys
    send_keys("{ESC}")
    time.sleep(0.4)
    assign_cc.close_popup(d, pid)

    win = uia_driver.get_window(h90_app.connect())
    rows = uia_driver.collect_params(win)
    print("rows: %d" % len(rows))
    for r in rows:
        rr = r["edit"].element_info.rectangle
        print("  %-22s = %-12r ex=%d ey=%d w=%d h=%d%s"
              % (r["label"], r["value"], r["ex"], r["ey"], rr.width(), rr.height(),
                 " slider" if r["slider"] is not None else ""))

    if not rows:
        print("no param rows - cannot proceed")
        return

    target = None
    for r in rows:
        if r["label"].strip().lower() == "wet mix":
            target = r
            break
    if target is None:
        print("Wet Mix row not found")
        return

    print("\n-- assign Wet Mix -> CC 50 --")
    result = assign_cc.assign_knob(d, pid, knob_tuple_from_row(target), 50)
    print("assign:", result)
    print("verify:", assign_cc.verify_mapping(d, pid, knob_tuple_from_row(target)))
    time.sleep(0.5)

    proc = subprocess.Popen(
        ["node", "cc_stream.js"],
        stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True,
        encoding="utf-8", errors="replace",
    )
    time.sleep(1.0)

    def send(cc, value):
        proc.stdin.write("%d %d\n" % (cc, value))
        proc.stdin.flush()
        line = proc.stdout.readline()
        if line.strip() != "ok":
            print("  pipe err: %r" % line)

    print("\n-- sweep CC 50 --")
    prev = None
    last_title = None
    for v in range(0, 128):
        send(50, v)
        time.sleep(0.10)
        row = uia_driver.find_row(win, "Wet Mix")
        t = readout(row) if row else "?"
        if t != prev:
            print("  cc=%3d -> %r" % (v, t))
            prev = t

    proc.stdin.close()
    proc.wait(timeout=5)


if __name__ == "__main__":
    main()