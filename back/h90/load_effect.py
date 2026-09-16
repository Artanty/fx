#!/usr/bin/env python3
"""Load a specific algorithm into Slot A via the H90 Control app's own
algorithm browser (authoritative source, same as map_delay_effects.py).

Flow: click the Slot-A algorithm-name header -> a narrow popup opens listing
the category menu ("Delay", "Distortion", ...); click the category -> the
popup widens and lists the algorithms; click the target algorithm item.

Usage:
  python load_effect.py --effect "UltraTap"
  python load_effect.py --effect "Heavy" --category Distortion
  python load_effect.py --list-categories
  python load_effect.py --list-algorithms --category Distortion
"""

import argparse
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

import psutil
from pywinauto import Desktop
from pywinauto.mouse import click

from assign_cc import find_pid, close_popup
from save_to_library import main_window  # reuse window finder

HEADER_ANCHOR = (420, 206)   # Slot-A algorithm-name header (opens the browser)
CATEGORY = 'Delay'


def algorithm_header(d, pid):
    """Click the Slot-A algorithm-name header text (leftmost header band label,
    which sits left of the preset name). Returns True when found."""
    for w in d.windows(process=pid):
        if w.rectangle().width() < 800:
            continue
        candidates = []
        for el in w.descendants():
            try:
                t = el.window_text()
                rr = el.rectangle()
            except Exception:
                continue
            if not t.strip():
                continue
            if el.element_info.control_type != 'Text':
                continue
            # header band: between the title row and the knob area
            if not (170 <= rr.top <= 228):
                continue
            # algorithm name sits right of the 'A' slot label and left of the
            # preset name; first knob labels start at x=319
            if not (360 <= rr.left <= 690):
                continue
            if t.strip() in ('A', 'B'):
                continue
            candidates.append((rr.left, el))
        if not candidates:
            continue
        candidates.sort()
        left, el = candidates[0]
        r = el.rectangle()
        from pywinauto.mouse import click as _clk
        _clk(coords=(r.left + 15, (r.top + r.bottom) // 2))
        return True
    return False


def menu_items(d, pid):
    """Collect MenuItem elements across all H90 windows: list of
    (window, text, center_x, center_y, control_type)."""
    out = []
    for w in d.windows(process=pid):
        try:
            for el in w.descendants():
                try:
                    t = el.window_text()
                except Exception:
                    t = ''
                try:
                    ct = el.element_info.control_type
                except Exception:
                    ct = ''
                if not t.strip():
                    continue
                try:
                    r = el.rectangle()
                except Exception:
                    continue
                if r.width() <= 0 or r.height() <= 0:
                    continue
                out.append((w, t.strip(), (r.left + r.right) // 2,
                            (r.top + r.bottom) // 2, ct))
        except Exception:
            continue
    return out


def _exact(items, name):
    for w, t, cx, cy, ct in items:
        if t.lower() == name.lower():
            return w, t, cx, cy, ct
    return None


def load(effect, category=CATEGORY):
    pid = find_pid()
    d = Desktop(backend='uia')
    from pywinauto.keyboard import send_keys
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)

    if not algorithm_header(d, pid):
        click(coords=HEADER_ANCHOR)
    time.sleep(1.5)

    cat = _exact(menu_items(d, pid), category)
    if cat is None:
        print('FAIL: category %r not found in browser' % category)
        return 1
    print('category %r (%s) at (%d,%d)' % (cat[1], cat[4], cat[2], cat[3]))
    click(coords=(cat[2], cat[3]))
    time.sleep(1.2)

    item = _exact(menu_items(d, pid), effect)
    if item is None:
        # submenu may take longer; retry a few times
        for _ in range(5):
            time.sleep(0.6)
            item = _exact(menu_items(d, pid), effect)
            if item is not None:
                break
    if item is None:
        print('FAIL: effect %r not found in %s submenu' % (effect, category))
        return 1
    print('effect %r (%s) at (%d,%d)' % (item[1], item[4], item[2], item[3]))
    click(coords=(item[2], item[3]))
    time.sleep(2.0)

    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)
    return 0


def list_categories():
    from pywinauto.keyboard import send_keys
    pid = find_pid()
    d = Desktop(backend='uia')
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)
    if not algorithm_header(d, pid):
        click(coords=HEADER_ANCHOR)
    time.sleep(1.5)
    seen = set()
    for w, t, cx, cy, ct in menu_items(d, pid):
        if t not in seen:
            seen.add(t)
            print('%-14s @(%d,%d)' % (t, cx, cy))
    return 0


def list_algorithms(category=CATEGORY):
    from pywinauto.keyboard import send_keys
    pid = find_pid()
    d = Desktop(backend='uia')
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)
    if not algorithm_header(d, pid):
        click(coords=HEADER_ANCHOR)
    time.sleep(1.5)

    cat = _exact(menu_items(d, pid), category)
    if cat is None:
        print('FAIL: category %r not found in browser' % category)
        return 1
    click(coords=(cat[2], cat[3]))
    time.sleep(1.2)

    seen = set()
    for w, t, cx, cy, ct in menu_items(d, pid):
        if t not in seen:
            seen.add(t)
            print('%-18s @(%d,%d)' % (t, cx, cy))
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)
    return 0


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--effect')
    ap.add_argument('--category', default=CATEGORY)
    ap.add_argument('--list-categories', action='store_true')
    ap.add_argument('--list-algorithms', action='store_true')
    args = ap.parse_args()
    if args.list_categories:
        return list_categories()
    if args.list_algorithms:
        return list_algorithms(args.category)
    if not args.effect:
        ap.error('--effect is required (or --list-categories)')
    return load(args.effect, args.category)


if __name__ == '__main__':
    sys.exit(main())