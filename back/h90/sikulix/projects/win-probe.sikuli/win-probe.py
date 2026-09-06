from sikuli import *
import sys


def d(msg):
    print(msg)
    sys.stdout.flush()


app = App("H90 Control")
d("isRunning=%s hasWindow=%s isValid=%s title=%s windowTitle=%s" % (
    app.isRunning(), app.hasWindow(), app.isValid(), app.getTitle(), app.getWindowTitle()))
try:
    d("getWindows: %s" % app.getWindows())
except Exception as ex:
    d("getWindows err: %s" % ex)
try:
    d("windows: %s" % app.windows())
except Exception as ex:
    d("windows err: %s" % ex)
try:
    d("waitForWindow(3): %s" % app.waitForWindow(3))
except Exception as ex:
    d("waitForWindow err: %s" % ex)
for name in ("H90 Control", "H90", "Control"):
    try:
        a2 = App(name)
        r = a2.window()
        d("App(%r).window() -> %s" % (name, r))
    except Exception as ex:
        d("App(%r).window() err: %s" % (name, ex))
try:
    d("App.focusedWindow(): %s" % App.focusedWindow())
except Exception as ex:
    d("focusedWindow err: %s" % ex)
d("done")