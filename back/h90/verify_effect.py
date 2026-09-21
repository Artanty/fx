import json, sqlite3, os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
d = json.load(open('knob_values/band-delay-m2.json', encoding='utf-8'))
con = sqlite3.connect('midi_cc_map.db')
n = con.execute("select count(*) from knob_info where effect='Band Delay'").fetchone()[0]
v = con.execute("select count(*) from knob_values k join knob_info i on k.knob_id=i.id where i.effect='Band Delay'").fetchone()[0]
f = r'C:\server\fx\input\lib\m2 delay Band_Delay.preset90'
print('capture knobs:', len(d['knobs']), '| DB knob_info:', n, '| DB values:', v)
print('export file:', os.path.exists(f), 'mtime:', time.strftime('%H:%M:%S', time.localtime(os.path.getmtime(f))))
for k in d['knobs']:
    rng = k.get('range') or {}
    print('  %-14s CC#%-3d %-7s n=%-4d start=%s end=%s' % (k['label'], k['cc'], k['vtype'], len(k['values']), rng.get('start_before'), rng.get('end_before')))