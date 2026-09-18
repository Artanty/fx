import argparse
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
from pywinauto import Desktop
from pywinauto.keyboard import send_keys
from pywinauto.mouse import click

import h90_app

APP_TITLE = h90_app.running_title() or 'Eventide Control'

MAX_LEN = 24
CAP = 23

SLUGS = ('delay', 'dist', 'harm', 'harmp', 'looper', 'mod', 'multi', 'reverb', 'synth', 'utility', 'eq')

MENU_BUTTON = (309, 206)       # Slot-A header "three dots" next to the effect


def library_name(slot, slug, effect, cap=CAP):
    if slot not in ('m1', 'm2'):
        raise ValueError('slot must be m1 or m2, got %r' % slot)
    if slug not in SLUGS:
        raise ValueError('slug must be one of %s, got %r' % (SLUGS, slug))
    eff = effect.replace(' ', '_')
    name = '%s %s %s' % (slot, slug, eff)
    if len(name) > cap:
        prefix = '%s %s ' % (slot, slug)
        keep = cap - len(prefix)
        eff = eff[:keep].rstrip('_')
        name = '%s%s' % (prefix, eff)
    if len(name) > MAX_LEN:
        raise ValueError('name still exceeds %d after cap and trim: %r' % (MAX_LEN, name))
    return name


def desktop():
    return Desktop(backend='uia')


def top_windows(d):
    return [w for w in d.windows() if h90_app.is_main_title(w.window_text())]


def main_window(d):
    for w in top_windows(d):
        r = w.rectangle()
        if r.width() >= 800:
            return w
    return None


def popup_window(d):
    for w in top_windows(d):
        r = w.rectangle()
        if 100 <= r.width() < 800:
            return w
    return None


def descendant_by_name(window, names):
    for el in window.descendants():
        try:
            if el.window_text() in names:
                return el
        except Exception:
            pass
    return None


def screen_center(el):
    r = el.rectangle()
    return (r.left + r.right) // 2, (r.top + r.bottom) // 2


def find_name_edit(win, prompt='Enter a Preset Name'):
    prompt_el = None
    for el in win.descendants():
        try:
            if el.element_info.control_type == 'Text' and el.window_text() == prompt:
                prompt_el = el
                break
        except Exception:
            pass
    if prompt_el is None:
        return None
    pr = prompt_el.rectangle()
    best, bd = None, 1e9
    for el in win.descendants():
        try:
            if el.element_info.control_type == 'Edit':
                rr = el.rectangle()
                dy = abs(rr.top - pr.bottom)
                if dy < bd:
                    best, bd = el, dy
        except Exception:
            pass
    return best


def set_edit_text(el, text):
    # UIA SetValue does NOT work on this JUCE text box (readback stays the
    # pre-filled default); type through the real keyboard instead.
    # send_keys specials: + (Shift), ^ (Ctrl), % (Alt) must be braced, or the
    # character is silently swallowed as a modifier prefix.
    key_text = ''
    for ch in text:
        if ch in '+^%{}':
            key_text += '{%s}' % ch
        else:
            key_text += ch
    click(coords=screen_center(el))
    time.sleep(0.3)
    send_keys('^a')
    time.sleep(0.2)
    send_keys(key_text, with_spaces=True)
    time.sleep(0.5)
    try:
        cur = el.get_value()
    except Exception:
        cur = ''
    return cur == text


def find_button(win, name):
    for el in win.descendants():
        try:
            if el.window_text() == name:
                return el
        except Exception:
            pass
    return None


def find_in_window(win, text):
    """Find a Text element whose text starts with or equals the given text."""
    for el in win.descendants():
        try:
            if el.window_text().startswith(text):
                return el
        except Exception:
            pass
    return None


def confirm_overwrite(d, name):
    """The Save dialog may pop an in-window 'Overwrite Preset ...?' prompt.
    Click its OK button. Returns True when handled."""
    win = main_window(d)
    if win is None:
        return False
    prompt = find_in_window(win, "Overwrite Preset '%s'?" % name)
    if prompt is None:
        return False
    pr = prompt.rectangle()
    ok = None
    for el in win.descendants():
        try:
            if el.window_text() == 'OK' and el.element_info.control_type == 'Button':
                rr = el.rectangle()
                if 200 <= rr.left <= 900 and pr.bottom - 20 <= rr.top <= pr.bottom + 120:
                    ok = el
                    break
        except Exception:
            pass
    if ok is None:
        print('FAIL: overwrite prompt found but no OK button near it')
        return False
    click(coords=screen_center(ok))
    time.sleep(1.5)
    print('overwrite confirmed')
    return True


def verify_saved(d, name):
    win = main_window(d)
    if win is None:
        return False
    for el in win.descendants():
        try:
            ct = el.element_info.control_type
            if ct == 'Edit' and el.get_value() == name:
                return True
            if ct == 'Text' and el.window_text() == name:
                return True
        except Exception:
            pass
    return False


def save(slot, slug, effect, do_click_ok=True):
    d = desktop()
    name = library_name(slot, slug, effect)
    print('library name: %r (%d/%d chars)' % (name, len(name), CAP))

    click(coords=MENU_BUTTON)
    time.sleep(1.2)

    popup = popup_window(d)
    if popup is None:
        print('FAIL: menu popup did not open')
        return 1
    item = descendant_by_name(popup, {'Save to Library'})
    if item is None:
        print('FAIL: "Save to Library" item not found in popup')
        return 1
    print('menu ok, "Save to Library" at center %s' % (screen_center(item),))
    click(coords=screen_center(item))
    time.sleep(1.2)

    win = main_window(d)
    edit = find_name_edit(win)
    if edit is None:
        print('FAIL: "Enter a Preset Name" edit not found')
        return 1
    print('name edit found, typing %r' % name)
    if not set_edit_text(edit, name):
        print('WARN: name not read back as typed, continuing to OK anyway')
    time.sleep(0.4)

    if do_click_ok:
        ok = find_button(win, 'OK')
        if ok is None:
            print('FAIL: OK button not found')
            return 1
        click(coords=screen_center(ok))
        time.sleep(1.5)
        confirm_overwrite(d, name)
        time.sleep(0.5)

    if verify_saved(d, name):
        print('OK: program saved as %r' % name)
        return 0
    print('WARN: could not verify program name is %r (dialog may still be open)' % name)
    return 2


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--slot', default='m1')
    ap.add_argument('--slug', choices=SLUGS, default='delay')
    ap.add_argument('--effect', default='Band Delay')
    ap.add_argument('--name-only', action='store_true',
                    help='print the computed library name and exit')
    ap.add_argument('--no-ok', action='store_true',
                    help='type the name but do not press OK (dry run)')
    args = ap.parse_args()
    if args.name_only:
        print(library_name(args.slot, args.slug, args.effect))
        return 0
    return save(args.slot, args.slug, args.effect, do_click_ok=not args.no_ok)


if __name__ == '__main__':
    sys.exit(main())