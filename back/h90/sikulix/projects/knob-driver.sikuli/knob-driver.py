"""Driver: OCR-scan the H90 Control parameters area and turn algorithm knobs.

The H90 must be on the visible desktop with the pedal connected. Pass args after
"--" (java -jar ... -r knob-driver.sikuli -- ...):

  --scan                  print the visible knob labels in the parameters region
  --text                  dump all OCR text on the window (one line per region)
  --preset <frag>         optional: click that preset row first (sidebar, OCR)
  --find <label>          print matches (coords) for a label WITHOUT clicking
  --click <label>         optional: OCR-click the given label anywhere in the window
  --band <px>             restrict find/click OCR to the top <px> of the window
  --knob <label> [--turns N]
                          turn knob <label> by N steps (repeatable; N may be negative)
  --dy <px>               vertical drag pixels per step (sign = direction, default 10)
  --above <px>            how far above the label match the dial sits (default 60)

Examples:
  sikulix-run.cmd projects\knob-driver.sikuli -- --scan
  sikulix-run.cmd projects\knob-driver.sikuli -- --preset reso --knob Mix --turns 3
  sikulix-run.cmd projects\knob-driver.sikuli -- --preset oct --knob "In Gain" --turns -2 --knob "Filter A" --turns 4
"""

from sikuli import *
import sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


SCAN_FRAGS = [
    "Mix", "In Gain", "Out Gain", "Sensitivity", "Filter A", "Filter B",
    "Resonance A", "Resonance B", "Tails", "Pre-Delay", "Level", "Dry", "Wet",
    "Depth", "Rate", "Feedback", "Time", "Freq", "Tempo", "HotKnob", "Tone",
    "Bass", "Treble", "Gain", "Octave", "Oct MIX", "Clr MIX", "Threshold",
    "Attack", "Release", "Sustain",
]

SIDEBAR_W = 330


def parse_args(argv):
    scan = False
    dump_text = False
    preset = None
    find_labels = []
    click_label = None
    band = 0
    dy = 10
    above = 60
    knobs = []
    i = 0
    while i < len(argv):
        a = argv[i]
        if a == "--scan":
            scan = True
        elif a == "--text":
            dump_text = True
        elif a == "--preset":
            i += 1
            preset = argv[i]
        elif a == "--find":
            i += 1
            find_labels.append(argv[i])
        elif a == "--click":
            i += 1
            click_label = argv[i]
        elif a == "--band":
            i += 1
            band = int(argv[i])
        elif a == "--dy":
            i += 1
            dy = int(argv[i])
        elif a == "--above":
            i += 1
            above = int(argv[i])
        elif a == "--knob":
            i += 1
            label = argv[i]
            turns = 1
            if i + 1 < len(argv) and argv[i + 1] == "--turns":
                turns = int(argv[i + 2])
                i += 2
            knobs.append((label, turns))
        i += 1
    return scan, dump_text, preset, find_labels, click_label, band, dy, above, knobs


def focus_window():
    app = App("H90 Control")
    try:
        app.focus()
        d("focused")
    except Exception as ex:
        d("focus err: %s" % ex)
    time.sleep(1)
    try:
        win = app.window()
    except Exception as ex:
        d("ERROR: H90 Control window not available (%s) - is the app running?" % str(ex)[:120])
        sys.exit(1)
    if not win:
        d("ERROR: H90 Control window not available - is the app running?")
        sys.exit(1)
    d("window: %s" % win)
    return win


def click_preset(win, frag):
    sidebar = Region(win.x, win.y, SIDEBAR_W, win.h)
    ms = sidebar.findAllList(frag)
    if not ms:
        d("preset %r not found in sidebar" % frag)
        return False
    m = sorted(ms, key=lambda mm: mm.x)[0]
    if m.x < 12 or m.x > 260 or m.h < 6 or m.h > 40:
        d("preset %r ignored match (%d,%d)" % (frag, m.x, m.y))
        return False
    row_y = m.y + m.h / 2
    click(Location(150, row_y))
    d("clicked preset row for %r at (150,%d)" % (frag, row_y))
    time.sleep(1.5)
    return True


