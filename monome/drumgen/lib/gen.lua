-- monome/drumgen/lib/gen.lua -- the generator: style skeleton + variation.
--
-- Pure Lua 5.1, no norns globals, and no math.random of its own: the RNG is
-- injected (gen.new{rng=...}, defaulting to math.random). That is what makes a
-- 500-bar run reproducible on the host, so the tests can assert on the music
-- instead of only checking that nothing threw.
--
-- How a bar is built:
--   * the style's SKELETON positions always play - that is the style
--   * `variation` optionally swaps in an alternative placement for a voice
--   * `complexity` sprinkles extra notes (16th rolls, ghost rim, shaker 16ths)
--   * `intensity` scales velocities and widens the humanize window
--   * `swing` is NOT stored in the grid: gen.schedule() emits tick offsets so
--     the clock can swing the eighths without rewriting the bar
--   * every `fill_every` bars the whole bar becomes a fill instead
--
-- Voices marked `fixed` are the identity of their style (the kick on all four
-- beats of a four-on-the-floor, the snare on 5 and 13 of a breakbeat). They are
-- never varied and never humanized, which is what lets the tests assert a style
-- invariant that survives every parameter setting.

local pattern = require 'pattern'
local kit = require 'kit'

local gen = {}

-- beatclock fires 24 ticks per quarter note, so one 16th at ticks_per_step=12
-- is 10 ms at 120 bpm: enough resolution for a 3-tick swing and +/-1-tick
-- humanize without the UI having to think in milliseconds.
gen.TICKS_PER_STEP = 12
gen.DEFAULT_FILL_EVERY = 8
gen.PARAM_KEYS = { 'intensity', 'complexity', 'variation', 'swing' }

-- `steps` are 1-based within a 16-step bar: beats are 1, 5, 9, 13.
local STYLES = {
  ['four_on_floor'] = {
    label = 'Four on the floor',
    bpm = 124,
    grid = {
      { role = 'kick', steps = { 1, 5, 9, 13 }, vel = 112, fixed = true },
      { role = 'snare', steps = { 5, 13 }, vel = 104, alt = { 4, 12 } },
      { role = 'hatc', steps = { 1, 3, 5, 7, 9, 11, 13, 15 }, vel = 72,
        alt = { 3, 7, 11, 15 }, alt_vel = 78 },
      { role = 'hato', steps = { 15 }, vel = 92, alt = { 7, 15 } },
      { role = 'shak', steps = { 3, 7, 11, 15 }, vel = 46 },
    },
  },
  ['breakbeat'] = {
    label = 'Breakbeat',
    bpm = 172,
    grid = {
      { role = 'kick', steps = { 1, 11 }, vel = 110, fixed = true },
      { role = 'snare', steps = { 5, 12 }, vel = 104, fixed = true },
      { role = 'rim', steps = { 15 }, vel = 64, alt = { 7, 15 } },
      { role = 'hatc', steps = { 2, 4, 6, 8, 10, 12, 14, 16 }, vel = 70,
        alt = { 4, 8, 12, 16 } },
      { role = 'ride', steps = { 6, 13 }, vel = 58 },
    },
  },
  ['halftime'] = {
    label = 'Half time',
    bpm = 86,
    grid = {
      { role = 'kick', steps = { 1, 11 }, vel = 110, fixed = true },
      { role = 'snare', steps = { 9 }, vel = 106, fixed = true },
      { role = 'hatc', steps = { 2, 6, 10, 14 }, vel = 74, alt = { 2, 6, 10, 14, 15 } },
      { role = 'shak', steps = { 4, 12 }, vel = 48 },
      { role = 'ride', steps = { 7 }, vel = 52 },
    },
  },
  ['trap'] = {
    label = 'Trap',
    bpm = 140,
    grid = {
      { role = 'kick', steps = { 1, 7, 11 }, vel = 108, fixed = true },
      { role = 'snare', steps = { 5, 13 }, vel = 104, fixed = true },
      { role = 'hatc', steps = { 2, 6, 10, 14 }, vel = 76, alt = { 2, 6, 10, 14, 15 } },
      { role = 'ride', steps = { 4, 12 }, vel = 56 },
      { role = 'rim', steps = { 15 }, vel = 40 },
    },
  },
  ['disco'] = {
    label = 'Disco',
    bpm = 118,
    grid = {
      { role = 'kick', steps = { 1, 5, 9, 13 }, vel = 110, fixed = true },
      { role = 'snare', steps = { 5, 13 }, vel = 100, alt = { 5, 12 } },
      { role = 'hatc', steps = { 1, 3, 5, 7, 9, 11, 13, 15 }, vel = 68 },
      { role = 'hato', steps = { 3, 7, 11, 15 }, vel = 88, alt = { 15 } },
      { role = 'shak', steps = { 2, 6, 10, 14 }, vel = 44 },
    },
  },
}

