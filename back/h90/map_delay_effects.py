"""Map every assignable control of the currently-loaded Slot-A effect to
sequential MIDI CC numbers and save the state JSON.

Scheme (self-contained per effect):
  - algorithm knobs -> CC 0..N-1 (top-to-bottom, then left-to-right),
    then the slot's General block (In Gain, Out Gain, Bypass, Tails,
    Tempo Mode, HotKnob, Kill Dry) continues at CC N..
  - the fixed bottom "program footer" block (labels y>=860: Mix/In Gain/
    Out Gain, In Gain/Out Gain/Bypass, "parameter edit mode" row) is NEVER
    assigned. Exclusion is POSITIONAL (y>=860), NEVER by label name, because
    real algorithm knobs can share names (e.g. UltraTap algorithm 'Mix').
  - unpack rule (user): a knob is only assigned once it is scrolled fully
    visible (clear of the header and of the program footer).
  - identity rule (user): the MIDI popup that opens for a knob is checked to
    name that knob (popup_knob_name); assigning/verifying never trusts the CC
    number alone, because a stale rect can open the program footer's popup
    (observed: Kill Dry click opened footer 'Mix'). On a wrong-knob popup the
    knob is re-scrolled into view (ensure_knob_visible lifts it clear of the
    footer, JUCE auto-scrolls after each assignment) and retried.

Usage:
  python map_delay_effects.py --effect "Bouquet Delay"
  python map_delay_effects.py --effect "Bouquet Delay" --dry-run

State is written to midi_cc_states/<effect-slug>.json.
Requires the H90 Control app running with the target algorithm live in Slot A
and the panel showing its knobs.
"""

import argparse
import json
import os
import re
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

import psutil
from pywinauto import Desktop
from pywinauto.mouse import click, scroll

from assign_cc import (
    find_pid, popup_window, close_popup,
    assign_knob, verify_mapping,
)
from test_assign_cc import find_label_and_values, knob_value_rect

PROGRAM_KNOBS = frozenset([
    'Mix', 'In Gain', 'Out Gain', 'Bypass', 'Tails',
    'Tempo Mode', 'HotKnob', 'Kill Dry',
])   # legacy name set — for docs only. Exclusion is POSITIONAL via PROG_FOOTER_Y.
PROG_FOOTER_Y = 860          # bottom full-width program footer block (labels y>=this)
PANEL_X_MAX = 645
PANEL_CHROME_Y = 195        # header chrome ends ~y=194; first knob row starts y=197
PANEL_LO = 231              # Algorithm Parameters viewport top
PANEL_HI = 829              # viewport bottom
WHEEL_ANCHOR = (651, 400)     # scrollbar track – never over a knob
NUMERIC_RE = re.compile(r'^\s*[-+]?\d+(?:[.,]\d+)?\s*[\wµ/°]*\s*$')

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATE_DIR = os.path.join(BASE_DIR, 'midi_cc_states')


class LivePanel:
    """Snapshot of the Slot-A panel: labels + value rects (+value text)."""

    def __init__(self, d, pid):
        self.textmap = {}
        for w in d.windows(process=pid):
            if w.rectangle().width() < 800:
                continue
            for el in w.descendants():
                try:
                    rr = el.rectangle()
                    nm = el.window_text()
                except Exception:
                    continue
                if nm and rr.width() > 0:
                    key = (rr.left, rr.top, rr.right, rr.bottom)
                    self.textmap.setdefault(key, nm)
        self.labels, self.values = find_label_and_values(d, pid)

    def value_text(self, x, y, w, h):
        return self.textmap.get((x, y, x + w, y + h), '')

    def effect_knobs(self):
        cats, used = [], set()
        for (nm, ll, lt, lr, lb) in self.labels:
            if ll < 289 or lr > PANEL_X_MAX or lt < PANEL_CHROME_Y:
                continue
            if lt >= PROG_FOOTER_Y:     # bottom program footer block
                continue
            if nm in used:
                continue
            rect = knob_value_rect([(nm, ll, lt, lr, lb)], self.values, nm)
            if rect is None:
                continue
            cats.append((lt, ll, nm, rect))
            used.add(nm)
        cats.sort(key=lambda c: (c[0], c[1]))
        return [(nm, rect) for (_, _, nm, rect) in cats]


