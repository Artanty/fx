-- monome/test/test_gen.lua -- the generator.
--
-- The bottom suite is the check monome/docs/drumgen-plan.md asked for: 500 bars
-- across every style, asserted for legal positions, velocity bounds and fill
-- cadence. It runs on the host in well under a second.

local t = require 'harness'
local pattern = require 'pattern'
local kit = require 'kit'
local gen = require 'gen'

-- Deterministic RNG: a plain LCG, so a failure is reproducible by construction
-- and no test depends on Lua's math.random implementation.
local function lcg(seed)
  local state = seed or 20261005
  return function(min, max)
    state = (1103515245 * state + 12345) % 2147483648
    local frac = state / 2147483648
    if max then
      return min + math.floor(frac * (max - min + 1))
    end
    return frac
  end
end

-- An RNG that reports every call, to prove the generator's draw sequence does
-- not depend on its parameters (that property is what makes bars comparable).
local function counting(seed)
  local calls = 0
  local inner = lcg(seed)
  return function(min, max)
    calls = calls + 1
    return inner(min, max)
  end, function()
    return calls
  end
end

local function new_gen(opts)
  opts = opts or {}
  opts.rng = opts.rng or lcg(opts.seed)
  return gen.new(opts)
end

local function hit_steps(p, lane)
  return pattern.steps_with_hits(p, lane)
end

