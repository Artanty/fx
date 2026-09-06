"""Bring H90 Control to the foreground, then OCR its window region + capture
a clean window shot. Lists what's on screen as text so we can pick click
targets without viewing images."""

from sikuli import *
import os, sys, time


def d(msg):
    print(msg)
    sys.stdout.flush()


app = App("H90 Control")
try:
    app.focus()
    d("focused")
except Exception as ex:
    d("focus err: %s" % ex)
time.sleep(2)

win = None
for i in range(4):
    try:
        win = app.window()
        if win:
            break
    except Exception as ex:
        d("window attempt %d err: %s" % (i + 1, ex))
        time.sleep(1)
d("window: %s" % win)

frames = getBundlePath()
if not frames.endswith((".sikuli", "/", "\\")):
    frames = os.path.dirname(frames)

if win:
    try:
        returned = win.saveCapture("x.png")
        import shutil
        shutil.copy(returned, os.path.join(frames, "h90-window.png"))
        d("window shot -> h90-window.png")
    except Exception as ex:
        d("saveCapture err: %s" % ex)

    tries = 0
    while tries < 2:
        try:
            t = win.text()
            t = t.encode("ascii", "replace").decode("ascii")
            d("--- OCR text start (%d chars) ---" % len(t))
            d(t.replace("\n", " / "))
            d("--- OCR text end ---")
            break
        except Exception as ex:
            tries += 1
            d("text() err %d: %s" % (tries, str(ex)[:300]))
            time.sleep(1)

d("done")