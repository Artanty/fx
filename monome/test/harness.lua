-- monome/test/harness.lua -- minimal zero-dependency test harness for the
-- norns scripts.
--
-- Lua 5.1 stdlib only, so the identical file runs under luajit on the host and
-- under plain `lua` on the device. No luarocks, no busted: the whole thing is
-- small enough to trust on a machine that cannot install anything.
--
-- Style:
--   local t = require 'harness'
--   t.suite('pattern grid', function()
--     t.test('clamps velocity', function()
--       t.eq(127, pattern.set(p, 1, 1, 999))
--     end)
--   end)
--
-- A failing assertion raises a table tagged __t_fail, so a real error inside a
-- test (a typo, a nil index) is never mistaken for a failed expectation: the
-- runner prints it with a traceback instead.

local M = {}

M.suites = {}
M.results = { suites = 0, tests = 0, passed = 0, failed = 0 }
M.failures = {}
M.goldens = false          -- set by run.lua for --update-goldens

local stack = {}

--------------------------------------------------------------------------------
-- value formatting (failure messages only)
--------------------------------------------------------------------------------

local function fmt(v)
  local t = type(v)
  if t == 'string' then return string.format('%q', v) end
  if t == 'number' then
    if v ~= v then return 'nan' end
    if v == math.floor(v) and v < 1e15 and v > -1e15 then return string.format('%d', v) end
    return string.format('%.10g', v)
  end
  return tostring(v)
end