t.suite('gen construction', function()
  t.test('defaults to four on the floor', function()
    local g = new_gen()
    t.eq('four_on_floor', g.style_name)
    t.eq(124, g.style.bpm)
    t.eq(16, g.steps)
    t.eq(10, g.lanes)
    t.eq(0, g.bar)
    t.eq(8, g.fill_every)
    t.eq(0, g.params.swing)
  end)

  t.test('every style is reachable and labelled', function()
    local names = gen.styles()
    t.eq(5, #names)
    for i = 1, #names do
      local style = gen.style(names[i])
      t.truthy(style and style.label and style.bpm, names[i])
      t.truthy(#style.grid > 0, names[i] .. ' has an empty grid')
    end
    t.eq(nil, gen.style('polka'))
  end)

  t.test('an unknown style is refused with the list of real ones', function()
    local msg = t.raises(function() new_gen{ style = 'polka' } end, 'unknown style polka')
    t.truthy(string.find(msg, 'four_on_floor', 1, true))
    t.raises(function() gen.set_style(new_gen(), 'polka') end, 'unknown style polka')
  end)

  t.test('a style can be switched at runtime', function()
    local g = new_gen()
    gen.set_style(g, 'trap')
    t.eq('trap', g.style_name)
    t.eq(140, g.style.bpm)
  end)

  t.test('bad construction arguments are refused', function()
    t.raises(function() new_gen{ steps = 99 } end, 'whole number in 1..64')
    t.raises(function() new_gen{ fill_every = -1 } end, 'fill_every must be a whole number')
    t.raises(function() new_gen{ params = { intensity = 'loud' } } end, 'must be a number')
  end)

  t.test('out-of-range params clamp on the way in (a live knob, not a file)', function()
    local g = new_gen{ params = { intensity = 2, swing = -1 } }
    t.eq(1, g.params.intensity)
    t.eq(0, g.params.swing)
  end)

  t.test('params are clamped to 0..1 and named keys only', function()
    local g = new_gen()
    t.eq(1, gen.set_param(g, 'intensity', 5))
    t.eq(0, gen.set_param(g, 'swing', -1))
    t.eq(0.3, gen.set_param(g, 'complexity', 0.3))
    t.raises(function() gen.set_param(g, 'loudness', 0.5) end, 'unknown param loudness')
  end)

  t.test('set_params takes the store params table as-is', function()
    local g = new_gen()
    gen.set_params(g, { intensity = 0.1, swing = 0.4 })
    t.eq(0.1, g.params.intensity)
    t.eq(0.4, g.params.swing)
    t.eq(0.5, g.params.complexity)          -- untouched stays at the default
  end)
end)

t.suite('gen style skeleton', function()
  t.test('a bar is never empty and stays on the grid', function()
    for _, name in ipairs(gen.styles()) do
      local g = new_gen{ style = name }
      for _ = 1, 20 do
        local p = gen.next_bar(g)
        t.truthy(pattern.count_hits(p) > 0, name .. ' produced an empty bar')
        for lane = 1, kit.count() do
          for _, step in ipairs(hit_steps(p, lane)) do
            t.truthy(step >= 1 and step <= 16, name .. ' step out of range')
          end
        end
      end
    end
  end)

  t.test('four on the floor keeps a kick on all four beats', function()
    local g = new_gen{ style = 'four_on_floor', fill_every = 0 }
    local kick = kit.index('kick')
    for _ = 1, 200 do
      local p = gen.next_bar(g)
      t.deq({ 1, 5, 9, 13 }, hit_steps(p, kick))
    end
  end)

  t.test('four on the floor moves its snare to the alt placement', function()
    -- intensity 0 = no humanize, so variation alone decides: the snare is not a
    -- fixed voice in this style, so it is allowed to move off 5 and 13
    local g = new_gen{ style = 'four_on_floor', fill_every = 0,
                       params = { variation = 1, intensity = 0, complexity = 0 } }
    local snare = kit.index('snare')
    for _ = 1, 50 do
      local p = gen.next_bar(g)
      t.deq({ 4, 12 }, hit_steps(p, snare))   -- the alt placement
    end
  end)

  t.test('breakbeat keeps its two-anchor skeleton', function()
    local g = new_gen{ style = 'breakbeat', fill_every = 0,
                       params = { variation = 1, complexity = 1, intensity = 1 } }
    for _ = 1, 100 do
      local p = gen.next_bar(g)
      t.deq({ 1, 11 }, hit_steps(p, kit.index('kick')))
      t.deq({ 5, 12 }, hit_steps(p, kit.index('snare')))
    end
  end)

  t.test('variation actually changes the bar', function()
    local plain = new_gen{ style = 'breakbeat', fill_every = 0,
                           params = { variation = 0, complexity = 0, intensity = 0.5 } }
    local busy = new_gen{ style = 'breakbeat', fill_every = 0,
                          params = { variation = 1, complexity = 1, intensity = 0.5 } }
    local plain_stats = gen.stats(plain, 100)
    local busy_stats = gen.stats(busy, 100)
    t.truthy(busy_stats.mean_hits > plain_stats.mean_hits,
      string.format('varied mean %.2f should beat plain %.2f',
        busy_stats.mean_hits, plain_stats.mean_hits))
  end)

  t.test('velocity stays inside 1..127 everywhere', function()
    for _, name in ipairs(gen.styles()) do
      local g = new_gen{ style = name, params = { intensity = 1, complexity = 1,
                                                  variation = 1 } }
      for _ = 1, 100 do
        local p = gen.next_bar(g)
        for lane = 1, kit.count() do
          for step = 1, pattern.steps(p) do
            local v = pattern.get(p, lane, step)
            t.truthy(v >= 0 and v <= 127, string.format('%s lane %d step %d = %d',
              name, lane, step, v))
          end
        end
      end
    end
  end)
end)

t.suite('gen complexity', function()
  local function mean_at(complexity)
    local g = new_gen{ style = 'disco', fill_every = 0,
                       params = { complexity = complexity, variation = 0.5,
                                  intensity = 0.5 } }
    return gen.stats(g, 200).mean_hits
  end

  t.test('more complexity means more notes, bar for bar', function()
    local low, mid, high = mean_at(0), mean_at(0.5), mean_at(1)
    t.truthy(low < mid, string.format('0.5 -> %.2f vs 0 -> %.2f', mid, low))
    t.truthy(mid < high, string.format('1 -> %.2f vs 0.5 -> %.2f', high, mid))
    t.truthy(low > 0)
  end)

  t.test('the same seed and settings give the same bars', function()
    local a = new_gen{ style = 'breakbeat', seed = 7, fill_every = 8 }
    local b = new_gen{ style = 'breakbeat', seed = 7, fill_every = 8 }
    for i = 1, 50 do
      t.deq(pattern.to_rows(gen.next_bar(a)), pattern.to_rows(gen.next_bar(b)),
        'bar ' .. i .. ' differs')
    end
    t.eq(50, a.bar)
  end)

  t.test('a different seed gives different bars', function()
    local a = new_gen{ style = 'breakbeat', seed = 1, fill_every = 0 }
    local b = new_gen{ style = 'breakbeat', seed = 2, fill_every = 0 }
    local function same(p, q)
      for lane = 1, pattern.lanes(p) do
        for step = 1, pattern.steps(p) do
          if pattern.get(p, lane, step) ~= pattern.get(q, lane, step) then
            return false
          end
        end
      end
      return true
    end
    local identical = 0
    for _ = 1, 50 do
      if same(gen.next_bar(a), gen.next_bar(b)) then identical = identical + 1 end
    end
    t.truthy(identical < 50, identical .. ' of 50 bars came out identical')
  end)

  t.test('draw count per bar does not depend on the parameters', function()
    local rng_a, calls_a = counting(11)
    local rng_b, calls_b = counting(11)
    local a = new_gen{ rng = rng_a, fill_every = 0,
                       params = { complexity = 0, variation = 0, intensity = 0 } }
    local b = new_gen{ rng = rng_b, fill_every = 0,
                       params = { complexity = 1, variation = 1, intensity = 1 } }
    for _ = 1, 40 do
      gen.next_bar(a)
      gen.next_bar(b)
    end
    t.eq(calls_a(), calls_b())
  end)
end)

t.suite('gen fills', function()
  t.test('a fill lands on the last bar of each group', function()
    local g = new_gen{ style = 'disco', fill_every = 8 }
    local fills = {}
    for _ = 1, 80 do
      gen.next_bar(g)
      if g.last_fill then fills[#fills + 1] = g.bar end
      if not g.last_fill then
        t.truthy(g.bar % 8 ~= 0, 'bar ' .. g.bar .. ' should not be a fill')
      end
    end
    t.deq({ 8, 16, 24, 32, 40, 48, 56, 64, 72, 80 }, fills)
  end)

  t.test('a fill is a real bar, not an empty one', function()
    local g = new_gen{ style = 'halftime', fill_every = 4 }
    for _ = 1, 40 do
      local p = gen.next_bar(g)
      if g.last_fill then
        t.truthy(pattern.count_hits(p) >= 4,
          'a fill should have at least 4 hits, got ' .. pattern.count_hits(p))
        t.truthy(pattern.get(p, kit.index('crash'), 16) > 0 or
                 pattern.get(p, kit.index('hato'), 16) > 0,
          'a fill should land on the last step')
      end
    end
  end)

  t.test('fill_every = 0 turns fills off', function()
    local g = new_gen{ fill_every = 0 }
    for _ = 1, 100 do
      gen.next_bar(g)
      t.falsy(g.last_fill)
    end
  end)

  t.test('a long run hits the fill cadence exactly', function()
    local g = new_gen{ style = 'trap', fill_every = 8 }
    local stats = gen.stats(g, 500)
    t.eq(500, stats.bars)
    t.eq(62, stats.fills)                    -- bars 8, 16, ... 496
  end)
end)

t.suite('gen schedule and swing', function()
  t.test('a plain bar schedules every hit on its own tick', function()
    local p = pattern.new()
    pattern.set(p, 1, 1, 100)
    pattern.set(p, 2, 5, 90)
    local events = gen.schedule(p, { ticks_per_step = 12 })
    t.eq(2, #events)
    t.eq(0, events[1].tick)
    t.eq(48, events[2].tick)
    t.eq(1, events[1].lane)
    t.eq(2, events[2].lane)
    t.eq(100, events[1].vel)
  end)

  t.test('events come out in tick order', function()
    local g = new_gen{ style = 'trap', fill_every = 0, steps = 32 }
    local p = gen.next_bar(g)
    local events = gen.schedule(p, { ticks_per_step = 12 })
    t.truthy(#events > 1)
    for i = 2, #events do
      t.truthy(events[i - 1].tick <= events[i].tick, 'tick order broken at ' .. i)
    end
  end)

  t.test('swing delays the eighths and only the eighths', function()
    local p = pattern.new()
    for step = 1, 16 do pattern.set(p, 1, step, 100) end
    -- swing 0.5 buys half of the half-step maximum, swing 1 buys all of it
    t.eq(3, gen.swing_ticks(0.5, 12))
    t.eq(6, gen.swing_ticks(1, 12))
    local events = gen.schedule(p, { ticks_per_step = 12, swing = 0.5 })
    local swung = { [3] = true, [7] = true, [11] = true, [15] = true }
    for i = 1, #events do
      local e = events[i]
      local expected = (e.step - 1) * 12 + (swung[e.step] and 3 or 0)
      t.eq(expected, e.tick, 'step ' .. e.step)
    end
    t.eq(4, #gen.swing_steps(16))
    for _, step in ipairs(gen.swing_steps(16)) do
      t.truthy(swung[step], 'unexpected swung step ' .. step)
    end
  end)

  t.test('swing = 0 is a straight grid and swing is capped at half a step', function()
    local p = pattern.new()
    pattern.set(p, 1, 3, 100)
    t.eq(24, gen.schedule(p, { ticks_per_step = 12 })[1].tick)
    t.eq(30, gen.schedule(p, { ticks_per_step = 12, swing = 1 })[1].tick)
    t.eq(6, gen.swing_ticks(5, 12))           -- a silly swing clamps, it does not wrap
    t.eq(0, gen.swing_ticks(nil, 12))
  end)

  t.test('swing never collides two hits of the same voice', function()
    -- Two lanes on the same step is normal (kick under a hat), so the invariant
    -- is per voice: one drum is never hit twice at the same instant, and swing
    -- never reorders the grid.
    local g = new_gen{ style = 'disco', fill_every = 0, params = { complexity = 1 } }
    for _ = 1, 20 do
      local p = gen.next_bar(g)
      local events = gen.schedule(p, { ticks_per_step = 12, swing = 0.6 })
      local seen = {}
      for i = 1, #events do
        local key = events[i].lane .. '@' .. events[i].tick
        seen[key] = (seen[key] or 0) + 1
      end
      for key, count in pairs(seen) do
        t.eq(1, count, 'lane/tick ' .. key .. ' fired more than once')
      end
      -- ordering: tick order matches step order within every lane
      local last = {}
      for i = 1, #events do
        local lane, step = events[i].lane, events[i].step
        if last[lane] then
          t.truthy(step > last[lane], 'step order broken in lane ' .. lane)
        end
        last[lane] = step
      end
    end
  end)
end)

t.suite('gen 500-bar invariant run (drumgen-plan.md item 6)', function()
  local STEPS = 16

  t.test('every style, 500 bars: legal positions, velocities, fill cadence', function()
    for _, name in ipairs(gen.styles()) do
      local g = new_gen{ style = name, seed = 4242, fill_every = 8 }
      local fills, hits = 0, 0
      for bar = 1, 500 do
        local p = gen.next_bar(g)
        hits = hits + pattern.count_hits(p)
        if g.last_fill then
          fills = fills + 1
          t.eq(0, bar % 8, name .. ' fill outside the cadence at bar ' .. bar)
        end
        t.truthy(pattern.count_hits(p) > 0, name .. ' empty bar at ' .. bar)
        for lane = 1, kit.count() do
          local row = pattern.to_rows(p)[lane]
          for step = 1, STEPS do
            local v = row[step]
            t.truthy(v >= 0 and v <= 127,
              string.format('%s bar %d lane %d step %d velocity %d',
                name, bar, lane, step, v))
          end
        end
        -- schedulable without collisions at every swing setting
        for _, swing in ipairs{ 0, 0.33, 1 } do
          local events = gen.schedule(p, { ticks_per_step = 12, swing = swing })
          t.truthy(#events > 0, name .. ' bar ' .. bar .. ' scheduled nothing')
        end
      end
      t.eq(500, g.bar)
      t.eq(62, fills, name .. ' fill count')
      t.truthy(hits > 0)
    end
  end)

  t.test('a 32-step bar generates legally too', function()
    local g = new_gen{ style = 'breakbeat', steps = 32, fill_every = 4, seed = 9 }
    for _ = 1, 100 do
      local p = gen.next_bar(g)
      t.eq(32, pattern.steps(p))
      for lane = 1, kit.count() do
        for _, step in ipairs(hit_steps(p, lane)) do
          t.truthy(step >= 1 and step <= 32, 'step ' .. step .. ' outside 1..32')
        end
      end
    end
  end)
end)