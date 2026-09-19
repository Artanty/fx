#!/usr/bin/env python3
"""Stage-2 calibration script: build per-algorithm knob maps for the
/api/h90/assign CC send.

For every algorithm present in input/lib it:
  1. Recalls a program and imports the algorithm's m1 starter into Slot A via
     set_slot_a.py (the same flow /api/h90/assign uses), leaving the effect
     live on the pedal.
  2. Runs uia_driver.py --discover to snapshot the visible knob rows (labels,
     values, calibrate_slider lo/hi/k) from the H90 Control app.
  3. Aligns the discovered knob rows (sorted top-to-bottom / left-to-right,
     Slot-A column only) with the preset blob's knob keys (in file order), and
     prints a blob-key <-> discover-order alignment report.
  4. Matches each knob's control label to a CC number from
     midi_cc_states/<slug>.json and -m2.json (effect == algorithm).
  5. Writes knob-maps/<Algorithm_Underscored>-m1.json and -m2.json, where each
     entry is keyed by the preset blob key and carries {label, cc, lo, hi, k,
     vtype, unit}. /api/h90/assign consumes these files to transform blob
     values into CC bytes (rv inversion: value = lo + (hi-lo)*rv^k).

Files are keyed by blob key, so knob maps are per-algorithm (the same knob set
in both banks); the bank only changes the CC numbers.

Usage:
  python build_knob_maps.py                     # every algorithm in input/lib
  python build_knob_maps.py --algo "ModEchoVerb"
  python build_knob_maps.py --program 100       # which program slot to load into
  python build_knob_maps.py --out-dir knob-maps

Requires the Eventide Control app (logged in) and the H90 pedal connected; the
desktop must stay unlocked while this runs. Runs set_slot_a.py + uia_driver.py
as subprocesses, so a STOP kills the current step but the app/data stays intact.
"""

import argparse
import json
import os
import re
import subprocess
import sys
import time

sys.stdout.reconfigure(encoding='utf-8')

BASE = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.abspath(os.path.join(BASE, '..', '..', 'input', 'lib'))
STATE_DIR = os.path.join(BASE, 'midi_cc_states')

STARTER_NAME_RE = re.compile(r'^(m[12])\s+([\w-]+)\s+(.+)$')
META_KEYS = frozenset(('algorithm_name', 'preset_name', 'product_id', 'version'))

# must stay in sync with server.js NON_CC_KEY_RE / NON_CC_KEYS
SKIP_KEY_RE = re.compile(r'(_start_exp|_end_exp|_hot_switch|_denormalized_pretaper)$')
SKIP_KEYS = frozenset((
    'in1_sens', 'in2_sens', 'out1_sens', 'out2_sens',
    'expression_pedal', 'pedal', 'slow_mode',
))


def token(algorithm):
    return re.sub(r'\s+', '_', (algorithm or '')).strip()


def list_starters():
    """Return {token: {'name': display, 'm1': path, 'm2': path}} from input/lib."""
    out = {}
    for f in sorted(os.listdir(LIB)):
        if not f.lower().endswith('.preset90'):
            continue
        m = STARTER_NAME_RE.match(os.path.splitext(f)[0])
        if not m:
            continue
        bank, fam, name = m.group(1), m.group(2), m.group(3)
        tok = token(name)
        e = out.setdefault(tok, {'name': name, 'family': fam, 'm1': None, 'm2': None})
        e[bank] = os.path.join(LIB, f)
    return out


B64_ALPHABET = frozenset(b'0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ+/=')


def blob_keys(path):
    """Return the ordered list of knob keys from a preset file's first JSON
    blob, mirroring server.js extractJsonBlobs: scan the raw bytes for the
    start of a base64 run whose decoded text is a JSON object ('eyJ' is the
    base64 of '{'). Returns that object's keys (meta + non-CC keys excluded)."""
    try:
        raw = open(path, 'rb').read()
    except OSError as ex:
        raise RuntimeError('cannot read %s: %s' % (path, ex))
    i = 0
    needle = b'eyJ'
    while True:
        j = raw.find(needle, i)
        if j < 0:
            raise RuntimeError('%s contains no JSON blob' % path)
        k = j
        while k < len(raw) and raw[k] in B64_ALPHABET:
            k += 1
        if k - j < 4:
            i = j + 1
            continue
        try:
            import base64
            obj = json.loads(base64.b64decode(raw[j:k]).decode('utf-8-sig'))
        except Exception:
            i = j + 1
            continue
        if isinstance(obj, dict):
            return [key for key in obj if key not in META_KEYS and
                    not SKIP_KEY_RE.search(key) and key not in SKIP_KEYS]
    raise RuntimeError('%s contains no JSON object blob' % path)


def run_step(args, timeout=1800):
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
    except Exception as ex:
        return -2, repr(ex)


def cc_by_label(algorithm, bank):
    """Return {control label: cc} for one bank by scanning midi_cc_states for
    a document whose `effect` == algorithm and `slot` == bank."""
    suffix = '' if bank == 'm1' else '-m2'
    for f in sorted(os.listdir(STATE_DIR)):
        if not f.endswith('.json'):
            continue
        if not f.endswith(suffix + '.json'):
            continue
        try:
            doc = json.load(open(os.path.join(STATE_DIR, f), encoding='utf-8'))
        except OSError:
            continue
        if doc.get('effect') != algorithm or doc.get('slot') != bank:
            continue
        return {a.get('control'): int(a['cc']) for a in doc.get('assignments', [])
                if isinstance(a.get('cc'), int)}
    return {}


