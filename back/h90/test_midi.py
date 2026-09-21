"""Decisive MIDI test: does a CC send move the Wet Mix readout?

Sends CC50=127 a few times (retrying the WinMM open), reads the app readout
before/after via uia_driver. Also double-checks the readout freshness by
dragging Wet Mix via UIA in between (to prove the readout CAN move).
"""

import subprocess
import sys
import time

sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import h90_app
import uia_driver

NODE_ONE = r"""const midi=require('midi');const o=new midi.Output();
const chan=11;const status=0xb0+(chan-1);
let last=null;
for(let attempt=0;attempt<8;attempt++){
  const out=new midi.Output();
  try{out.openPort(1);}catch(e){console.error('reopen err');}
  let ok=false;
  for(let j=0;j<3;j++){
    try{out.sendMessage([status,50,127]);ok=true;}catch(e){}
    }
  console.log('attempt',attempt,'ok',ok);
  last=out;
  await new Promise(r=>setTimeout(r,400));
}
"""
PROBE = "%%CC%% %%VAL%%"

def raw_send(cc, value):
    code = (
        "const midi=require('midi');const o=new midi.Output();"
        "try{o.openPort(1);}catch(e){}"
        "try{o.sendMessage([0xb0+10," + str(cc) + "," + str(value) + "]);}catch(e){}"
        "setTimeout(()=>{try{o.closePort();}catch(e){}process.exit(0);},80);"
    )
    subprocess.run(["node", "-e", code], timeout=20)


def read(label):
    win = uia_driver.get_window(h90_app.connect())
    r = uia_driver.find_row(win, label)
    t = uia_driver.readout_text(r) if r else "?"
    return t


def main():
    h90_app.pin_window()
    print("Wet Mix before:", repr(read("Wet Mix")))
    for i in range(5):
        raw_send(50, 127)
        time.sleep(0.5)
    print("Wet Mix after CC50=127 x5:", repr(read("Wet Mix")))

    # readout freshness control: move Wet Mix via the app's own slider path
    from pywinauto import Desktop
    import assign_cc
    d = Desktop(backend="uia")
    pid = h90_app.find_pid()
    win = uia_driver.get_window(h90_app.connect())
    row = uia_driver.find_row(win, "Wet Mix")
    r = row["edit"].element_info.rectangle
    assign_cc.assign_knob(d, pid, (row["label"], r.left, r.top, r.width(), r.height()), 50)
    print("Wet Mix after CC50 re-assign:", repr(read("Wet Mix")))


if __name__ == "__main__":
    main()