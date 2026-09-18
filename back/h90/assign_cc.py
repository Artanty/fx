import sys
import time
import re
import json

sys.stdout.reconfigure(encoding='utf-8')

import psutil
from pywinauto import Desktop
from pywinauto.mouse import click

import h90_app

SRC_TEXTS = {'Off': 0, 'Preset HotKnob': 1, 'Program HotKnob': 2, 'MIDI CC': 3, 'Exp Pedal': 4, 'Aux Switch': 5}
MIDI_IDX = 3


def find_pid():
    return h90_app.find_pid()


def popup_window(d, pid):
    for x in d.windows(process=pid):
        if x.rectangle().width() < 800:
            return x
    return None


def main_window(d, pid):
    for x in d.windows(process=pid):
        if x.rectangle().width() >= 800:
            return x
    raise RuntimeError('main window not found')


def buttons(window):
    out = []
    for el in window.descendants():
        try:
            cn = el.friendly_class_name()
            r = el.rectangle()
            if cn == 'Button' and r.height() > 10:
                out.append((el, r, el.window_text() or ''))
        except Exception:
            pass
    return sorted(out, key=lambda t: (t[1].top, t[1].left))


def src_arrow(window, side):
    src = None
    for el, r, t in buttons(window):
        if t in SRC_TEXTS:
            src = (el, r, t)
    if src is None:
        return None
    _, sr, _ = src
    for el, r, t in buttons(window):
        if side == 'left' and r.right <= sr.left and sr.left - r.right <= 12 and r.top == sr.top:
            return el
        if side == 'right' and sr.right <= r.left and r.left - sr.right <= 12 and r.top == sr.top:
            return el
    return None


def src_text(window):
    for el, r, t in buttons(window):
        if t in SRC_TEXTS:
            return t
    return None


def inst_row(window):
    sr = None
    for el, r, t in buttons(window):
        if t in SRC_TEXTS:
            sr = r
    if sr is None:
        return None, None, None
    cands = []
    for el, r, t in buttons(window):
        if t and t not in SRC_TEXTS and t != 'closeButton':
            cands.append((abs(r.top - sr.top), r.left, el, r, t))
    if not cands:
        return None, None, None
    cands.sort(key=lambda c: (c[0], c[1]))
    _, _, el, ir, it = cands[0]
    left = right = None
    for e2, r, t in buttons(window):
        if r.right <= ir.left and ir.left - r.right <= 12 and abs(r.top - ir.top) <= 2:
            left = e2
        if ir.right <= r.left and r.left - ir.right <= 12 and abs(r.top - ir.top) <= 2:
            right = e2
    return it, left, right


