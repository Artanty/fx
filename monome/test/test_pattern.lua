-- monome/test/test_pattern.lua -- the editable grid.

local t = require 'harness'
local pattern = require 'pattern'

t.suite('pattern velocity', function()
  t.test('clamps to 0..127', function()
    t.eq(0, pattern.clamp_vel(0))
    t.eq(0, pattern.clamp_vel(-40))
    t.eq(127, pattern.clamp_vel(999))
    t.eq(100, pattern.clamp_vel(nil))          -- a plain grid tap
    t.eq(65, pattern.clamp_vel(64.6))
  end)

  t.test('rejects a non-number', function()
    t.raises(function() pattern.clamp_vel('loud') end, 'velocity must be a number')
  end)
end)

t.suite('pattern grid', function()
  t.test('new() defaults to an empty 10x16 bar', function()
    local p = pattern.new()
    t.eq(16, pattern.steps(p))
    t.eq(10, pattern.lanes(p))
    t.eq(0, pattern.count_hits(p))
    t.truthy(pattern.is_empty(p))
    t.eq(0, pattern.last_step(p))
  end)

  t.test('new() takes steps and lanes', function()
    local p = pattern.new{ steps = 32, lanes = 4 }
    t.eq(32, pattern.steps(p))
    t.eq(4, pattern.lanes(p))
  end)

  t.test('new() rejects impossible shapes', function()
    t.raises(function() pattern.new{ steps = 0 } end, 'out of range 1..64')
    t.raises(function() pattern.new{ steps = 65 } end, 'out of range 1..64')
    t.raises(function() pattern.new{ steps = 8.5 } end, 'whole number')
    t.raises(function() pattern.new{ lanes = 0 } end, 'lanes 0 out of range')
  end)

  t.test('set/get round-trips and reports what it stored', function()
    local p = pattern.new()
    t.eq(100, pattern.set(p, 3, 5, 100))
    t.eq(100, pattern.get(p, 3, 5))
    t.eq(127, pattern.set(p, 3, 5, 300))       -- capped, not wrapped
    t.eq(0, pattern.set(p, 3, 5, 0))           -- 0 clears
    t.eq(0, pattern.get(p, 3, 5))
  end)

  t.test('every cell starts isolated', function()
    local p = pattern.new()
    pattern.set(p, 1, 1, 90)
    t.eq(90, pattern.get(p, 1, 1))
    t.eq(0, pattern.get(p, 1, 2))
    t.eq(0, pattern.get(p, 2, 1))
  end)

  t.test('out-of-range lane or step raises rather than silently clipping', function()
    local p = pattern.new()
    t.raises(function() pattern.set(p, 0, 1, 90) end, 'lane 0 out of range 1..10')
    t.raises(function() pattern.set(p, 11, 1, 90) end, 'lane 11 out of range 1..10')
    t.raises(function() pattern.set(p, 1, 17, 90) end, 'step 17 out of range 1..16')
    t.raises(function() pattern.get(p, 1, 1.5) end, 'whole number')
  end)

  t.test('hit() toggles', function()
    local p = pattern.new()
    t.eq(100, pattern.hit(p, 2, 2))
    t.eq(100, pattern.get(p, 2, 2))
    t.eq(0, pattern.hit(p, 2, 2))
    t.eq(0, pattern.get(p, 2, 2))
    t.eq(80, pattern.hit(p, 2, 2, 80))         -- tap with an explicit velocity
    t.eq(80, pattern.get(p, 2, 2))
  end)

  t.test('clear empties one lane or the whole bar', function()
    local p = pattern.new()
    for l = 1, 4 do pattern.set(p, l, l, 90) end
    pattern.clear(p, 2)
    t.eq(0, pattern.get(p, 2, 2))
    t.eq(90, pattern.get(p, 1, 1))
    t.eq(90, pattern.get(p, 3, 3))
    pattern.clear(p)
    t.truthy(pattern.is_empty(p))
  end)

  t.test('clone() is deep', function()
    local p = pattern.new()
    pattern.set(p, 4, 7, 111)
    local q = pattern.clone(p)
    t.eq(111, pattern.get(q, 4, 7))
    pattern.set(q, 4, 7, 22)
    t.eq(111, pattern.get(p, 4, 7))            -- the original is untouched
    t.eq(16, pattern.steps(q))
  end)

  t.test('count_hits counts a lane or the bar', function()
    local p = pattern.new()
    pattern.set(p, 1, 1, 90)
    pattern.set(p, 1, 5, 90)
    pattern.set(p, 3, 5, 90)
    t.eq(2, pattern.count_hits(p, 1))
    t.eq(1, pattern.count_hits(p, 3))
    t.eq(0, pattern.count_hits(p, 2))
    t.eq(3, pattern.count_hits(p))
  end)

  t.test('steps_with_hits is sorted and can span lanes', function()
    local p = pattern.new()
    pattern.set(p, 1, 9, 90)
    pattern.set(p, 1, 3, 90)
    pattern.set(p, 5, 3, 90)
    t.deq({ 3, 9 }, pattern.steps_with_hits(p, 1))
    t.deq({ 3, 3, 9 }, pattern.steps_with_hits(p))
  end)

  t.test('last_step reports how far into the bar the music reaches', function()
    local p = pattern.new()
    t.eq(0, pattern.last_step(p))
    pattern.set(p, 7, 12, 90)
    t.eq(12, pattern.last_step(p))
  end)

  t.test('rotate wraps around the loop', function()
    local p = pattern.new()
    pattern.set(p, 1, 16, 90)
    pattern.rotate(p, 1)
    t.eq(0, pattern.get(p, 1, 16))
    t.eq(90, pattern.get(p, 1, 1))
    pattern.rotate(p, -1)
    t.eq(90, pattern.get(p, 1, 16))
    pattern.rotate(p, 0)                        -- no-op, not a wipe
    t.eq(90, pattern.get(p, 1, 16))
  end)

  t.test('to_rows/from_rows round-trips', function()
    local p = pattern.new{ steps = 16, lanes = 10 }
    pattern.set(p, 1, 1, 30)
    pattern.set(p, 10, 16, 127)
    local rows = pattern.to_rows(p)
    t.eq(10, #rows)          -- lanes
    t.eq(16, #rows[1])       -- steps within a lane
    t.eq(30, rows[1][1])
    local q = pattern.from_rows(rows)
    t.eq(30, pattern.get(q, 1, 1))
    t.eq(127, pattern.get(q, 10, 16))
    t.eq(0, pattern.get(q, 5, 8))
    t.eq(16, pattern.steps(q))
    t.eq(10, pattern.lanes(q))
  end)

  t.test('from_rows rejects malformed data', function()
    t.raises(function() pattern.from_rows({}) end, 'non-empty array')
    t.raises(function() pattern.from_rows({ {} }) end, 'steps 0 out of range')
    t.raises(function() pattern.from_rows({ { 1, 2, 3 }, { 1, 2 } }) end,
      'lane 2 has 2 cells, expected 3')
  end)
end)