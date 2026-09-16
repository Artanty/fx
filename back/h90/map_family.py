#!/usr/bin/env python3
"""Drive the full per-effect pipeline: load via algorithm browser -> map all
CCs -> save to library -> mark saved in library_saved.json.

Usage:
  python map_family.py --category Harmonizer --slug harm --effect "Crystals"
  python map_family.py --table families.csv   # each line: category,slug,effect
"""

import argparse
import csv
import glob
import json
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')
print('START', flush=True)

BASE = os.path.dirname(os.path.abspath(__file__))
LIB_SAVED = os.path.join(BASE, 'library_saved.json')
STATES_DIR = os.path.join(BASE, 'midi_cc_states')


def load_marked():
    try:
        with open(LIB_SAVED, encoding='utf-8') as f:
            data = json.load(f)
    except Exception:
        return {}
    if isinstance(data, dict) and 'saved' in data:
        data = data['saved']
    return {k: bool(v) for k, v in data.items() if isinstance(v, (bool, int))}


def state_exists(effect, slot):
    slug = effect.lower().replace(' ', '-')
    fname = '%s%s.json' % (slug, '' if slot == 'm1' else '-m2')
    return os.path.exists(os.path.join(STATES_DIR, fname))


def run(script, *args):
    cmd = [sys.executable, os.path.join(BASE, script)] + list(args)
    p = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8')
    out = (p.stdout or '') + (p.stderr or '')
    return p.returncode, out


def mark_saved(name):
    with open(LIB_SAVED, encoding='utf-8') as f:
        data = json.load(f)
    data[name] = True
    with open(LIB_SAVED, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def display_name(effect, slot):
    if slot == 'm1':
        return effect
    if effect.endswith(' m2'):
        return effect
    return '%s m2' % effect


def process(category, slug, effect, slot='m1', cc_base=0):
    marked = load_marked()
    disp = display_name(effect, slot)
    if marked.get(disp) and state_exists(effect, slot):
        print('\n# SKIP %s / %s (already saved as %r)' % (category, effect, disp), flush=True)
        return True
    print('\n=== %s / %s [%s cc-base %d] ===' % (category, effect, slot, cc_base), flush=True)
    rc1, out1 = run('load_effect.py', '--effect', effect, '--category', category)
    print('[load effect] rc=%d' % rc1, flush=True)
    if out1:
        print(out1.strip()[:400], flush=True)
    if rc1 != 0:
        print('FAIL: load_effect failed, skipping', flush=True)
        return False
    time.sleep(1)

    rc2, out2 = run('map_delay_effects.py', '--effect', effect, '--slug', slug,
                    '--slot', slot, '--cc-base', str(cc_base))
    print('[map] rc=%d' % rc2, flush=True)
    tail = out2.strip()
    if tail:
        print(tail[-500:], flush=True)
    if rc2 != 0:
        print('FAIL: map_delay_effects failed (rc=%d)' % rc2, flush=True)
        return False

    rc3, out3 = run('save_to_library.py', '--slot', slot, '--slug', slug,
                    '--effect', effect)
    print('[save] rc=%d' % rc3, flush=True)
    if out3:
        print(out3.strip()[:400], flush=True)
    if 'OK: program saved' not in out3:
        print('FAIL: save did not confirm', flush=True)
        return False

    mark_saved(display_name(effect, slot))
    print('OK: marked saved (%r)' % display_name(effect, slot), flush=True)
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--category')
    ap.add_argument('--slug')
    ap.add_argument('--effect')
    ap.add_argument('--table', help='CSV with header: category,slug,effect')
    ap.add_argument('--slot', default='m1', choices=('m1', 'm2'))
    ap.add_argument('--cc-base', type=int, default=0)
    args = ap.parse_args()

    if args.table:
        with open(args.table, newline='', encoding='utf-8') as f:
            rows = list(csv.DictReader(f))
        ok = 0
        mark_before = len(load_marked())
        for i, r in enumerate(rows, 1):
            done = process(r['category'], r['slug'], r['effect'],
                           args.slot, args.cc_base)
            if done:
                ok += 1
            print('[STATUS] batch %-12s %d/%d effects done (%d saved marks total)'
                  % (os.path.basename(args.table), ok, i, len(load_marked())),
                  flush=True)
        print('\nDONE: %d/%d succeeded (total saved marks grew %d -> %d)'
              % (ok, len(rows), mark_before, len(load_marked())), flush=True)
        return 0 if ok == len(rows) else 1

    if not (args.category and args.slug and args.effect):
        ap.error('need --category --slug --effect or --table')
    return 0 if process(args.category, args.slug, args.effect,
                        args.slot, args.cc_base) else 1


if __name__ == '__main__':
    sys.exit(main())