"""Try to pull visible text (labels, preset names, knob names) off the H90
Control window using SikuliX OCR APIs, without needing to see the image."""

from sikuli import *
import sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


win = App("H90 Control").window()
d("window: %s" % win)

for label, fn in [
    ("collectLinesText", lambda: win.collectLinesText()),
    ("collectWordsText", lambda: win.collectWordsText()),
    ("text", lambda: win.text()),
]:
    try:
        res = fn()
        d("%s -> type=%s len=%s" % (label, type(res).__name__, len(res) if res else 0))
        try:
            d("  sample: %s" % (res[:200] if isinstance(res, list) else str(res)[:200]))
        except Exception as ex:
            d("  sample err: %s" % ex)
    except Exception as ex:
        d("%s failed: %s" % (label, ex))

d("done")