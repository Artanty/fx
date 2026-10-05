-- luacheck config for the norns scripts under monome/.
--
-- Host:     luacheck monome/drumgen monome/test
-- Scope:    drumgen + the shared test harness only. c4synth is not gated yet;
--           its findings get reported, not fixed, until it is opted in here.
--
-- The scripts target Lua 5.1.5 (the norns core), so the std is pinned to lua51
-- instead of whatever version luacheck itself happens to run on.
--
-- Deliberately NOT ignored: shadowing a stdlib name, unused values, unreachable
-- code, setting an undefined global. Those are the bugs that cost a device
-- round-trip to find.

std = 'lua51'
max_line_length = 100

-- Globals the norns runtime (matron + norns core) hands to a script, plus the
-- four callbacks that must stay globals in an entry file: the core dofiles only
-- the selected script, it never loads init.lua/redraw.lua/enc.lua/key.lua.
globals = {
  'norns', 'screen', 'metro', 'params', 'musicutil', 'midi', '_menu',
  'softclock', 'sequins',
  'init', 'redraw', 'enc', 'key',
}