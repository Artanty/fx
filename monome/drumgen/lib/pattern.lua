-- monome/drumgen/lib/pattern.lua -- the editable drum grid.
--
-- A pattern is `lanes` x `steps`: one lane per kit voice, one cell per sixteenth
-- note. A cell holds a velocity 0..127 where 0 means "no hit", so a bar is a
-- plain array of arrays that renders, edits and serialises as-is - no sparse
-- structure, no bitfields, nothing the UI has to translate.
--
-- Lanes and steps are 1-based like the kit. With the v1 default of 16 steps
-- (4/4) the beats are steps 1, 5, 9, 13 and the swung eighths - the "ands" of
-- each beat - are 3, 7, 11, 15 (gen.swing_steps() picks those up).
--
-- Pure Lua 5.1, no norns globals: everything the UI and the clock need to read
-- a bar lives here, so this is testable on the host.

local pattern = {}

pattern.DEFAULT_STEPS = 16
pattern.DEFAULT_LANES = 10
pattern.MIN_STEPS = 1
pattern.MAX_STEPS = 64
pattern.VEL_MAX = 127
pattern.DEFAULT_VEL = 100

-- Velocity in 0..127. nil means "use the default velocity" (a grid tap), 0 and
-- below mean "clear the cell", and anything above 127 is capped rather than
-- wrapped - a wrapped velocity is a silent bug, a capped one is audible.
function pattern.clamp_vel(v)
  if v == nil then return pattern.DEFAULT_VEL end
  if type(v) ~= 'number' then
    error('pattern: velocity must be a number, got ' .. type(v))
  end
  if v ~= v then return 0 end                       -- NaN clears rather than errors
  v = math.floor(v + 0.5)
  if v < 0 then return 0 end
  if v > pattern.VEL_MAX then return pattern.VEL_MAX end
  return v
end

local function check_int(v, name)
  if type(v) ~= 'number' or v ~= math.floor(v) then
    error('pattern: ' .. name .. ' must be a whole number, got ' .. tostring(v))
  end
  return v
end

local function check_lane(p, lane)
  lane = check_int(lane, 'lane')
  if lane < 1 or lane > pattern.lanes(p) then
    error(string.format('pattern: lane %d out of range 1..%d', lane, pattern.lanes(p)))
  end
  return lane
end

local function check_step(p, step)
  step = check_int(step, 'step')
  if step < 1 or step > pattern.steps(p) then
    error(string.format('pattern: step %d out of range 1..%d', step, pattern.steps(p)))
  end
  return step
end

-- new{steps=, lanes=} -> empty grid (every velocity 0).
function pattern.new(opts)
  opts = opts or {}
  local steps = opts.steps or pattern.DEFAULT_STEPS
  local lanes = opts.lanes or pattern.DEFAULT_LANES
  check_int(steps, 'steps')
  check_int(lanes, 'lanes')
  if steps < pattern.MIN_STEPS or steps > pattern.MAX_STEPS then
    error(string.format('pattern: steps %d out of range %d..%d',
      steps, pattern.MIN_STEPS, pattern.MAX_STEPS))
  end
  if lanes < 1 or lanes > pattern.MAX_STEPS then
    error(string.format('pattern: lanes %d out of range 1..%d', lanes, pattern.MAX_STEPS))
  end
  local p = { steps = steps, lanes = {}, nlanes = lanes }
  for l = 1, lanes do
    local row = {}
    for s = 1, steps do row[s] = 0 end
    p.lanes[l] = row
  end
  return p
end

function pattern.steps(p)
  return p.steps
end

function pattern.lanes(p)
  return p.nlanes
end

function pattern.get(p, lane, step)
  return p.lanes[check_lane(p, lane)][check_step(p, step)]
end

-- set returns the velocity actually stored, so callers can show what they got.
function pattern.set(p, lane, step, vel)
  local v = pattern.clamp_vel(vel)
  p.lanes[check_lane(p, lane)][check_step(p, step)] = v
  return v
end

