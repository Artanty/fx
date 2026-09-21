import json, glob, os, sqlite3, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import export_m2_lib as E

con = sqlite3.connect('midi_cc_map.db')
bad = 0
for cpath in sorted(glob.glob('knob_values/*-m2.json')):
    d = json.load(open(cpath, encoding='utf-8'))
    eff = d.get('effect') or d.get('display')
    state = os.path.basename(cpath)
    state_json = json.load(open(os.path.join('midi_cc_states', state), encoding='utf-8'))
    slug = state_json['slug']
    lib = E.library_name('m2', slug, eff if eff else d['effect'])
    exp = os.path.join(E.LIB_DIR, lib + '.preset90')
    # DB
    n_info = con.execute("select count(*) from knob_info where effect=?", (eff,)).fetchone()[0]
    n_val = con.execute("select count(*) from knob_values k join knob_info i on k.knob_id=i.id where i.effect=?", (eff,)).fetchone()[0]
    # ranges
    off = [k['label'] for k in d['knobs']
           if not (abs((k.get('range') or {}).get('start_after', 0)) <= 0.001
                   and abs((k.get('range') or {}).get('end_after', 1) - 1.0) <= 0.01)]
    # utility programs (Mute/Thru) have ONLY the general block -> 0 effect knobs is valid
    GENERAL_BLOCK = {
        'In Gain', 'Out Gain', 'Bypass', 'Tails', 'Tempo Mode', 'HotKnob', 'Kill Dry',
    }
    has_effect = any(
        a.get('control') not in GENERAL_BLOCK
        for a in state_json.get('assignments', [])
    )
    no_knobs_ok = not has_effect
    q = ('OK ' if (n_info and n_val or no_knobs_ok) and not off else 'BAD')
    if off or (not no_knobs_ok and not (n_info and n_val)):
        bad += 1
    expm = os.path.exists(exp)
    print('%s %-24s knobs=%-3d vals=%-5d rng-off=%s export=%s %s' % (
        q, eff, n_info, n_val, ','.join(off) if off else '-', 'Y' if expm else 'N', state))
print('effects with range issues:', bad)