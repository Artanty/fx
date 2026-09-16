#!/usr/bin/env python3
"""Map ALL remaining m2 (slot B) presets, one effect at a time:
   load_effect -> map_delay_effects --slot m2 --cc-base 50 ->
   save_to_library -> mark <Effect> m2 in library_saved.json

Progress is printed per iteration, e.g.:
   [m2] effectTypes: 4/11 (Reverb)  effect: 8/14 (Plate)  ran: 41/72
Log lines are also appended to m2_batch_run.log so progress can be polled
while the batch runs in the background.
"""

import csv
import json
import os
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

BASE = r'C:\server\fx\back\h90'
CSV = os.path.join(BASE, 'families_m2.csv')
LIB = os.path.join(BASE, 'library_saved.json')
LOG = os.path.join(BASE, 'm2_batch_run.log')

CC_BASE = 50


def log(msg):
    line = msg
    print(line, flush=True)
    with open(LOG, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def run_step(args, timeout=1500):
    env = dict(os.environ)
    env['PYTHONPATH'] = BASE
    try:
        r = subprocess.run(
            [sys.executable] + args, cwd=BASE, env=env,
            capture_output=True, text=True, encoding='utf-8',
            errors='replace', timeout=timeout)
        return r.returncode, (r.stdout or '') + (r.stderr or '')
    except subprocess.TimeoutExpired:
        return -1, 'TIMEOUT'
    except Exception as e:
        return -2, repr(e)


def main():
    rows = list(csv.DictReader(open(CSV, encoding='utf-8')))
    lib = json.load(open(LIB, encoding='utf-8'))

    cats = []
    for r in rows:
        if r['category'] not in [c[0] for c in cats]:
            cats.append([r['category'], 0])
        for c in cats:
            if c[0] == r['category']:
                c[1] += 1
                break
    ndone_prev = sum(1 for r in rows if lib.get(r['effect'] + ' m2'))
    total = len(rows)
    log('=== m2 batch run start: %d rows, %d already saved ===' % (total, ndone_prev))

    ran = 0
    cat_no = 0
    fail = []

    for ci, (cat, cmax) in enumerate(cats, 1):
        cat_no += 1
        in_cat = 0
        for j, r in enumerate(rows, 1):
            if r['category'] != cat:
                continue
            in_cat += 1
            eff, slug = r['effect'], r['slug']
            key = eff + ' m2'
            if lib.get(key):
                continue
            ran += 1
            log('[m2] effectTypes: %d/%d (%s)   effect: %d/%d (%s)   ran: %d/%d'
                % (cat_no, len(cats), cat, in_cat, cmax, eff, ran, total - ndone_prev))

            rc, out = run_step(['load_effect.py', '--effect', eff,
                                '--category', cat])
            if rc != 0:
                msg = '  load FAIL rc=%d: %s' % (rc, out.strip()[-200:])
                log(msg); fail.append((cat, eff, 'load', msg))
                continue
            log('  loaded %s' % eff)

            rc, out = run_step(['map_delay_effects.py', '--effect', eff,
                                '--slug', slug, '--slot', 'm2',
                                '--cc-base', str(CC_BASE)], timeout=3000)
            ok = rc == 0
            tail = out.strip().splitlines()
            tail = tail[-1] if tail else ''
            for ln in out.splitlines():
                if '-> CC' in ln or 'ABORT' in ln or 'saved:' in ln:
                    log('  ' + ln.strip())
            if not ok:
                msg = '  MAP FAIL rc=%d tail=%r' % (rc, tail[-200:])
                log(msg); fail.append((cat, eff, 'map', msg))
                continue

            rc, out = run_step(['save_to_library.py', '--slot', 'm2',
                                '--slug', slug, '--effect', eff], timeout=600)
            if rc == 0:
                lib[key] = True
                json.dump(lib, open(LIB, 'w', encoding='utf-8'),
                          ensure_ascii=False, indent=2)
                log('  SAVED %s  =>  library_saved.json updated (%d saved)'
                    % (key, sum(1 for v in lib.values() if v)))
            else:
                msg = '  SAVE FAIL rc=%d' % rc
                log(msg); fail.append((cat, eff, 'save', msg))
            time.sleep(0.5)

    log('=== m2 batch run done: %d run, %d failed ===' % (ran, len(fail)))
    for f in fail:
        log('  FAILED %s / %s [%s]: %s' % (f[0], f[1], f[2], f[3]))
    return 0 if not fail else 1


if __name__ == '__main__':
    sys.exit(main())