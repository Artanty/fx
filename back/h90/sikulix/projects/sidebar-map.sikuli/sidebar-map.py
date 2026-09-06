"""Map the H90 Control program/sidebar list: OCR only the left column and print
every text match with its coordinates, so we can click any preset row."""

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

# Left sidebar: x 0..300 of the window, full height.
sidebar = Region(win.x, win.y, 320, win.h)
d("sidebar region: %s" % sidebar)

try:
    texts = sidebar.findAllList()
    d("word count: %d" % (len(texts) if texts else 0))
    if texts:
        for t in sorted(texts, key=lambda m: (m.y, m.x)):
            # ignore tiny noise boxes
            if t.w < 8 or t.h < 6:
                continue
            label = str(t).split("@")[0].strip()
            d("  y=%-4d x=%-4d w=%-3d  %s" % (t.y, t.x, t.w, label))
except Exception as ex:
    d("findAllList err: %s" % str(ex)[:300])

d("done")