def _effect_label_names(p):
    """Return the set of effect-area label names currently in the tree (any y)."""
    names = set()
    for (nm, ll, lt, lr, lb) in p.labels:
        if ll < 289 or lr > PANEL_X_MAX:
            continue
        if lt >= PROG_FOOTER_Y:     # bottom program footer
            continue
        names.add(nm)
    return names


def _raw_effect_labels(p):
    """All effect-area label rows currently in the tree, unfiltered by y."""
    rows = []
    for (nm, ll, lt, lr, lb) in p.labels:
        if ll < 289 or lr > PANEL_X_MAX:
            continue
        if lt >= PROG_FOOTER_Y:     # bottom program footer
            continue
        rows.append((lt, ll, nm))
    return rows


def normalize_effect_stage(d, pid):
    p = LivePanel(d, pid)
    rows = _raw_effect_labels(p)
    if rows and min(r[0] for r in rows) < PANEL_LO:
        # first row overlaps the header chrome - escape back down first
        for _ in range(8):
            scroll(coords=WHEEL_ANCHOR, wheel_dist=-8)
            time.sleep(0.25)
        time.sleep(0.4)

    p = LivePanel(d, pid)
    for _ in range(20):
        raw = _raw_effect_labels(p)
        if raw:
            min_lt = min(r[0] for r in raw)
            if min_lt >= PANEL_LO:
                knobs = p.effect_knobs()
                if knobs:
                    tops = [r[1] for _, r in knobs]
                    bots = [r[1] + r[3] for _, r in knobs]
                    if min(tops) >= PANEL_LO and max(bots) <= PANEL_HI + 60:
                        return p, knobs
        scroll(coords=WHEEL_ANCHOR, wheel_dist=8)
        time.sleep(0.5)
        p = LivePanel(d, pid)
    knobs = p.effect_knobs()
    return p, knobs


def classify(text):
    return 'numeric' if NUMERIC_RE.match((text or '').strip()) else 'enum'


def scroll_page_down(d, pid, steps=3):
    """Scroll the effect panel down by *steps* notches (content moves up)."""
    for _ in range(steps):
        scroll(coords=WHEEL_ANCHOR, wheel_dist=-3)
        time.sleep(0.25)
    time.sleep(0.4)


def _walk_to_knob(d, pid, nm):
    """Scroll back to the anchored top, then walk down page by page re-
    measuring each page (fresh renders) until knob *nm* is found. Returns its
    current rect, or None.

    Used to recover from stale UIA coordinates after JUCE's auto-scroll
    (observed: phase-2 first knob measured ~3 rows above its real row).
    """
    from pywinauto.keyboard import send_keys
    send_keys('{ESC}')
    time.sleep(0.5)
    close_popup(d, pid)
    p, _ = normalize_effect_stage(d, pid)
    for _ in range(10):
        p = LivePanel(d, pid)
        page = p.effect_knobs()
        for n, r in page:
            if n == nm:
                return r
        scroll_page_down(d, pid, steps=3)
    return None


def collect_effect_knobs(d, pid):
    """Return current page of effect knobs as [(name, rect)]."""
    p = LivePanel(d, pid)
    return p.effect_knobs()


