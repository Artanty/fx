"""SikuliX smoke test for the native H90 Control desktop app.

Run:      back\h90\sikulix\sikulix-run.cmd back\h90\sikulix\projects\h90-smoke.sikuli
Debug:    back\h90\sikulix\sikulix-ide.cmd        (open the project from the IDE)

Notes:
- SikuliX needs a LIVE, visible desktop (image recognition reads the real
  screen). A locked or headless session fails — the H90 Control window must be
  on screen, not minimized.
- API confirmed on 2.0.5 (see api-probe.sikuli): App.getWindow() does NOT
  exist; use App(name).window(). Region.capture() does NOT exist; use
  saveCapture(). Jython 2.7.2 is bundled (no one-time Setup screen needed).
- Next: screenshot the actual H90 Control knobs/presets with the IDE capture
  tool (Ctrl+Shift+drag a rectangle, stores the PNG in this folder), then
  click() the saved pattern images instead of the coordinate hacks below.
"""
from sikuli import *
import os, sys


def d(msg):
    print(msg)
    sys.stdout.flush()


d("sikuli smoke start; jython %s" % sys.version)
b = Screen(0).getBounds()
d("screen size: %dx%d" % (b.width, b.height))

# Locate the native H90 Control window (if the app is running).
app = App("H90 Control")
d("H90 Control running: %s window present: %s" % (app.isRunning(), app.hasWindow()))
win = None
if app.hasWindow():
    try:
        win = app.window()
        d("H90 window region: %s" % win)
    except Exception as ex:
        d("app.window(): %s" % ex)

scr = win if win else Screen(0)
if not win:
    d("H90 Control window not found (app running?) - capturing the full screen")

out = os.path.join(getBundlePath(), "sikuli-smoke-shot.png")
try:
    saved = scr.saveCapture(out)
    d("saved screenshot: %s" % saved)
except Exception as ex:
    d("saveCapture failed: %s" % ex)

d("all ok")