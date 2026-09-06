"""Driver: click a preset row in the H90 Control Programs sidebar to fire real
pedal traffic. Target is chosen by OCR from currently-visible anchors, falling
back through several preset names so the click still lands if the list scrolled."""

from sikuli import *
import sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


app = App("H90 Control")
try:
    app.focus()
    d("focused")
except Exception as ex:
    d("focus err: %s" % ex)
time.sleep(1)

win = app.window()
d("window: %s" % win)

sidebar = Region(win.x, win.y, 330, win.h)

# Optional target fragment from the command line (java -jar ... -r proj -- frag).
want = sys.argv[sys.argv.index("--") + 1] if "--" in sys.argv else None
ANCHORS = [want] if want else ["lyd", "harm", "baroque", "poly", "reso", "dirty", "oct ", "vox"]
d("target fragment: %s" % (ANCHORS[0] if want else "(first visible)"))

target = None
for frag in ANCHORS:
    try:
        ms = sidebar.findAllList(frag)
    except Exception as ex:
        d("  frag %r err %s" % (frag, str(ex)[:120]))
        continue
    if ms:
        # pick the leftmost (name start) match as the row anchor
        m = sorted(ms, key=lambda mm: mm.x)[0]
        # ignore matches that are not in the sidebar (x must be < 260, row height sensible)
        if m.x < 12 or m.x > 260 or m.h < 6 or m.h > 40:
            d("  frag %r: ignored (%dx%d)" % (frag, m.x, m.y))
            continue
        target = m
        d("  frag %r -> row at (%d,%d)" % (frag, m.x, m.y))
        break

if not target:
    d("ERROR: no preset anchor found in sidebar")
    sys.exit(1)

# Click the middle of the row: same y, x a bit right of the name so it isn't
# on the text edge (the row is ~260-330 wide here).
row_y = target.y + target.h / 2
click_x = 150
click(Location(click_x, row_y))
d("clicked (%d,%d) for fragment '%s'" % (click_x, row_y, frag))
time.sleep(1)

d("done")