def ensure_knob_visible(d, pid, nm, rect):
    """Scroll the panel until knob *nm* (value + label) is fully visible and
    clear of the program footer, then return its current value rect.

    User rule: a knob is only assigned once it is scrolled fully visible.
    "Fully visible" means the value AND its label sit comfortably above the
    program footer (PROG_FOOTER_Y) with real clearance - not just barely
    visible. While a knob hugs the footer, clicks resolve to footer rows
    (e.g. Kill Dry -> footer Mix), so keep scrolling it up until clear.
    """
    x, y, w, h = rect
    for _ in range(30):
        label_bottom = y + h + 30      # value h=22 + label (~22) + gap
        if label_bottom <= PROG_FOOTER_Y - 70 and y >= PANEL_LO - 40:
            return (x, y, w, h)
        if y < PANEL_LO - 40:          # clipped at top: scroll content down
            for _ in range(2):
                scroll(coords=WHEEL_ANCHOR, wheel_dist=8)
                time.sleep(0.25)
        else:                          # near footer: scroll content up (lifts knob)
            scroll_page_down(d, pid, steps=1)
        p = LivePanel(d, pid)
        cur = [r for n, r in p.effect_knobs() if n == nm]
        if not cur:
            return (x, y, w, h)
        x, y, w, h = cur[0]
        if y == rect[1] and w == rect[2]:   # no move possible (already at bottom)
            break
    return (x, y, w, h)