-- Extra notes added by `complexity`. weight scales how eagerly each one appears;
-- a step is only used when its cell is still empty, so extras never double up
-- with the skeleton.
local EXTRAS = {
  { role = 'hatc', steps = { 4, 8, 12, 16 }, vel = 44, weight = 1.0 },
  { role = 'shak', steps = { 2, 6, 10, 14 }, vel = 34, weight = 0.7 },
  { role = 'rim', steps = { 7, 10, 14 }, vel = 38, weight = 0.6 },
}

local function default_rng(min, max)
  if max then return math.random(min, max) end
  return math.random()
end

local function clamp01(v, name)
  if type(v) ~= 'number' or v ~= v then
    error('gen: ' .. name .. ' must be a number, got ' .. type(v))
  end
  if v < 0 then return 0 end
  if v > 1 then return 1 end
  return v
end

local function style_names()
  local out = {}
  for name in pairs(STYLES) do out[#out + 1] = name end
  table.sort(out)
  return out
end

gen.styles = style_names

function gen.style(name)
  return STYLES[name]
end

-- new{style=, steps=, rng=, fill_every=, params=} -> generator state.
-- The state is mutated in place by next_bar, so the device loop can hold one
-- generator for the whole set and only read g.bar / g.last_fill.
function gen.new(opts)
  opts = opts or {}
  local style_name = opts.style or 'four_on_floor'
  local style = STYLES[style_name]
  if not style then
    error('gen: unknown style ' .. tostring(style_name) ..
      ' (have ' .. table.concat(style_names(), ', ') .. ')')
  end
  local steps = opts.steps or pattern.DEFAULT_STEPS
  if steps ~= math.floor(steps) or steps < pattern.MIN_STEPS
      or steps > pattern.MAX_STEPS then
    error('gen: steps must be a whole number in ' .. pattern.MIN_STEPS ..
      '..' .. pattern.MAX_STEPS .. ', got ' .. tostring(steps))
  end
  local fill_every = opts.fill_every or gen.DEFAULT_FILL_EVERY
  if type(fill_every) ~= 'number' or fill_every ~= math.floor(fill_every) or fill_every < 0 then
    error('gen: fill_every must be a whole number >= 0, got ' .. tostring(fill_every))
  end
  local g = {
    style = style,
    style_name = style_name,
    steps = steps,
    lanes = kit.count(),
    fill_every = fill_every,
    bar = 0,          -- bars generated so far
    last_fill = false,
    rng = opts.rng or default_rng,
    params = {},
  }
  for i = 1, #gen.PARAM_KEYS do
    g.params[gen.PARAM_KEYS[i]] = 0.5
  end
  g.params.swing = 0
  if opts.params then gen.set_params(g, opts.params) end
  return g
end

function gen.set_param(g, key, value)
  if key ~= 'intensity' and key ~= 'complexity' and key ~= 'variation' and key ~= 'swing' then
    error('gen: unknown param ' .. tostring(key))
  end
  g.params[key] = clamp01(value, 'param ' .. key)
  return g.params[key]
end

function gen.set_params(g, params)
  params = params or {}
  for i = 1, #gen.PARAM_KEYS do
    local key = gen.PARAM_KEYS[i]
    if params[key] ~= nil then gen.set_param(g, key, params[key]) end
  end
  return g.params
end

function gen.set_style(g, name)
  local style = STYLES[name]
  if not style then
    error('gen: unknown style ' .. tostring(name) ..
      ' (have ' .. table.concat(style_names(), ', ') .. ')')
  end
  g.style = style
  g.style_name = name
  return style
end

local function place(p, lane, step, vel)
  if pattern.get(p, lane, step) > 0 then return false end   -- skeleton wins
  pattern.set(p, lane, step, vel)
  return true
end

-- Velocity for a placed note: the style's value, scaled by intensity and nudged
-- by the humanize window. `skew` shifts the window so fills can ramp.
local function velocity(g, base, skew)
  local scaled = base * (0.85 + 0.3 * g.params.intensity) + (skew or 0)
  local jitter = g.rng(-1, 1) * math.floor(g.params.intensity * 8 + 0.5)
  return pattern.clamp_vel(scaled + jitter)
end

-- Humanize a step by at most one, staying inside the bar. Only called for
-- voices that are not `fixed`, and only does anything once intensity is up:
-- intensity 0 means a dead-straight grid. Always consumes exactly two draws, so
-- the RNG sequence does not depend on the values it produces - that is what
-- lets a test compare two parameter settings draw for draw.
local function drift(g, step)
  local skip = g.rng(-1, 1)
  local dir = g.rng(-1, 1)
  if skip == 0 or g.params.intensity <= 0 then return step end
  local moved = step + dir
  if moved < 1 then return 1 end
  if moved > g.steps then return g.steps end
  return moved
end

local function build_style(g, p)
  for i = 1, #g.style.grid do
    local entry = g.style.grid[i]
    local lane = kit.lane_for(entry.role)
    if lane then
      local use_alt = entry.alt ~= nil and g.rng() < g.params.variation
      local steps = use_alt and entry.alt or entry.steps
      local base = (use_alt and entry.alt_vel) or entry.vel
      -- Iterate the longer of the two lists, and draw for every slot whether or
      -- not it holds a step. The number of RNG calls per bar is then the same for
      -- every parameter setting, which is what lets a test compare two settings
      -- bar for bar instead of noise for noise.
      local slots = math.max(#entry.steps, entry.alt and #entry.alt or 0)
      for s = 1, slots do
        local want = steps[s]
        local step = drift(g, want or 1)
        local vel = velocity(g, base)
        if want then
          place(p, lane, entry.fixed and want or step, vel)
        end
      end
    end
  end
  -- Extras are gated purely on `complexity`, which is what makes density rise
  -- with the knob instead of merely shuffling around.
  for i = 1, #EXTRAS do
    local extra = EXTRAS[i]
    local lane = kit.lane_for(extra.role)
    if lane then
      for s = 1, #extra.steps do
        local step = extra.steps[s]
        local roll = g.rng()
        -- the velocity is drawn whether or not the note lands: keeping the draw
        -- count independent of the parameters is what makes bars comparable
        local vel = velocity(g, extra.vel)
        if step <= g.steps and roll < g.params.complexity * extra.weight then
          place(p, lane, step, vel)
        end
      end
    end
  end
  return p
end

-- A fill replaces the bar: a rim lead-in, toms climbing, rising velocity, and a
-- crash or open hat on the last step. The count grows with complexity.
local function build_fill(g, p)
  local toms = kit.by_role('tom')
  local count = 4 + math.floor(g.params.complexity * 4 + 0.5)
  if count > g.steps then count = g.steps end
  local rim = kit.lane_for('rim')
  local snare = kit.lane_for('snare')
  local ohat = kit.lane_for('hato')
  local crash = kit.lane_for('crash')
  for i = 1, count do
    local step = math.floor((i - 1) * g.steps / count) + 1
    if i == count then step = g.steps end
    local lane
    if i == 1 and rim then
      lane = rim
    elseif i % 2 == 0 and snare then
      lane = snare
    elseif #toms > 0 then
      lane = toms[(math.floor(i / 2) % #toms) + 1]
    end
    if lane then
      -- velocity ramps from a quiet lead-in to a loud last hit
      local skew = (i - 1) * 3
      place(p, lane, step, velocity(g, 58 + i * 4, skew))
    end
  end
  local crash_roll = g.rng()
  if crash and crash_roll < 0.5 + 0.5 * g.params.variation then
    place(p, crash, g.steps, velocity(g, 100))
  elseif ohat then
    place(p, ohat, g.steps, velocity(g, 88))
  end
  return p
end

-- Generate the next bar in place and return it. g.bar counts from 1.
function gen.next_bar(g)
  g.bar = g.bar + 1
  local p = pattern.new{ steps = g.steps, lanes = g.lanes }
  local is_fill = g.fill_every > 0 and (g.bar % g.fill_every == 0)
  g.last_fill = is_fill
  if is_fill then
    build_fill(g, p)
  else
    build_style(g, p)
  end
  return p
end

--------------------------------------------------------------------------------
-- scheduling: grid -> ticks, with swing
--------------------------------------------------------------------------------

-- The swung eighths are the last 16th of each beat: 3, 7, 11, 15 in a 16-step
-- bar. The beat itself (1, 5, 9, 13) never moves.
function gen.is_swung(step)
  return step % 4 == 3
end

function gen.swing_steps(steps)
  local out = {}
  for s = 1, steps do
    if gen.is_swung(s) then out[#out + 1] = s end
  end
  return out
end

-- swing is 0..1 and buys up to half a step of delay.
function gen.swing_ticks(swing, ticks_per_step)
  ticks_per_step = ticks_per_step or gen.TICKS_PER_STEP
  return math.floor(clamp01(swing or 0, 'swing') * (ticks_per_step / 2) + 0.5)
end

-- Grid -> event list, ordered by tick then lane. The clock layer consumes this
-- and knows nothing about the grid.
function gen.schedule(p, opts)
  opts = opts or {}
  local tps = opts.ticks_per_step or gen.TICKS_PER_STEP
  local offset = gen.swing_ticks(opts.swing, tps)
  local events = {}
  for lane = 1, pattern.lanes(p) do
    for step = 1, pattern.steps(p) do
      local vel = pattern.get(p, lane, step)
      if vel > 0 then
        events[#events + 1] = {
          lane = lane,
          step = step,
          vel = vel,
          tick = (step - 1) * tps + (gen.is_swung(step) and offset or 0),
        }
      end
    end
  end
  table.sort(events, function(a, b)
    if a.tick ~= b.tick then return a.tick < b.tick end
    return a.lane < b.lane
  end)
  return events
end

-- Density readout for the UI and for the tests: mean hits per bar, fill count.
function gen.stats(g, bars)
  local hits, fills = 0, 0
  for _ = 1, bars do
    hits = hits + pattern.count_hits(gen.next_bar(g))
    if g.last_fill then fills = fills + 1 end
  end
  return {
    bars = bars,
    hits = hits,
    fills = fills,
    mean_hits = hits / bars,
  }
end

return gen