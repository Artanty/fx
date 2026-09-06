"""Introspect the SikuliX 2.0.5 Python facade so the smoke/driver scripts use
real method names (App/Region/Screen capture + window lookup vary by version)."""
from sikuli import *
import sys


def d(msg):
    print(msg)
    sys.stdout.flush()


d("api probe start")
d("App methods: %s" % sorted([m for m in dir(App) if not m.startswith("_")]))
if App:
    try:
        a = App("H90 Control")
        d("App('H90 Control') -> %s" % a)
        d("instance methods: %s" % sorted([m for m in dir(a) if not m.startswith("_")]))
        d("isRunning: %s" % a.isRunning())
        d("hasWindow: %s" % a.hasWindow())
    except Exception as ex:
        d("App instance probe failed: %s" % ex)

try:
    s = Screen(0)
    d("Screen(0): %s" % s)
    d("Screen methods: %s" % sorted([m for m in dir(s) if not m.startswith("_")]))
    d("Screen bounds: %s" % s.getBounds())
except Exception as ex:
    d("Screen probe failed: %s" % ex)

d("Screen class methods: %s" % sorted([m for m in dir(Screen) if not m.startswith("_")]))
d("Region class methods: %s" % sorted([m for m in dir(Region) if not m.startswith("_")]))
d("App getWindow present: %s" % hasattr(App, "getWindow"))
d("App focusedWindow present: %s" % hasattr(App, "focusedWindow"))
d("all ok")