def _assign_batch(d, pid, knobs, cc_start, effect_name):
    """Assign CC numbers to a batch of knobs. Returns (rows, next_cc).

    JUCE auto-scrolls the panel when a knob is selected, so each knob's rect
    is re-measured immediately before assigning, and the resulting MIDI popup
    is identity-checked (it must name the intended knob). On a wrong-knob
    popup (caused by a stale/auto-scrolled rect landing on the program footer)
    the knob is re-scrolled into view and retried before giving up.
    """
    rows = []
    cc = cc_start
    for nm, _rect in knobs:
        p = LivePanel(d, pid)
        x, y, w, h = _rect
        val = p.value_text(x, y, w, h)
        row = {'type': classify(val), 'effect': effect_name,
               'control': nm, 'cc': cc, 'values': val}

        res, v, ok = None, None, False
        walked = None
        for attempt in range(4):
            if attempt > 0:
                # A wrong-knob click can open the ALGORITHM BROWSER (full-window
                # modal with no closeButton) instead of a knob MIDI popup; it
                # must be dismissed with ESC (close_popup only handles narrow
                # MIDI popups). Then clear any narrow popup and re-walk from
                # the anchored top to recover trustworthy coordinates.
                from pywinauto.keyboard import send_keys
                send_keys('{ESC}')
                time.sleep(0.5)
                close_popup(d, pid)
                walked = _walk_to_knob(d, pid, nm)
                if walked is not None:
                    _rect = walked
            rect = ensure_knob_visible(d, pid, nm, _rect if attempt == 0 or walked is not None else cur_fallback)
            # re-measure immediately before clicking (JUCE auto-scrolls on select)
            p = LivePanel(d, pid)
            cur = [r for n, r in p.effect_knobs() if n == nm]
            if not cur:
                cur_fallback = rect
                continue
            rectv = cur[0]
            cur_fallback = rectv
            knob = (nm, rectv[0], rectv[1], rectv[2], rectv[3])
            x, y, w, h = rectv
            val = p.value_text(x, y, w, h) or val
            res = assign_knob(d, pid, knob, cc)
            v = verify_mapping(d, pid, knob)
            ok = ('MIDI CC' in v and ('CC# %d' % cc) in v
                  and 'wrong knob' not in v)
            print('%-28s assign=%-22s verify=%s' % (nm, res, v))
            if ok:
                break
            if 'wrong knob' in str(v) or 'wrong knob' in str(res) \
               or 'popup did not open' in str(v) \
               or 'popup did not open' in str(res) \
               or 'no rangeButton' in str(v):
                continue        # re-render + re-measure then retry
            break               # other hard failure: abort

        if not ok:
            print('ABORT: %s did not verify (%s / %s)' % (nm, res, v))
            return None, cc
        row['verified'] = True
        row['values'] = val
        rows.append(row)
        cc += 1
    return rows, cc


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--effect', required=True, help='display name, e.g. Bouquet Delay')
    ap.add_argument('--slug', default='delay', choices=('delay', 'dist', 'harm', 'harmp', 'looper', 'mod', 'multi',
             'reverb', 'synth', 'utility', 'eq'))
    ap.add_argument('--slot', default='m1', choices=('m1', 'm2'))
    ap.add_argument('--cc-base', type=int, default=0,
                    help='first CC number for the effect knobs (m2 presets use 50)')
    ap.add_argument('--dry-run', action='store_true', help='print the plan and exit')
    args = ap.parse_args()

    slug = args.effect.lower().replace(' ', '-')
    if args.slot == 'm2':
        slug = slug + '-m2'
    os.makedirs(STATE_DIR, exist_ok=True)
    state_path = os.path.join(STATE_DIR, slug + '.json')
    cc0 = args.cc_base

    pid = find_pid()
    d = Desktop(backend='uia')
    from pywinauto.keyboard import send_keys
    send_keys('{ESC}')
    time.sleep(0.4)
    close_popup(d, pid)

    # --- Phase 1: collect all effect knobs across scroll pages ---
    p0, first_knobs = normalize_effect_stage(d, pid)

    if not first_knobs:
        print('NOTE: no algorithm (effect) knobs found; the program block is '
              'not touched (rule), so nothing is assigned')
        if args.dry_run:
            print('0 effect knobs -> no CC assignments')
            return 0
        effect_rows = []
        cc = cc0
    else:
        all_effect_knobs = []
        seen = set()
        for nm, rect in first_knobs:
            if nm not in seen:
                all_effect_knobs.append((nm, rect))
                seen.add(nm)

        if args.dry_run:
            # scroll down to discover any remaining effect knobs
            for _ in range(6):
                scroll_page_down(d, pid, steps=3)
                page = collect_effect_knobs(d, pid)
                new = [(nm, r) for nm, r in page if nm not in seen]
                if not new:
                    break
                for nm, rect in new:
                    all_effect_knobs.append((nm, rect))
                    seen.add(nm)
            # print plan
            print('%-3s %-28s %-10s %r' % ('CC', 'control', 'type', 'value'))
            for cc, (nm, rect) in enumerate(all_effect_knobs, start=cc0):
                x, y, w, h = rect
                p = LivePanel(d, pid)
                val = p.value_text(x, y, w, h)
                print('%-3d %-28s %-10s %r' % (cc, nm, classify(val), val))
            n = len(all_effect_knobs)
            print('%d effect knobs -> CC %d..%d (program block untouched)'
                  % (n, cc0, cc0 + n - 1))
            return 0

        # --- Assign page 1 (already at top) ---
        effect_rows, cc = _assign_batch(d, pid, first_knobs, cc0, args.effect)
        if effect_rows is None:
            return 3
        assigned = set(nm for nm, _ in first_knobs)

        # --- Phase 2: scroll down to find and assign remaining effect knobs ---
        for _ in range(6):
            scroll_page_down(d, pid, steps=3)
            p = LivePanel(d, pid)
            page = p.effect_knobs()
            new = [(nm, r) for nm, r in page if nm not in assigned]
            if not new:
                break
            batch_rows, cc = _assign_batch(d, pid, new, cc, args.effect)
            if batch_rows is None:
                return 3
            effect_rows.extend(batch_rows)
            for nm, _ in new:
                assigned.add(nm)

    n = len(effect_rows)

    rows = effect_rows
    print()
    print('%-3s %-28s %-10s %6s %r' % ('CC', 'control', 'type', 'verify', 'value'))
    for r in rows:
        print('%-3d %-28s %-10s %6s %r' % (r['cc'], r['control'], r['type'],
                                            r.get('verified'), r['values']))
    print('%d effect knobs -> CC %d..%d (program footer untouched)'
          % (n, cc0, cc0 + len(rows) - 1))

    payload = {
        'effect': args.effect,
        'display': args.effect if args.slot == 'm1' else '%s m2' % args.effect,
        'slot': args.slot,
        'slug': args.slug,
        'cc_layout': 'effect+General %d..%d+N-1, program footer untouched'
                     % (cc0, cc0),
        'assignments': rows,
    }
    with open(state_path, 'w', encoding='utf-8') as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print('saved: %s' % state_path)
    return 0


if __name__ == '__main__':
    sys.exit(main())