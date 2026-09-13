import sys
import time
import re

sys.stdout.reconfigure(encoding='utf-8')

from pywinauto import Desktop
from pywinauto.keyboard import send_keys

PID = 4972
ROW_BAND = (790, 870)
SRC_TEXTS = {'Off', 'Preset HotKnob', 'Program HotKnob', 'MIDI CC', 'Exp Pedal', 'Aux Switch'}


def popup_window(d):
    for x in d.windows(process=PID):
        if x.rectangle().width() < 1200:
            return x
    return None


def band_buttons(window):
    out = []
    for el in window.descendants():
        try:
            cn = el.friendly_class_name()
            r = el.rectangle()
            if cn == 'Button' and ROW_BAND[0] <= r.top <= ROW_BAND[1] and r.height() > 20:
                out.append((el, r))
        except Exception:
            pass
    return sorted(out, key=lambda t: t[1].left)


def find_kind(buttons):
    src_t = src_l = src_r = inst_t = inst_l = inst_r = None
    for el, r in buttons:
        t = el.window_text() or ''
        if t in SRC_TEXTS:
            src_t = (el, r)
    if src_t is not None:
        _, sr = src_t
        for el, r in buttons:
            if (r.right <= sr.left and sr.left - r.right <= 10):
                src_l = (el, r)
            if (sr.right <= r.left and r.left - sr.right <= 10):
                src_r = (el, r)
    for el, r in buttons:
        t = el.window_text() or ''
        if t and t not in SRC_TEXTS and t != 'closeButton':
            inst_t = (el, r)
    if inst_t is not None:
        _, ir = inst_t
        for el, r in buttons:
            if r.right <= ir.left and ir.left - r.right <= 10:
                inst_l = (el, r)
            if ir.right <= r.left and r.left - ir.right <= 10:
                inst_r = (el, r)
    return src_t, src_l, src_r, inst_t, inst_l, inst_r


def click_el(el):
    el.click_input()
    time.sleep(0.45)


def set_source_midi_cc(window):
    for _ in range(8):
        src_t, _, _, _, _, _ = find_kind(band_buttons(window))
        if src_t is not None and (src_t[0].window_text() or '') == 'MIDI CC':
            return True
        _, src_l, _, _, _, _ = find_kind(band_buttons(window))
        if src_l is None:
            return False
        click_el(src_l[0])
    return False


def set_cc_number(window, target):
    _, _, _, inst_t, inst_l, inst_r = find_kind(band_buttons(window))
    if inst_t is None:
        return None
    m = re.search(r'(\d+)', inst_t[0].window_text() or '')
    cur = int(m.group(1)) if m else 0
    guards = 0
    while cur < target and guards < 130 and inst_r is not None:
        click_el(inst_r[0])
        cur += 1
        guards += 1
        _, _, _, inst_t, inst_l, inst_r = find_kind(band_buttons(window))
    while cur > target and guards < 130 and inst_l is not None:
        click_el(inst_l[0])
        cur -= 1
        guards += 1
        _, _, _, inst_t, inst_l, inst_r = find_kind(band_buttons(window))
    _, _, _, inst_t, _, _ = find_kind(band_buttons(window))
    return inst_t[0].window_text() if inst_t else None


def close_btn(window):
    for el in window.descendants():
        try:
            if (el.window_text() or '') == 'closeButton':
                return el
        except Exception:
            pass
    return None


def close_popup(d):
    for _ in range(10):
        p = popup_window(d)
        if p is None:
            return
        cb = close_btn(p)
        if cb is None:
            send_keys('{ESC}')
            time.sleep(0.5)
            continue
        cb.click_input()
        time.sleep(0.5)


def find_range_button_anywhere(d, col, row_top):
    best = None
    best_d = 1e9
    for x in d.windows(process=PID):
        try:
            for el in x.descendants():
                if (el.window_text() or '') == 'rangeButton':
                    r = el.rectangle()
                    cx = (r.left + r.right) / 2
                    cy = (r.top + r.bottom) / 2
                    dist = abs(cx - col) + abs(cy - row_top)
                    if dist < best_d:
                        best_d = dist
                        best = el
        except Exception:
            pass
    return best


KNOBS = [
    ('Wet Mix',     587, 636, 0),
    ('Delay Mix',   773, 636, 1),
    ('Delay A',     959, 636, 2),
    ('Delay B',     587, 860, 3),
    ('Feedback A',  773, 860, 4),
    ('Feedback B',  959, 860, 5),
    ('Mod Depth',   587, 1083, 6),
    ('Mod Speed',   773, 1083, 7),
    ('Resonance',   959, 1083, 8),
    ('Filter Type', 587, 1307, 9),
]


def main():
    d = Desktop(backend='uia')
    results = []
    for label, lx, ly, target in KNOBS:
        try:
            close_popup(d)
            send_keys('{ESC}')
            time.sleep(0.6)
            click_el_type = None
            lbl_px = (lx + 78, ly + 20)
            from pywinauto.mouse import move
            move(coords=lbl_px)
            time.sleep(0.5)
            rb = find_range_button_anywhere(d, lx + 78, ly - 129)
            if rb is None:
                move(coords=lbl_px)
                time.sleep(0.5)
                rb = find_range_button_anywhere(d, lx + 78, ly - 129)
            if rb is None:
                results.append((label, 'FAIL rangeButton not found'))
                continue
            rb.click_input()
            p = None
            for _ in range(10):
                p = popup_window(d)
                if p is not None:
                    break
                time.sleep(0.35)
            if p is None:
                results.append((label, 'FAIL popup did not open'))
                continue
            if not set_source_midi_cc(p):
                results.append((label, 'FAIL source not MIDI CC'))
                close_popup(d)
                continue
            final_cc = set_cc_number(p, target)
            results.append((label, final_cc))
            close_popup(d)
        except Exception as e:
            try:
                close_popup(d)
            except Exception:
                pass
            results.append((label, 'FAIL %r' % (e,)))
    for label, state in results:
        print('%-12s %r' % (label, state))


if __name__ == '__main__':
    main()