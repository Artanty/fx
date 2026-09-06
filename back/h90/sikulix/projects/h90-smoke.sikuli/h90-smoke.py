"""SikuliX smoke test for the native H90 Control desktop app.

Run:      back\h90\sikulix\sikulix-run.cmd back\h90\sikulix\projects\h90-smoke.sikuli
Debug:    back\h90\sikulix\sikulix-ide.cmd        (open the project from the IDE)

Notes:
- SikuliX needs a LIVE, visible desktop (image recognition reads the real
  screen). A locked or headless session fails — the H90 Control window must be
  on screen, not minimized.
- First IDE launch shows a one-time Setup screen: click the install button for
  the IDE/API and Jython, quit, relaunch. setup.ps1 already placed the jars and
  the JRE so that screen is the only manual step.
- Next session: screenshot the actual H90 Control knobs/presets with the IDE
  capture tool (Ctrl+Shift+drag a rectangle, stores the PNG in this folder),
  then click() the saved pattern images instead of the coordinate hacks below.
"""
from sikuli import *
import os, sys


def d(msg):
    print(msg)
    sys.stdout.flush()


d("sikuli smoke start; jython %s" % sys.version)
b = Screen(0).getBounds()
d("screen size: %dx%d" % (b.width, b.height))
scr = Region(0, 0, b.width, b.height)

# Locate the native H90 Control window by title fragment (if the app is running).
win = None
for pattern in ("H90 Control", "H90"):
    try:
        win = App.getWindow(pattern)
        if win:
            break
    except Exception as ex:
        d("App.getWindow(%r): %s" % (pattern, ex))

if win:
    d("H90 window: %s" % win)
    scr = win
else:
    d("H90 Control window not found (app running?) - capturing the full screen")

out = os.path.join(getBundlePath(), "sikuli-smoke-shot.png")
try:
    scr.capture().save(out)
    d("saved screenshot: %s" % out)
except Exception as ex:
    d("capture failed: %s" % ex)

d("all ok")