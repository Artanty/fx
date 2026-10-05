-- browser / device bridge for drumgen
--
-- The only module a host is allowed to call. Every entry point takes one JSON
-- string and returns one JSON string, using store.decode / store.encode, so no
-- host needs to understand Lua tables and no host needs a Lua bridge of its own.
-- The browser (fengari) and the future device entry script go through exactly
-- these functions, which is what keeps the two in step.
--
-- Deliberately free of norns globals: no screen, no clock, no engine, no _menu.
-- Time and pixels are the host's business, except that this file owns a screen
-- of its own (lib/ui.lua) so the browser and the device draw the same pixels:
-- the device adapter pushes them to hardware, the browser paints them on a
-- canvas.

local gen = require 'gen'
local pattern = require 'pattern'
local kit = require 'kit'
local store = require 'store'
local ui = require 'ui'

local M = {}

M.VERSION = 1
M.PARAM_KEYS = gen.PARAM_KEYS

-- Tempo is not generator state - it never changes what gets generated - so it
-- belongs to the clock. 120 is what a norns would run at out of the box.
M.DEFAULT_TEMPO = 120

-- One encoder detent. Real norns encoders send d in -3..3, and the browser sends
-- the same numbers, so there is one input path rather than two that can drift.
M.ENC_STEP = 0.02

--------------------------------------------------------------------------------
-- the instance
--------------------------------------------------------------------------------

-- state = { gen, grid, bar_rows, events, sb, tempo, playing, playhead,
--           selected, swing_page }
M.state = nil

local function new_state(config)
  config = config or {}
  return {
    gen = gen.new(config.gen or {}),
    grid = pattern.new(config.grid or {}),
    events = {},
    -- this instance's own 128x64 screen
    sb = ui.new(),
    tempo = M.DEFAULT_TEMPO,
    playing = false,
    playhead = nil,
    -- which param the encoders are turning, 1..4
    selected = 1,
    -- key 3 swaps the encoders to swing: there are three encoders and four
    -- params, and inventing a fourth control would make the browser nicer than
    -- the device in exactly the wrong way
    swing_page = false,
  }
end

-- Tempo lives on the state but not on the generator, and is clamped rather than
-- refused: a host sending 9000 should get 300 back, not an error.
function M.tempo(tempo)
  if not M.state then return M.DEFAULT_TEMPO end
  if tempo == nil then return M.state.tempo end
  local t = tonumber(tempo)
  if not t or t < 40 or t > 300 then return M.state.tempo end
  M.state.tempo = t
  return t
end

--------------------------------------------------------------------------------
-- plain-data view of the instance
--------------------------------------------------------------------------------

-- kit.voices() carries fields the host has no use for (choke groups, engine
-- names), so only what a display needs crosses the boundary.
local function voice_view()
  local out = {}
  for i, v in ipairs(kit.voices()) do
    out[i] = { lane = i, id = v.id, label = v.label, note = v.note }
  end
  return out
end

local function snapshot()
  local st = M.state
  if not st then return { booted = false } end
  local g = st.gen
  return {
    booted = true,
    -- grid is the pattern the host is editing; bar_rows is the last bar the
    -- generator produced. They are different things and a UI needs both.
    rows = pattern.to_rows(st.grid),
    bar_rows = st.bar_rows,
    steps = pattern.steps(st.grid),
    lanes = pattern.lanes(st.grid),
    style = g.style_name,
    styles = gen.styles(),
    params = g.params,
    fill_every = g.fill_every,
    bar = g.bar,
    last_fill = g.last_fill,
    tempo = st.tempo,
    playing = st.playing,
    playhead = st.playhead,
    selected = st.selected,
    swing_page = st.swing_page,
    enc_params = ui.ENCODER_PARAMS,
    ticks_per_step = gen.TICKS_PER_STEP,
    voices = voice_view(),
    events = st.events,
  }
end

M.snapshot = snapshot

--------------------------------------------------------------------------------
-- replies and error containment
--------------------------------------------------------------------------------

local function reply(fields)
  fields.ok = fields.ok ~= false
  return store.compact(fields)
end

-- store.decode returns nil + a message instead of raising, so every entry point
-- funnels its argument through here and turns a bad payload into a reply.
-- An empty string means "nothing to say", which is not the same as a bad payload:
-- a host with no changes to send should not have to invent one.
local function decode(text, fallback)
  if text == nil or text == '' then return fallback or {} end
  local value, err = store.decode(text)
  if value == nil then return nil, err end
  if type(value) ~= 'table' then
    return nil, 'expected a JSON object, got ' .. type(value)
  end
  -- [1,2,3] decodes to a table too, and silently doing nothing with it would
  -- look like a successful no-op to a host that got its types wrong.
  if #value > 0 then
    return nil, 'expected a JSON object, got an array'
  end
  return value
end

