"""Find the Programs/preset list entries in the H90 Control window by text
search and report their coordinates (dry run - does NOT click anything).

This is the sober alternative to viewing the PNG: Tesseract gives us the same
landmarks; find*Text matches carry x/y which map 1:1 to where a click lands.
"""

from sikuli import *
import os, sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


app = App("H90 Control")
try:
    app.focus()
except Exception as ex:
    d("focus err: %s" % ex)
time.sleep(1)

win = app.window()
d("window: %s" % win)

frags = ["octav", "vox", "reso", "lydi", "harm", "string", "baroque", "polyFlex", "bass", "pitchFlex"]

for frag in frags:
    try:
        ms = win.findAllList(frag)
        if ms:
            for m in ms:
                d("  '%s' at (%d,%d) %dx%d" % (frag, m.x, m.y, m.w, m.h))
        else:
            d("  '%s': no match" % frag)
    except Exception as ex:
        d("  '%s': err %s" % (frag, str(ex)[:160]))

d("done")