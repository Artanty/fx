-- monome/test/run.lua -- run the monome test suites under a plain Lua 5.1.
--
-- Host:
--   luajit monome/test/run.lua                 all suites
--   luajit monome/test/run.lua gen             only files matching 'gen'
--   luajit monome/test/run.lua --update-goldens   rewrite monome/test/golden/
--
-- The suite list is a manifest rather than a directory listing so the run is
-- identical on the host and on the norns (no io.popen, no shell).
--
-- Device: the norns cannot install anything, and monome/test must NOT be
-- deployed next to the script - the norns script menu only filters lib/, data/
-- and crow/, so a test/ directory shows up as a spurious menu entry (same trap
-- as the nested c4synth/ dir). Device runs are a deliberate one-off: copy the
-- test files somewhere off the script path and run `lua run.lua` there.

local here = string.match(arg and arg[0] or '', '^(.*)[/\\][^/\\]*$') or '.'
local monome = string.match(here, '^(.*)[/\\][^/\\]*$') or '.'

package.path = table.concat({
  here .. '/?.lua',
  monome .. '/drumgen/lib/?.lua',
  monome .. '/*/lib/?.lua',
  package.path,
}, ';')

local FILES = {
  'test_harness',
  'test_kit',
  'test_pattern',
  'test_store',
  'test_gen',
  'test_screen',
  'test_bridge',
}

local filter, update = nil, false
for i = 1, #(arg or {}) do
  local a = arg[i]
  if a == '--update-goldens' then
    update = true
  elseif string.sub(a, 1, 1) ~= '-' then
    filter = a
  end
end

local t = require 'harness'
t.goldens = update

print(string.format('monome tests - %s (%s)', _VERSION,
  (jit and jit.version) or 'plain lua'))

local load_failures = 0
for i = 1, #FILES do
  local name = FILES[i]
  if not filter or string.find(name, filter, 1, true) then
    local path = here .. '/' .. name .. '.lua'
    local chunk, err = loadfile(path)
    if not chunk then
      print(string.format('  FAIL  %s (load)', name))
      print('    ' .. tostring(err))
      load_failures = load_failures + 1
    else
      local ok, rerr = pcall(chunk)
      if not ok then
        print(string.format('  FAIL  %s (top level)', name))
        print('    ' .. string.gsub(tostring(rerr), '\n', '\n    '))
        load_failures = load_failures + 1
      end
    end
  end
end

t.run()
local failed = t.report() + load_failures
os.exit(failed == 0 and 0 or 1)