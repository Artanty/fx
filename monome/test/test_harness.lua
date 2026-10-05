-- monome/test/test_harness.lua -- the harness tests itself, so a green run means
-- something: a broken assertion can never silently pass.

local t = require 'harness'

t.suite('harness assertions', function()
  t.test('eq accepts equal values and returns the actual', function()
    t.eq(3, 3)
    t.eq('x', 'x')
    t.eq(nil, nil)
    t.eq(1, 1.0)                     -- int/float is not a mismatch in Lua
    t.eq(3, (t.eq(3, 3)))
  end)

  t.test('eq rejects a mismatch with both values in the message', function()
    local msg = t.raises(function() t.eq(1, 2) end, 'expected 1, got 2')
    t.truthy(string.find(msg, 'expected 1, got 2', 1, true))
  end)

  t.test('eq distinguishes types', function()
    t.raises(function() t.eq(1, '1') end, 'expected 1, got "1"')
  end)

  t.test('near honours the tolerance', function()
    t.near(1.0, 1.0000001, 1e-6)
    t.near(0.3, 0.1 + 0.2, 1e-9)
    t.raises(function() t.near(1.0, 1.1, 0.01) end, 'expected 1 +/- 0.01, got 1.1')
  end)

  t.test('truthy/falsy catch both directions', function()
    t.truthy(1)
    t.truthy('false')                -- a non-empty string is truthy in Lua
    t.falsy(nil)
    t.falsy(false)
    t.raises(function() t.truthy(nil) end, 'expected a truthy value, got nil')
    t.raises(function() t.falsy(0) end, 'expected a falsy value, got 0')
  end)

  t.test('deq compares nested tables by value', function()
    t.deq({ 1, 2, { 3, 4 } }, { 1, 2, { 3, 4 } })
    t.deq({ a = 1, b = { c = 2 } }, { b = { c = 2 }, a = 1 })
    t.raises(function() t.deq({ 1, 2 }, { 1, 3 }) end, 'tables differ')
    t.raises(function() t.deq({ a = 1 }, { a = 1, b = 2 }) end, 'tables differ')
  end)

  t.test('deq survives a self-referencing table', function()
    local a = { 1 }
    a.self = a
    local b = { 1 }
    b.self = b
    t.deq(a, b)
  end)

  t.test('raises matches plain substrings, not Lua patterns', function()
    t.raises(function() error('a (b) c') end, 'a (b) c')
    t.raises(function() error('val 42') end, '42')
    t.raises(function() t.raises(function() error('boom') end, 'nope') end,
      'does not contain "nope"')
  end)

  t.test('raises reports a missing error', function()
    t.raises(function() t.raises(function() return 1 end, 'boom') end,
      'expected an error containing "boom"')
  end)

  t.test('an assertion inside a pcall still reads as an assertion', function()
    local ok, err = pcall(function() t.eq(1, 2) end)
    t.falsy(ok)
    t.eq('table', type(err))
    t.eq(true, err.__t_fail)
  end)
end)

t.suite('harness runner', function()
  -- Both runner tests run a scratch suite and swap in a private results table:
  -- suites register while the test file loads, but run() only executes them at
  -- the end, so t.results is still the live one here and must not be appended to.
  local function run_scratch(suite)
    local saved_results, saved_failures = t.results, t.failures
    local real_print = print
    local lines = {}
    -- capturing stdout is the whole point here, so shadowing print on purpose
    -- luacheck: push ignore 121
    print = function(...)
      local parts = {}
      for i = 1, select('#', ...) do parts[#parts + 1] = tostring((select(i, ...))) end
      lines[#lines + 1] = table.concat(parts, ' ')
    end
    t.results = { suites = 0, tests = 0, passed = 0, failed = 0 }
    t.failures = {}
    local failed = t.run({ suite })
    print = real_print
    -- luacheck: pop
    local counted = { tests = t.results.tests, passed = t.results.passed,
                      failed = t.results.failed, recorded = #t.failures }
    t.results, t.failures = saved_results, saved_failures
    return failed, counted, table.concat(lines, '\n')
  end

  t.test('run() counts passes and failures, and isolates its counters', function()
    local scratch = {
      name = 'scratch', tests = {
        { name = 'passes', fn = function() return true end },
        { name = 'fails an assertion', fn = function() t.eq(1, 2) end },
        { name = 'raises a real error', fn = function() error('kaboom') end },
      },
    }
    local failed, counted, out = run_scratch(scratch)

    t.eq(3, counted.tests)
    t.eq(1, counted.passed)
    t.eq(2, counted.failed)
    t.eq(2, failed)
    t.eq(2, counted.recorded)
    t.truthy(string.find(out, 'FAIL  fails an assertion', 1, true))
    t.truthy(string.find(out, 'ok    passes', 1, true))
  end)

  t.test('a real error is not reported as a failed assertion', function()
    local failed, _, out = run_scratch({
      name = 'errs', tests = { { name = 'raises', fn = function() error('kaboom') end } },
    })
    t.eq(1, failed)
    t.truthy(string.find(out, 'FAIL  raises', 1, true))
  end)

  t.test('before_each runs before every test', function()
    local n = 0
    local scratch = {
      name = 'hooks', before = function() n = n + 1 end,
      tests = {
        { name = 'one', fn = function() t.eq(1, n) end },
        { name = 'two', fn = function() t.eq(2, n) end },
      },
    }
    local failed = run_scratch(scratch)
    t.eq(0, failed)
  end)

  t.test('a broken suite body is reported, not swallowed', function()
    local at = #t.suites                 -- keep the broken suite out of the real run
    t.suite('broken', function() error('body exploded') end)
    local scratch = t.suites[at + 1]
    t.suites[at + 1] = nil
    local failed = run_scratch(scratch)
    t.eq(1, failed)
  end)
end)

t.suite('harness snapshots', function()
  t.test('update writes a golden file, compare accepts it, drift fails', function()
    local label = 'harness_scratch'
    local path = 'golden/' .. label .. '.txt'
    local saved = t.goldens
    t.goldens = true
    t.snapshot(label, 'line one\nline two\n')      -- creates golden/harness_scratch.txt
    t.goldens = false
    t.snapshot(label, 'line one\nline two\n')      -- identical -> passes

    local msg = t.raises(function() t.snapshot(label, 'line one\nline CHANGED\n') end,
      'golden output differs')
    t.truthy(string.find(msg, 'line CHANGED', 1, true))

    local missing = t.raises(function() t.snapshot('harness_no_such_golden', 'x') end,
      'no golden file')
    t.truthy(string.find(missing, '--update-goldens', 1, true))

    os.remove(path)
    t.goldens = saved
  end)
end)