-- hit toggles: any velocity becomes empty, empty becomes opts.vel or the
-- default. Returns the new velocity.
function pattern.hit(p, lane, step, vel)
  if pattern.get(p, lane, step) > 0 then
    p.lanes[lane][step] = 0
    return 0
  end
  return pattern.set(p, lane, step, vel)
end

-- clear(lane) empties one lane; clear() empties the whole bar.
function pattern.clear(p, lane)
  if lane == nil then
    for l = 1, p.nlanes do
      for s = 1, p.steps do p.lanes[l][s] = 0 end
    end
    return p
  end
  for s = 1, p.steps do p.lanes[check_lane(p, lane)][s] = 0 end
  return p
end

function pattern.clone(p)
  local q = { steps = p.steps, lanes = {}, nlanes = p.nlanes }
  for l = 1, p.nlanes do
    local row, src = {}, p.lanes[l]
    for s = 1, p.steps do row[s] = src[s] end
    q.lanes[l] = row
  end
  return q
end

function pattern.count_hits(p, lane)
  local total = 0
  if lane ~= nil then
    local row = p.lanes[check_lane(p, lane)]
    for s = 1, p.steps do
      if row[s] > 0 then total = total + 1 end
    end
    return total
  end
  for l = 1, p.nlanes do total = total + pattern.count_hits(p, l) end
  return total
end

-- Sorted steps holding a hit in one lane (or across the bar when lane is nil,
-- with duplicates for two lanes on the same step).
function pattern.steps_with_hits(p, lane)
  local out = {}
  local function scan(l)
    local row = p.lanes[l]
    for s = 1, p.steps do
      if row[s] > 0 then out[#out + 1] = s end
    end
  end
  if lane ~= nil then
    scan(check_lane(p, lane))
  else
    for l = 1, p.nlanes do scan(l) end
  end
  table.sort(out)
  return out
end

function pattern.is_empty(p)
  return pattern.count_hits(p) == 0
end

-- Highest step holding any hit, 0 when empty - the UI needs it to know how much
-- of the bar is in use.
function pattern.last_step(p)
  local last = 0
  for l = 1, p.nlanes do
    local row = p.lanes[l]
    for s = p.steps, 1, -1 do
      if row[s] > 0 and s > last then last = s end
    end
  end
  return last
end

-- Stable on-disk / on-wire shape: an array of lane rows.
function pattern.to_rows(p)
  local rows = {}
  for l = 1, p.nlanes do
    local row = {}
    for s = 1, p.steps do row[s] = p.lanes[l][s] end
    rows[l] = row
  end
  return rows
end

-- from_rows(rows) rebuilds a pattern and rejects anything malformed, so a
-- corrupted file fails at load instead of drawing garbage on the grid.
function pattern.from_rows(rows)
  if type(rows) ~= 'table' or #rows == 0 then
    error('pattern.from_rows: expected a non-empty array of lane rows')
  end
  local lanes = #rows
  local steps = #rows[1]
  if steps < pattern.MIN_STEPS or steps > pattern.MAX_STEPS then
    error(string.format('pattern.from_rows: steps %d out of range %d..%d',
      steps, pattern.MIN_STEPS, pattern.MAX_STEPS))
  end
  local p = pattern.new{ steps = steps, lanes = lanes }
  for l = 1, lanes do
    local row = rows[l]
    if type(row) ~= 'table' or #row ~= steps then
      error(string.format('pattern.from_rows: lane %d has %s cells, expected %d',
        l, type(row) == 'table' and #row or type(row), steps))
    end
    for s = 1, steps do p.lanes[l][s] = pattern.clamp_vel(row[s]) end
  end
  return p
end

-- Shift every hit on the bar by n steps, wrapping around the loop. Used by the
-- "rotate" gesture and by fills that start on an offset.
function pattern.rotate(p, n)
  n = n % p.steps
  if n == 0 then return p end
  for l = 1, p.nlanes do
    local row = p.lanes[l]
    local moved = {}
    for s = 1, p.steps do
      local dest = ((s - 1 + n) % p.steps) + 1
      moved[dest] = row[s]
    end
    for s = 1, p.steps do row[s] = moved[s] end
  end
  return p
end

return pattern