-- A Lua error has to arrive as a reply, not as a dead host: the browser shows it
-- on the page instead of a blank canvas, the device prints it.
local function traceback(err)
  local ok, tb = pcall(function() return debug.traceback(tostring(err), 2) end)
  return ok and tb or tostring(err)
end

-- Each entry point takes exactly one argument, so xpcall never needs varargs
-- (extra arguments to xpcall only arrived in 5.2 and LuaJIT is 5.1).
local function guard(fn, arg)
  local ok, res = xpcall(function() return fn(arg) end, traceback)
  if ok then return res end
  return reply({ ok = false, error = res })
end

--------------------------------------------------------------------------------
-- entry points
--------------------------------------------------------------------------------

local do_boot

local do_tick

local do_set

local do_cells

local do_render

local do_input

-- boot(json) -> json. (Re)create the instance from a config, e.g.
--   {"gen":{"style":"breakbeat","seed":7},"grid":{"steps":16}}
function do_boot(config_json)
  local config, err = decode(config_json, {})
  if not config then return reply({ ok = false, error = err }) end
  M.state = new_state(config)
  if config.tempo then M.tempo(config.tempo) end
  return reply({ state = snapshot() })
end

-- tick(json) -> json. Generate one bar and hand the host its events.
--   {"swing":0.3}       overrides the generator's own swing for this bar
--   {"force_fill":true} make this bar a fill regardless of the cadence
--   {"playhead":5}      where the host's playhead is, for the redraw
-- Tick order is what a host needs to schedule against, and the note number is
-- resolved here so no host needs the kit.
function do_tick(opts_json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local opts, err = decode(opts_json, {})
  if not opts then return reply({ ok = false, error = err }) end
  if opts.tempo then M.tempo(opts.tempo) end
  if opts.playhead ~= nil then st.playhead = opts.playhead end

  local bar = gen.next_bar(st.gen, { force_fill = opts.force_fill })
  st.bar_rows = pattern.to_rows(bar)
  local events = {}
  for _, e in ipairs(gen.schedule(bar, { swing = opts.swing })) do
    local voice = kit.at(e.lane)
    events[#events + 1] = {
      lane = e.lane,
      step = e.step,
      tick = e.tick,
      vel = e.vel,
      note = voice.note,
      id = voice.id,
    }
  end
  st.events = events
  return reply({ state = snapshot(), events = events })
end

-- set(json) -> json. Apply a UI change:
--   {"style":"disco"} / {"params":{"swing":0.4}} / {"tempo":120} / {"playing":true}
function do_set(json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local change, err = decode(json, {})
  if not change then return reply({ ok = false, error = err }) end
  if change.style then gen.set_style(st.gen, change.style) end
  if change.param then gen.set_param(st.gen, change.param, change.value) end
  if change.params then gen.set_params(st.gen, change.params) end
  if change.tempo then M.tempo(change.tempo) end
  if change.playing ~= nil then st.playing = change.playing and true or false end
  if change.playhead ~= nil then st.playhead = change.playhead end
  if change.selected ~= nil then st.selected = change.selected end
  return reply({ state = snapshot() })
end

-- cells(json) -> json. The grid the host is editing: replace it wholesale.
--   {"rows":[[0,100,...],...]}
function do_cells(json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local change, err = decode(json, {})
  if not change then return reply({ ok = false, error = err }) end
  local rows = change.rows
  -- from_rows validates the shape itself (equal-length lanes, steps in range),
  -- so a malformed host payload dies in the guard instead of half-applying.
  if rows then
    -- It also accepts any lane count, but the grid on screen is always the kit's
    -- lane count, so a payload with the wrong number of rows is a host bug worth
    -- naming rather than silently generating against.
    if type(rows) == 'table' and #rows ~= kit.count() then
      return reply({ ok = false, error = string.format(
        'cells: the grid is %d lanes wide, the payload has %d',
        kit.count(), type(rows) == 'table' and #rows or 0) })
    end
    st.grid = pattern.from_rows(rows)
  end
  return reply({ state = snapshot() })
end

--------------------------------------------------------------------------------
-- the screen
--------------------------------------------------------------------------------

-- Draw the current state into the instance's own screen. Every host does this the
-- same way, so the pixels on the norns and the pixels in the browser come out of
-- the same draw call.
local function redraw()
  local st = M.state
  ui.draw(st.sb, {
    style = st.gen.style_name,
    bar = st.gen.bar,
    playing = st.playing,
    params = st.gen.params,
    -- the generated bar is what should be on screen; the editable grid is only
    -- shown before the first bar exists
    rows = st.bar_rows or pattern.to_rows(st.grid),
    playhead = st.playhead,
    selected = st.swing_page and 4 or st.selected,
    swing_page = st.swing_page,
    last_fill = st.gen.last_fill,
  })
  return st.sb
end

-- render(json) -> json. Redraw and hand back the pixels.
--   {"playhead":9} / {"playing":true}
--
-- The pixels come back run-length encoded: {"rle":[[count,level],...]} in reading
-- order, top left to bottom right. A 128x64 screen is mostly dark, so this is a
-- few hundred pairs instead of 8192 numbers, and it needs no fengari table
-- interop - the same reasoning as store.decode on the way in.
function do_render(opts_json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local opts, err = decode(opts_json, {})
  if not opts then return reply({ ok = false, error = err }) end
  if opts.playhead ~= nil then st.playhead = opts.playhead end
  if opts.playing ~= nil then st.playing = opts.playing and true or false end

  local sb = redraw()
  local _, bounds = sb:take_dirty()
  local rle = {}
  local run, level = 0, sb:get(0, 0)
  for y = 0, sb.height - 1 do
    for x = 0, sb.width - 1 do
      local v = sb:get(x, y)
      if v == level then
        run = run + 1
      else
        rle[#rle + 1] = { run, level }
        level = v
        run = 1
      end
    end
  end
  rle[#rle + 1] = { run, level }
  return reply({
    state = snapshot(),
    -- dirty is top level, not nested: it is about this call, not about the
    -- shape of the pixels
    dirty = bounds ~= nil,
    pixels = { width = sb.width, height = sb.height, rle = rle },
  })
end

--------------------------------------------------------------------------------
-- input
--------------------------------------------------------------------------------

-- Which param an encoder turns right now: normally its own, or swing while the
-- swing key is held as a page.
local function param_for_encoder(st, n)
  if st.swing_page then return 'swing' end
  return ui.ENCODER_PARAMS[n]
end

local function apply_enc(st, n, d)
  if type(n) ~= 'number' or n < 1 or n > 3 or n ~= math.floor(n) then
    return 'encoder ' .. tostring(n) .. ' does not exist (there are 3)'
  end
  local key = param_for_encoder(st, n)
  local delta = tonumber(d) or 0
  gen.set_param(st.gen, key, st.gen.params[key] + delta * M.ENC_STEP)
  return nil
end

-- The three keys, on the press edge only.
local function apply_key(st, n)
  if n == 1 then
    st.playing = not st.playing
    return nil
  end
  if n == 2 then
    -- styles() is sorted, so stepping through it is a stable lap
    local names = gen.styles()
    for i = 1, #names do
      if names[i] == st.gen.style_name then
        gen.set_style(st.gen, names[(i % #names) + 1])
        return nil
      end
    end
    gen.set_style(st.gen, names[1])
    return nil
  end
  if n == 3 then
    st.swing_page = not st.swing_page
    st.selected = st.swing_page and 4 or 1
    return nil
  end
  return 'key ' .. tostring(n) .. ' does not exist (there are 3)'
end

-- input(json) -> json. Feed device-shaped input in.
--   {"events":[{"kind":"enc","n":2,"d":-1},{"kind":"key","n":1,"z":true}]}
--
-- Only the press edge acts on a key, because a norns key() fires once per press
-- and a host that also sends z:false would otherwise double-toggle. Encoders are
-- relative, so every d counts.
function do_input(json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local change, err = decode(json, {})
  if not change then return reply({ ok = false, error = err }) end
  if change.tempo then M.tempo(change.tempo) end
  local events = change.events
  if events ~= nil and type(events) ~= 'table' then
    return reply({ ok = false, error = 'events must be an array' })
  end
  for i, e in ipairs(events or {}) do
    if type(e) ~= 'table' then
      return reply({ ok = false,
        error = string.format('event %d is a %s, not an object', i, type(e)) })
    end
    if e.kind == 'enc' then
      local bad = apply_enc(st, e.n, e.d)
      if bad then return reply({ ok = false, error = bad }) end
    elseif e.kind == 'key' then
      if e.z then
        local bad = apply_key(st, e.n)
        if bad then return reply({ ok = false, error = bad }) end
      end
    else
      return reply({ ok = false, error = 'unknown input kind ' .. tostring(e.kind) })
    end
  end
  return reply({ state = snapshot() })
end

--------------------------------------------------------------------------------
-- the guarded API
--------------------------------------------------------------------------------

-- Every host calls these, and every one of them is wrapped. gen.set_style and
-- pattern.from_rows raise on bad input, which is right inside Lua but fatal to a
-- host: fengari would throw into the browser console and the norns would drop the
-- callback. Here a raise becomes {ok:false, error=...} with a traceback, so the
-- page shows it and the device prints it.
M.boot = function(arg) return guard(do_boot, arg) end
M.tick = function(arg) return guard(do_tick, arg) end
M.set = function(arg) return guard(do_set, arg) end
M.cells = function(arg) return guard(do_cells, arg) end
M.render = function(arg) return guard(do_render, arg) end
M.input = function(arg) return guard(do_input, arg) end

-- Unguarded, for the host tests: a test that wants the traceback should see the
-- raise, not a reply describing it.
M.raw = {
  boot = do_boot, tick = do_tick, set = do_set,
  cells = do_cells, render = do_render, input = do_input,
}

return M