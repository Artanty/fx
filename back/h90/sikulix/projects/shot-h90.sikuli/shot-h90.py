"""Capture the H90 Control window (and full screen) into the project folder
so we can pick the first click() targets from real UI."""

from sikuli import *
import os, sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


frames = getBundlePath()
if not frames.endswith((".sikuli", "/", "\\")):
    frames = os.path.dirname(frames)
d("frames=%s" % frames)

win = None
for i in range(4):
    try:
        win = App("H90 Control").window()
        if win:
            d("window (attempt %d): %s" % (i + 1, win))
            break
    except Exception as ex:
        d("attempt %d: %s" % (i + 1, ex))
        time.sleep(1)

if not win:
    d("no H90 window via App.window() - falling back to full screen")
    win = Screen(0)

out = frames.replace("\\", "/") + "/h90-window.png"
try:
    returned = win.saveCapture(out)
    d("saveCapture(%s) returned %r" % (out, returned))
    import shutil
    if returned and os.path.exists(returned):
        shutil.copy(returned, os.path.join(frames, "h90-window.png"))
        d("copied to %s" % os.path.join(frames, "h90-window.png"))
    d("file at requested path: %s" % os.path.exists(out))
except Exception as ex:
    d("saveCapture failed: %s" % ex)

d("done")