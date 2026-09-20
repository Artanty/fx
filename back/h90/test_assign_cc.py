import json
import sys
import time
import unittest

sys.stdout.reconfigure(encoding='utf-8')

import psutil
from pywinauto import Desktop

import h90_app
from assign_cc import verify_mapping

STATE = 'midi_cc_state.json'

EXPECTED_CCS = list(range(17))
EXPECTED_CONTROLS = [
    'Wet Mix', 'Delay Mix', 'Delay A', 'Delay B',
    'Feedback A', 'Feedback B', 'Mod Depth', 'Mod Speed',
    'Resonance', 'Filter Type',
    'In Gain', 'Out Gain', 'Bypass', 'Tails', 'Tempo Mode', 'HotKnob', 'Kill Dry',
]
EXPECTED_EFFECTS = ['Band Delay'] * 10 + ['General'] * 7

# Slot-A panel occupies x 289..656; right panel / bottom bar live outside it.
PANEL_X_MAX = 645


def load_state():
    with open(STATE, encoding='utf-8') as f:
        return json.load(f)


def find_label_and_values(d, pid):
    """Live-locate the Slot-A panel: labels (Text) and value elements
    (Edit/Button/ComboBox). Returns (labels, values) as rect lists."""
    labels = []
    values = []
    for w in d.windows(process=pid):
        try:
            rr = w.rectangle()
        except Exception:
            continue
        if not (800 <= rr.width() <= 13000):
            continue
        for el in w.descendants():
            try:
                ct = el.element_info.control_type
            except Exception:
                continue
            if ct not in ('Text', 'Edit', 'Button', 'ComboBox'):
                continue
            try:
                name = el.window_text()
            except Exception:
                name = ''
            try:
                rr = el.rectangle()
            except Exception:
                continue
            if rr.right > PANEL_X_MAX or rr.right < rr.left:
                continue
            if ct == 'Text':
                if name:
                    labels.append((name, rr.left, rr.top, rr.right, rr.bottom))
            else:
                values.append((rr.left, rr.top, rr.right, rr.bottom))
    return labels, values


def knob_value_rect(labels, values, name):
    """Return the value-element rect (x, y, w, h) for a Slot-A knob by its
    label: the value whose bottom sits just above the label, same column."""
    match = None
    for (nm, ll, lt, lr, lb) in labels:
        if nm == name and ll >= 289:
            if match is None or lt < match[1]:
                match = (nm, ll, lt, lr, lb)
    if match is None:
        return None
    _, ll, lt, lr, lb = match
    best, bd = None, 1e9
    for (vl, vt, vr, vb) in values:
        dy = lt - vb  # gap between value bottom and label top
        overlap = min(vr, lr) - max(vl, ll)
        if -5 <= dy <= 60 and overlap > 20 and dy < bd:
            best, bd = (vl, vt, vr - vl, vb - vt), dy
    return best


class TestCCSequential(unittest.TestCase):

    def test_state_entries_are_sequential(self):
        assigns = load_state()['assignments']
        self.assertEqual(len(assigns), 17)
        by_cc = sorted(assigns, key=lambda a: a['cc'])
        ccs = [a['cc'] for a in by_cc]
        self.assertEqual(ccs, EXPECTED_CCS,
                         'CC numbers must be sequential 0..16')
        controls = [a['control'] for a in by_cc]
        self.assertEqual(controls, EXPECTED_CONTROLS)
        effects = [a['effect'] for a in by_cc]
        self.assertEqual(effects, EXPECTED_EFFECTS)
        for a in by_cc:
            self.assertTrue(a['verified'],
                            '%s must be verified' % a['control'])

    def test_live_app_ccs_match_state(self):
        pid = None
        hit = h90_app.running_app()
        if hit is not None:
            pid = hit[2]
        if pid is None:
            self.skipTest('Eventide/H90 Control app is not running')
        d = Desktop(backend='uia')
        assigns = {a['control']: a['cc'] for a in load_state()['assignments']}
        # Coordinate clicks need the canonical pinned rect and the app on top;
        # JUCE may also drop the whole UIA tree while the window is occluded.
        h90_app.pin_window()
        h90_app.main_window().set_focus()
        time.sleep(0.5)
        for name in EXPECTED_CONTROLS:
            # Re-measure for every knob: interacting with a knob can auto-scroll
            # the panel, so cached rects go stale (m2 batch lesson).
            labels, values = find_label_and_values(d, pid)
            rect = knob_value_rect(labels, values, name)
            self.assertIsNotNone(rect, 'no value rect found for %s' % name)
            knob = (name, rect[0], rect[1], rect[2], rect[3])
            res = verify_mapping(d, pid, knob)
            if res.startswith('FAIL: no rangeButton'):
                # window may have lost focus / slipped behind another window;
                # re-pin, refocus, re-measure and retry once before failing.
                h90_app.pin_window()
                h90_app.main_window().set_focus()
                time.sleep(0.5)
                labels, values = find_label_and_values(d, pid)
                rect = knob_value_rect(labels, values, name)
                if rect is not None:
                    knob = (name, rect[0], rect[1], rect[2], rect[3])
                    res = verify_mapping(d, pid, knob)
            self.assertIn("src='MIDI CC'", res, '%s: %s' % (name, res))
            self.assertIn('CC# %d' % assigns[name], res,
                          '%s: %s' % (name, res))


if __name__ == '__main__':
    unittest.main(verbosity=2)