"""Map the H90 Control program/sidebar list by OCR-searching a set of known
fragments in the left column; print each hit's center so we can click a row."""

from sikuli import *
import sys, time


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
sidebar = Region(win.x, win.y, 330, win.h)
d("sidebar region: %s" % sidebar)

frags = ["Home", "octav", "oct ", "vox", "poly", "Flex", "reso", "lyd", "harm",
         "string", "bass", "chorus", "pitch", "baroque", "crisp", "cat", "sine",
         "synth", "dirt", "Lead", "Lead", "Wah", "wah", "freq", "Lim", "lim", "99", "100"]

seen = set()
for frag in frags:
    try:
        ms = sidebar.findAllList(frag)
        if ms:
            for m in ms:
                key = (m.x, m.y)
                if key in seen:
                    continue
                seen.add(key)
                d("  (%4d,%-4d) %3dx%-3d  fragment=%r" % (m.x, m.y, m.w, m.h, frag))
    except Exception as ex:
        d("  frag %r err %s" % (frag, str(ex)[:120]))

d("done")