local function dump(v, depth)
  depth = depth or 0
  local t = type(v)
  if t == 'table' then
    if depth > 4 then return '{...}' end
    local keys = {}
    for k in pairs(v) do keys[#keys + 1] = k end
    table.sort(keys, function(a, b) return tostring(a) < tostring(b) end)
    local out = {}
    for i = 1, #keys do
      local k = keys[i]
      if type(k) == 'number' and k == math.floor(k) then
        out[#out + 1] = dump(v[k], depth + 1)
      else
        out[#out + 1] = tostring(k) .. '=' .. dump(v[k], depth + 1)
      end
    end
    return '{' .. table.concat(out, ',') .. '}'
  end
  return fmt(v)
end

M.dump = dump

local function suffix(why)
  return why and (' (' .. why .. ')') or ''
end

local function fail(msg)
  error({ __t_fail = true, msg = msg }, 0)
end

local function is_fail(err)
  return type(err) == 'table' and err.__t_fail == true
end

--------------------------------------------------------------------------------
-- assertions
--------------------------------------------------------------------------------

function M.eq(expected, actual, nt)
  if expected == actual then return actual end
  fail('expected ' .. fmt(expected) .. ', got ' .. fmt(actual) .. suffix(nt))
end

function M.near(expected, actual, tol, nt)
  tol = tol or 1e-9
  if type(actual) == 'number' and math.abs(expected - actual) <= tol then return actual end
  fail('expected ' .. fmt(expected) .. ' +/- ' .. fmt(tol) ..
       ', got ' .. fmt(actual) .. suffix(nt))
end

function M.truthy(v, nt)
  if v then return v end
  fail('expected a truthy value, got ' .. dump(v) .. suffix(nt))
end

function M.falsy(v, nt)
  if not v then return v end
  fail('expected a falsy value, got ' .. dump(v) .. suffix(nt))
end

local function deq(a, b, path, seen)
  if a == b then return true end
  if type(a) ~= 'table' or type(b) ~= 'table' then return false end
  seen = seen or {}
  if seen[a] and seen[a][b] then return true end       -- cycle guard
  seen[a] = seen[a] or {}
  seen[a][b] = true
  for k, v in pairs(a) do
    if not deq(v, b[k], path .. '.' .. tostring(k), seen) then return false end
  end
  for k in pairs(b) do
    if a[k] == nil then return false end
  end
  return true
end

function M.deq(expected, actual, nt)
  if deq(expected, actual, '') then return actual end
  fail('tables differ' .. suffix(nt) ..
       '\n         expected ' .. dump(expected) ..
       '\n         actual   ' .. dump(actual))
end

-- Assert that fn raises, and that the message contains `needle` (plain find,
-- not a Lua pattern, so test code needs no escaping). Returns the message.
function M.raises(fn, needle, nt)
  local ok, err = pcall(fn)
  if ok then
    fail('expected an error' .. suffix(nt) ..
         (needle and (' containing ' .. fmt(needle)) or ''))
  end
  local msg = is_fail(err) and err.msg or tostring(err)
  if needle and not string.find(msg, needle, 1, true) then
    fail('error ' .. fmt(msg) .. ' does not contain ' .. fmt(needle) .. suffix(nt))
  end
  return msg
end

--------------------------------------------------------------------------------
-- snapshots (golden files, for anything too big to assert inline)
--------------------------------------------------------------------------------

local function this_dir()
  local src = debug.getinfo(1, 'S').source
  if string.sub(src, 1, 1) == '@' then src = string.sub(src, 2) end
  return string.match(src, '^(.*)[/\\][^/\\]*$') or '.'
end

local function read_file(path)
  local f = io.open(path, 'rb')
  if not f then return nil end
  local s = f:read('*a')
  f:close()
  return s
end

local function write_file(path, s)
  local f = io.open(path, 'wb')
  if not f then
    -- golden/ is the only directory the harness creates; both the host and the
    -- norns have a shell, and the write is retried once it exists.
    os.execute('mkdir -p ' .. string.match(path, '^(.*)[/\\][^/\\]*$'))
    f = io.open(path, 'wb')
  end
  assert(f, 'cannot write ' .. path)
  f:write(s)
  f:close()
end

local function split_lines(s)
  local out = {}
  for line in string.gmatch(s .. '\n', '([^\n]*)\n') do out[#out + 1] = line end
  if string.sub(s, -1) == '\n' then table.remove(out) end
  return out
end

-- Compare text against monome/test/golden/<label>.txt, writing it when
-- M.goldens is set (run.lua --update-goldens). Review the diff before committing.
function M.snapshot(label, text)
  local path = this_dir() .. '/golden/' .. label .. '.txt'
  if M.goldens then
    write_file(path, text)
    return text
  end
  local golden = read_file(path)
  if not golden then
    fail('no golden file for ' .. label .. ' (' .. path ..
         ') - regenerate with --update-goldens and read the diff')
  end
  if golden == text then return text end
  local a, b = split_lines(golden), split_lines(text)
  local report = { label .. ': golden output differs' }
  local shown = 0
  for i = 1, math.max(#a, #b) do
    if a[i] ~= b[i] then
      shown = shown + 1
      if shown > 8 then
        report[#report + 1] = '  ... more lines differ'
        break
      end
      report[#report + 1] = string.format('  line %d\n    golden: %s\n    actual: %s',
        i, fmt(a[i]), fmt(b[i]))
    end
  end
  fail(table.concat(report, '\n'))
end

--------------------------------------------------------------------------------
-- registration + runner
--------------------------------------------------------------------------------

function M.suite(name, body)
  local s = { name = name, tests = {}, before = nil }
  stack[#stack + 1] = s
  local ok, err = pcall(body)
  stack[#stack] = nil
  if not ok then
    -- a broken suite body still has to show up as a failure
    s.tests[#s.tests + 1] = { name = '(suite body raised)', fn = function() error(err, 0) end }
  end
  M.suites[#M.suites + 1] = s
end

function M.test(name, fn)
  assert(#stack > 0, 'test("' .. name .. '") called outside suite()')
  local s = stack[#stack]
  s.tests[#s.tests + 1] = { name = name, fn = fn }
end

function M.before_each(fn)
  assert(#stack > 0, 'before_each() called outside suite()')
  stack[#stack].before = fn
end

local function record(suite, test, err)
  M.failures[#M.failures + 1] = { suite = suite, test = test, err = err }
end

-- Runs a suite list, prints the report, returns the failure count. Exposed for
-- the harness self-test, which runs a deliberately failing suite of its own.
function M.run(list)
  list = list or M.suites
  local r = M.results
  for i = 1, #list do
    local s = list[i]
    if #s.tests > 0 then r.suites = r.suites + 1 end
    if #s.tests > 0 then print(s.name) end
    for j = 1, #s.tests do
      local t = s.tests[j]
      r.tests = r.tests + 1
      local ok, err = true, nil
      if s.before then ok, err = pcall(s.before) end
      if ok then ok, err = pcall(t.fn) end
      if ok then
        r.passed = r.passed + 1
        print('  ok    ' .. t.name)
      else
        r.failed = r.failed + 1
        print('  FAIL  ' .. t.name)
        record(s.name, t.name, err)
      end
    end
  end
  return r.failed
end

-- Print collected failures with detail. Call after M.run().
function M.report()
  local r = M.results
  if r.failed > 0 then
    print('')
    print('failures:')
    for i = 1, #M.failures do
      local f = M.failures[i]
      local err = f.err
      if is_fail(err) then
        print(string.format('  %s / %s', f.suite, f.test))
        print('    ' .. string.gsub(err.msg, '\n', '\n    '))
      else
        print(string.format('  %s / %s  (error, not an assertion)', f.suite, f.test))
        print('    ' .. string.gsub(debug.traceback(tostring(err), 2), '\n', '\n    '))
      end
    end
  end
  print('')
  print(string.format('%d suites, %d tests, %d ok, %d failed',
    r.suites, r.tests, r.passed, r.failed))
  return r.failed
end

return M