def click_center(el):
    r = el.rectangle()
    click(coords=((r.left + r.right) // 2, (r.top + r.bottom) // 2))


def set_source_midi_cc(window):
    for _ in range(8):
        cur = src_text(window)
        if cur == 'MIDI CC':
            return True
        idx = SRC_TEXTS.get(cur)
        if idx is None:
            return False
        if idx < MIDI_IDX:
            arrow = src_arrow(window, 'right')
        else:
            arrow = src_arrow(window, 'left')
        if arrow is None:
            return False
        click_center(arrow)
        time.sleep(0.5)
    return False


def set_cc_number(window, target):
    it, left, right = inst_row(window)
    if it is None:
        return None
    m = re.search(r'(\d+)', it)
    cur = int(m.group(1)) if m else 0
    guard = 0
    while cur < target and guard < 130 and right is not None:
        click_center(right)
        time.sleep(0.3)
        cur += 1
        guard += 1
        it, left, right = inst_row(window)
    while cur > target and guard < 130 and left is not None:
        click_center(left)
        time.sleep(0.3)
        cur -= 1
        guard += 1
        it, left, right = inst_row(window)
    return it


def find_slider(d, pid):
    for w in d.windows(process=pid):
        for el in w.descendants():
            try:
                if el.friendly_class_name() == 'Slider':
                    return el
            except Exception:
                pass
    return None


def slider_set_value(slider, target):
    try:
        from comtypes import POINTER
        from comtypes.gen import UIAutomationClient as uia
        e = slider.element_info.element
        ptr = e.GetCurrentPattern(uia.UIA_RangeValuePatternId)
        rvp = ptr.QueryInterface(uia.IUIAutomationRangeValuePattern)
        rvp.SetValue(float(target))
        time.sleep(0.6)
        return rvp.CurrentValue
    except Exception:
        return None


def slider_drag_value(d, pid, target):
    slider = find_slider(d, pid)
    if slider is None:
        return None
    r = slider.rectangle()
    rx = r.left + int(r.width() * (target / 127.0))
    ry = (r.top + r.bottom) // 2
    from pywinauto.mouse import move, press, release
    move(coords=(rx, ry))
    press()
    time.sleep(0.3)
    release()
    time.sleep(0.6)
    return rx


def close_slider_popup(d, pid, slider_rect):
    for w in d.windows(process=pid):
        for el in w.descendants():
            try:
                if el.window_text() == 'closeButton':
                    r = el.rectangle()
                    if slider_rect.top - 40 <= r.top <= slider_rect.top + 20:
                        click_center(el)
                        return True
            except Exception:
                pass
    return False


def open_cc_slider(d, pid, window):
    cc_btn = None
    for el, r, t in buttons(window):
        if t.startswith('CC#'):
            cc_btn = el
            break
    if cc_btn is None:
        return None
    click_center(cc_btn)
    time.sleep(0.8)
    slider = find_slider(d, pid)
    return slider


def set_cc_number_fast(d, pid, window, target):
    slider = open_cc_slider(d, pid, window)
    if slider is None:
        return None
    val = slider_set_value(slider, target)
    if val is None:
        slider_drag_value(d, pid, target)
    sr = slider.rectangle()
    close_slider_popup(d, pid, sr)
    time.sleep(0.8)
    it, _, _ = inst_row(window)
    return it


def close_btn(window):
    for el, r, t in buttons(window):
        if t == 'closeButton':
            return el
    return None


def close_popup(d, pid):
    for _ in range(10):
        p = popup_window(d, pid)
        if p is None:
            return
        cb = close_btn(p)
        if cb is not None:
            click_center(cb)
        time.sleep(0.5)


def popup_knob_name(window):
    """Return the knob label shown at the bottom of the MIDI popup, or None."""
    name = None
    for el in window.descendants():
        try:
            if el.friendly_class_name() == 'Static' and el.window_text().strip():
                t = el.window_text().strip()
                if t not in ('Control Source', 'Start', 'End', 'Global', 'MIDI CC'):
                    name = t
        except Exception:
            pass
    return name


# KNOB: (label, value-edit-left, value-edit-top, value-edit-w, value-edit-h)
def label_center(knob):
    lx, ty, w, h = knob[1], knob[2], knob[3], knob[4]
    return (lx + w // 2, ty + h + h // 2)


def find_range_button(d, pid, near):
    best = None
    best_d = 1e9
    cx, cy = near
    for x in d.windows(process=pid):
        for el in x.descendants():
            try:
                if el.window_text() == 'rangeButton':
                    r = el.rectangle()
                    mcx = (r.left + r.right) / 2
                    mcy = (r.top + r.bottom) / 2
                    dist = abs(mcx - cx) + abs(mcy - cy)
                    if dist < best_d:
                        best_d = dist
                        best = el
            except Exception:
                pass
    return best


def verify_mapping(d, pid, knob):
    near = label_center(knob)
    click(coords=near)
    time.sleep(0.7)
    rb = find_range_button(d, pid, near)
    if rb is None:
        vx, vy = knob[1] + knob[3] // 2, knob[2] + knob[4] // 2
        click(coords=(vx, vy))
        time.sleep(0.7)
        rb = find_range_button(d, pid, near)
    if rb is None:
        return 'FAIL: no rangeButton'
    click_center(rb)
    time.sleep(1.2)
    p = popup_window(d, pid)
    if p is None:
        return 'FAIL: popup did not open'
    got = popup_knob_name(p)
    if got != knob[0]:
        cb = close_btn(p)
        if cb is not None:
            click_center(cb)
        time.sleep(0.4)
        return 'FAIL: wrong knob (got popup for %r, expected %r)' % (got, knob[0])
    src = src_text(p)
    it, _, _ = inst_row(p)
    state = 'src=%r instance=%r' % (src, it)
    cb = close_btn(p)
    if cb is not None:
        click_center(cb)
    time.sleep(0.5)
    return state


def assign_knob(d, pid, knob, target):
    label = knob[0]
    near = label_center(knob)
    click(coords=near)
    time.sleep(0.8)
    rb = find_range_button(d, pid, near)
    if rb is None:
        vx, vy = knob[1] + knob[3] // 2, knob[2] + knob[4] // 2
        click(coords=(vx, vy))
        time.sleep(0.8)
        rb = find_range_button(d, pid, near)
    if rb is None:
        click(coords=near)
        time.sleep(0.8)
        rb = find_range_button(d, pid, near)
    if rb is None:
        return 'FAIL: no rangeButton'
    click_center(rb)
    p = None
    for _ in range(10):
        p = popup_window(d, pid)
        if p is not None:
            break
        time.sleep(0.35)
    if p is None:
        return 'FAIL: popup did not open'
    got = popup_knob_name(p)
    if got != label:
        # clicking a stale / auto-scrolled rect opened the wrong knob's popup
        cb = close_btn(p)
        if cb is not None:
            click_center(cb)
        time.sleep(0.4)
        return 'FAIL: wrong knob (got popup for %r, expected %r)' % (got, label)
    if not set_source_midi_cc(p):
        close_popup(d, pid)
        return 'FAIL: source not MIDI CC'
    final = set_cc_number_fast(d, pid, p, target)
    if final is None:
        final = set_cc_number(p, target)
    close_popup(d, pid)
    return 'src=MIDI CC %r' % (final,)


STATE_FILE = 'midi_cc_state.json'


def load_done():
    try:
        with open(STATE_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return {'assignments': []}


def save_state(state):
    with open(STATE_FILE, 'w', encoding='utf-8') as f:
        json.dump(state, f, ensure_ascii=False, indent=2)


def main():
    pid = find_pid()
    print('PID', pid)
    d = Desktop(backend='uia')
    from pywinauto.keyboard import send_keys
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)
    # value edit rects in the CURRENT layout (Preset A, Band Delay):
    # name, lx, ty, w, h, cc, type, effect, values
    KNOBS = [
        ('Wet Mix',    326, 333, 87, 22, 0, 'numeric', 'Band Delay', '0..100'),
        ('Delay Mix',  429, 333, 87, 22, 1, 'enum',    'Band Delay', 'A10+B10 (enum)'),
        ('Delay A',    532, 333, 87, 22, 2, 'enum',    'Band Delay', '1/4 (enum)'),
        ('Delay B',    326, 457, 87, 22, 3, 'enum',    'Band Delay', '1/4 (enum)'),
        ('Feedback A', 429, 457, 87, 22, 4, 'numeric', 'Band Delay', '0..110'),
        ('Feedback B', 532, 457, 87, 22, 5, 'numeric', 'Band Delay', '0..110'),
        ('Mod Depth',  326, 581, 87, 22, 6, 'numeric', 'Band Delay', '0..10'),
        ('Mod Speed',  429, 581, 87, 22, 7, 'numeric', 'Band Delay', '0..5.01 Hz'),
        ('Resonance',  532, 581, 87, 22, 8, 'numeric', 'Band Delay', '0..10'),
        ('Filter Type', 326, 705, 87, 22, 9, 'enum',    'Band Delay', 'Band Pass (Low/Band/Hi)'),
        ('In Gain',     319, 501, 89, 22, 10, 'numeric', 'General', '-60..+12 dB'),
        ('Out Gain',    424, 501, 89, 22, 11, 'numeric', 'General', '-60..+12 dB'),
        ('Bypass',      544, 503, 58, 20, 12, 'enum',    'General', 'toggle (on/off)'),
        ('Tails',       334, 627, 58, 20, 13, 'enum',    'General', 'toggle (on/off)'),
        ('Tempo Mode',  439, 627, 58, 20, 14, 'enum',    'General', 'Free/Sync'),
        ('HotKnob',     529, 625, 89, 22, 15, 'numeric', 'General', '0..100'),
        ('Kill Dry',    319, 749, 89, 22, 16, 'enum',    'General', 'toggle (on/off)'),
    ]
    state = load_done()
    done = {a['control'] for a in state['assignments'] if a.get('verified')}
    for knob in KNOBS:
        name = knob[0]
        if name in done:
            print('%-12s skip (already CC=%d)' % (name, knob[5]))
            continue
        result = assign_knob(d, pid, knob, knob[5])
        time.sleep(0.5)
        v = verify_mapping(d, pid, knob)
        print('%-12s assign=%s verify=%s' % (name, result, v))
        ok = 'MIDI CC' in v and ('CC# %d' % knob[5]) in v
        if ok:
            state['assignments'].append({
                'type': knob[6], 'effect': knob[7], 'control': name,
                'cc': knob[5], 'values': knob[8], 'verified': True,
            })
            save_state(state)
    print('saved: %s' % STATE_FILE)


if __name__ == '__main__':
    main()