def discover_rows(win_map):
    """Filter a discovered knob map to the Slot-A column, sorted by
    top-to-bottom then left-to-right. Returns [(ly, lx, entry)]."""
    rows = []
    for e in win_map.get('knobs', []):
        if e.get('bucket') != 'A':      # Slot-A panel column only
            continue
        if not e.get('label'):
            continue
        rows.append((e.get('ly', 0), e.get('lx', 0), e))
    rows.sort(key=lambda r: (r[0], r[1]))
    return rows


def build_algorithm(tok, algo, out_dir, program, show):
    log = []
    log.append('=== %s ===' % algo['name'])
    if not algo.get('m1'):
        log.append('  SKIP: no m1 starter')
        return log, False
    if not algo.get('m2'):
        log.append('  SKIP: no m2 starter')
        return log, False

    tmp_map = os.path.join(out_dir, '.discover-%s.json' % tok)
    try:
        rc, out = run_step(['set_slot_a.py', str(program), algo['m1'],
                            '--slot', 'A'] + (['--show'] if show else []))
        if rc != 0:
            log.append('  LOAD FAIL rc=%d: %s' % (rc, out.strip()[-200:]))
            return log, False
        log.append('  loaded m1 starter (program %d, slot A)' % program)

        rc, out = run_step(['uia_driver.py', '--discover', '--out', tmp_map])
        if rc != 0:
            log.append('  DISCOVER FAIL rc=%d: %s' % (rc, out.strip()[-200:]))
            return log, False
        log.append('  discover ok')
    finally:
        pass

    keys = blob_keys(algo['m1'])
    doc = json.load(open(tmp_map, encoding='utf-8'))
    rows = discover_rows(doc)
    cc1 = cc_by_label(algo['name'], 'm1')
    cc2 = cc_by_label(algo['name'], 'm2')

    # align discovered knob rows <-> blob keys in order
    log.append('  blob keys: %d   discovered slots-A rows: %d'
               % (len(keys), len(rows)))
    knobs = []
    mism = 0
    for i, (_, _, e) in enumerate(rows):
        key = keys[i] if i < len(keys) else None
        label = e.get('label', '')
        cc = cc1.get(label) or cc2.get(label)   # same labels; cc per bank below
        entry = {
            'key': key,
            'label': label,
            'cc': None,        # resolved per bank below
            'lo': e.get('lo'),
            'hi': e.get('hi'),
            'k': e.get('k'),
            'vtype': e.get('vtype', 'numeric'),
            'unit': e.get('unit'),
            'settle': e.get('settable', False),
        }
        if key is None:
            mism += 1
        log.append('    [%3d] %-24s <- %-22s cc=%-3s lo=%-8s hi=%-8s k=%s  %s'
                   % (i + 1, key or '????', label, cc, entry['lo'], entry['hi'],
                      entry['k'],
                      '' if cc is not None else '[no CC entry in midi_cc_states]'))
        knobs.append(entry)

    if mism:
        log.append('  WARNING: %d discovered rows exceed blob key count; '
                   'extra rows recorded with key=null' % mism)

    for bank, cc_map in (('m1', cc1), ('m2', cc2)):
        bank_knobs = []
        missing = 0
        for e in knobs:
            cc = cc_map.get(e['label'])
            if cc is None:
                missing += 1
            bank_knobs.append(dict(e, cc=cc))
        out_path = os.path.join(out_dir, '%s-%s.json' % (tok, bank))
        payload = {
            'kind': 'h90-knob-map-calibrated',
            'effect': algo['name'],
            'bank': bank,
            'token': tok,
            'created': time.strftime('%Y-%m-%dT%H:%M:%S'),
            'source': 'set_slot_a import + uia_driver discover',
            'knobs': bank_knobs,
            'counts': {'blob_keys': len(keys), 'discovered': len(rows),
                       'unmapped_cc': missing},
        }
        json.dump(payload, open(out_path, 'w', encoding='utf-8'),
                  ensure_ascii=False, indent=2)
        log.append('  wrote %s (%d entries, %d without CC)'
                   % (os.path.basename(out_path), len(bank_knobs), missing))
    return log, True


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--algo', default=None,
                    help='only build maps for this algorithm display name')
    ap.add_argument('--program', type=int, default=100,
                    help='program slot used to load each effect (default 100)')
    ap.add_argument('--out-dir', default=os.path.join(BASE, 'knob-maps'))
    ap.add_argument('--show', action='store_true',
                    help='keep the H90 Control windows visible (set_slot_a --show)')
    args = ap.parse_args()

    os.makedirs(args.out_dir, exist_ok=True)
    starters = list_starters()
    if args.algo:
        tok = token(args.algo)
        algo = starters.get(tok)
        if not algo:
            print('no starters match %r' % args.algo)
            print('known algorithms:')
            for t in sorted(starters):
                print('  %s' % starters[t]['name'])
            return 1
        requested = {tok: algo}
    else:
        requested = starters

    failed = []
    for tok in sorted(requested):
        algo = requested[tok]
        log, ok = build_algorithm(tok, algo, args.out_dir, args.program, args.show)
        for ln in log:
            print(ln, flush=True)
        if not ok:
            failed.append(algo['name'])
        time.sleep(0.5)

    print('=== done: %d ok, %d failed ===' % (len(requested) - len(failed), len(failed)))
    for name in failed:
        print('  FAILED %s' % name)
    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())