def scan_knobs(win):
    params = Region(win.x + SIDEBAR_W, win.y, win.w - SIDEBAR_W, win.h)
    seen = {}
    for frag in SCAN_FRAGS:
        try:
            ms = params.findAllList(frag)
        except Exception as ex:
            d("scan %r err: %s" % (frag, str(ex)[:100]))
            continue
        for m in ms or []:
            if m.h < 4 or m.h > 60:
                continue
            key = (m.x, m.y)
            if key in seen:
                continue
            seen[key] = True
            d("KNOB: %s @ %d,%d,%d,%d" % (frag, m.x, m.y, m.w, m.h))
    return bool(seen)


def find_knob(win, label, above):
    params = Region(win.x + SIDEBAR_W, win.y, win.w - SIDEBAR_W, win.h)
    ms = []
    try:
        ms = params.findAllList(label)
    except Exception as ex:
        d("  find knob %r err: %s" % (label, str(ex)[:100]))
    if not ms:
        return None
    m = sorted(ms, key=lambda mm: (mm.y, mm.x))[0]
    pt = Location(m.x + m.w / 2, m.y - above)
    d("  knob %r label at (%d,%d) %dx%d -> dial guess (%d,%d)"
      % (label, m.x, m.y, m.w, m.h, pt.x, pt.y))
    return pt


def turn(point, turns, dy):
    for _ in range(abs(turns)):
        src = Location(point.x, point.y)
        dst = Location(point.x, point.y + (dy if turns > 0 else -dy))
        try:
            dragDrop(src, dst)
        except Exception as ex:
            d("  drag err: %s" % str(ex)[:120])
            return
        time.sleep(0.3)


def window_region(win):
    return Region(win.x, win.y, win.w, win.h)


def search_region(win, band):
    r = window_region(win)
    if band and band > 0:
        r = Region(r.x, r.y, r.w, min(band, r.h))
    return r


def find_text(win, label, band):
    r = search_region(win, band)
    try:
        ms = r.findAllList(label)
    except Exception as ex:
        d("  find %r err: %s" % (label, str(ex)[:120]))
        return []
    out = []
    for m in ms or []:
        d("  MATCH %r at (%d,%d) %dx%d" % (label, m.x, m.y, m.w, m.h))
        out.append(m)
    return out


def dump_text(win):
    r = window_region(win)
    try:
        lines = r.collectLinesText()
        items = lines or []
        d("--- OCR lines (%d) ---" % len(items))
        buf = []
        for item in items:
            try:
                s = str(item)
            except Exception:
                s = "?"
            buf.append(s.encode("ascii", "replace").decode("ascii"))
        d("\n".join(buf))
        d("--- OCR lines end ---")
    except Exception as ex:
        d("--text (lines) err: %s" % str(ex)[:300])


def click_text(win, label, band):
    ms = find_text(win, label, band)
    if not ms:
        d("  click %r: not found (band=%d)" % (label, band))
        return False
    m = sorted(ms, key=lambda mm: (mm.w, mm.y))[-1]
    p = Location(m.x + m.w / 2, m.y + m.h / 2)
    click(p)
    d("  clicked %r at (%d,%d) -> (%d,%d)" % (label, m.x, m.y, p.x, p.y))
    time.sleep(1)
    return True


def main():
    raw = sys.argv[1:]
    if raw and raw[0] == "--":
        raw = raw[1:]
    argv = raw
    scan, dump_text, preset, find_labels, click_label, band, dy, above, knobs = parse_args(argv)
    d("args: scan=%s text=%s preset=%s find=%s click=%s band=%d dy=%d above=%d knobs=%s"
      % (scan, dump_text, preset, find_labels, click_label, band, dy, above, knobs))

    win = focus_window()

    if preset:
        click_preset(win, preset)

    if find_labels:
        for lab in find_labels:
            find_text(win, lab, band)

    if click_label:
        click_text(win, click_label, band)

    if dump_text:
        dump_text(win)

    if scan:
        d("scanning knobs in parameters region...")
        scan_knobs(win)
        d("scan done")
        return

    if not knobs and not (scan or dump_text or find_labels or click_label):
        d("ERROR: nothing to do - pass --knob ... --turns N, --scan, --text, --find, --click")
        sys.exit(1)

    for label, n in knobs:
        d("turning %r by %d" % (label, n))
        pt = find_knob(win, label, above)
        if not pt:
            d("ERROR: knob %r not found in parameters area" % label)
            continue
        hover(pt)
        time.sleep(0.2)
        turn(pt, n, dy)
        d("TURN: %s -> %d steps (%dpx dir=%s)" % (label, n, dy, "+" if n > 0 else "-"))

    d("done")


main()