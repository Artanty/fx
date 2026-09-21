import sys, time
sys.path.insert(0, '.')
sys.stdout.reconfigure(encoding='utf-8', errors='replace')
import h90_app, uia_driver, assign_cc
import build_knob_values as b
import auto_import
from pywinauto.mouse import click
from pywinauto.keyboard import send_keys

pid = h90_app.find_pid()
d = h90_app.desktop()
h90_app.pin_window()
send_keys('{ESC}'); time.sleep(0.4)
assign_cc.close_popup(d, pid)
print('connect:', auto_import.connect_if_needed(timeout=60))
time.sleep(0.8)
click(coords=(380, 1018)); time.sleep(1.4)
win = uia_driver.get_window(h90_app.connect())
rows = uia_driver.collect_params(win)
if not rows:
    click(coords=(45, 50)); time.sleep(1.4)
    click(coords=(380, 1018)); time.sleep(1.4)
    win = uia_driver.get_window(h90_app.connect())
    rows = uia_driver.collect_params(win)
print('param rows:', len(rows))

for label in ('Feedback A', 'Feedback B'):
    row = uia_driver.find_row(win, label)
    if row is None:
        print(label, 'row NOT FOUND'); continue
    rb = row['edit'].element_info.rectangle
    knob = (row['label'], rb.left, rb.top, rb.width(), rb.height())

    rb2, pop, last = assign_cc._open_knob_popup(d, pid, knob)
    print('== %s popup:%s' % (label, last))
    st = b.get_range_state(pop)
    print('   state-before:', st)
    res = b.force_full_range(pop, st)
    print('   force result:', res)
    cb = assign_cc.close_btn(pop)
    if cb is not None:
        assign_cc.click_center(cb)
    time.sleep(1.2)
    rb3, pop2, last2 = assign_cc._open_knob_popup(d, pid, knob)
    st2 = b.get_range_state(pop2)
    print('   state-after-reopen:', st2)
    cb2 = assign_cc.close_btn(pop2)
    if cb2 is not None:
        assign_cc.click_center(cb2)
    time.sleep(1.0)