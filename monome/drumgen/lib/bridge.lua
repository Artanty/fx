-- browser / device bridge for drumgen
--
-- The only module a host is allowed to call. Every entry point takes one JSON
-- string and returns one JSON string, using store.decode / store.encode, so no
-- host needs to understand Lua tables and no host needs a Lua bridge of its own.
-- The browser (fengari) and the future device entry script go through exactly
-- these functions, which is what keeps the two in step.
--
-- Deliberately free of norns globals: no screen, no clock, no engine, no
-- _menu. Time and pixels are the host's business; this file only owns the
-- generator, the grid, and the JSON it hands out.

local gen = require 'gen'
local pattern = require 'pattern'
local kit = require 'kit'
local store = require 'store'

local M = {}

M.VERSION = 1
M.PARAM_KEYS = gen.PARAM_KEYS

--------------------------------------------------------------------------------
-- the instance
--------------------------------------------------------------------------------

-- state = { gen = <generator>, grid = <pattern>, bar_rows = <last generated bar>,
--           events = {...} }
M.state = nil

local function new_state(config)
  config = config or {}
  return {
    gen = gen.new(config.gen or {}),
    grid = pattern.new(config.grid or {}),
    events = {},
  }
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

M.reply = reply

-- store.decode returns nil + a message instead of raising, so every entry point
-- funnels its argument through here and turns a bad payload into a reply.
local function decode(text, fallback)
  if text == nil or text == '' then return fallback or {} end
  local value, err = store.decode(text)
  if value == nil then return nil, err end
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

M.guard = guard

--------------------------------------------------------------------------------
-- entry points
--------------------------------------------------------------------------------

-- boot(json) -> json. (Re)create the instance from a config, e.g.
--   {"gen":{"style":"breakbeat","seed":7},"grid":{"steps":16}}
function M.boot(config_json)
  local config, err = decode(config_json, {})
  if not config then return reply({ ok = false, error = err }) end
  M.state = new_state(config)
  return reply({ state = snapshot() })
end

-- tick(json) -> json. Generate one bar and hand the host its events.
--   {"swing":0.3} overrides the generator's own swing for this bar
-- Tick order is what a host needs to schedule against, and the note number is
-- resolved here so no host needs the kit.
function M.tick(opts_json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local opts, err = decode(opts_json, {})
  if not opts then return reply({ ok = false, error = err }) end

  local bar = gen.next_bar(st.gen)
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
  return reply({ state = snapshot() })
end

-- set(json) -> json. Apply a UI change: {"style":"disco"} or
-- {"param":{"swing":0.4}} or {"tempo":120}.
function M.set(json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local change, err = decode(json, {})
  if not change then return reply({ ok = false, error = err }) end
  if change.style then gen.set_style(st.gen, change.style) end
  if change.param then gen.set_param(st.gen, change.param, change.value) end
  if change.params then gen.set_params(st.gen, change.params) end
  return reply({ state = snapshot() })
end

-- cells(json) -> json. The grid the host is editing: replace it wholesale.
--   {"rows":[[0,100,...],...]}
function M.cells(json)
  local st = M.state
  if not st then return reply({ ok = false, error = 'not booted' }) end
  local change, err = decode(json, {})
  if not change then return reply({ ok = false, error = err }) end
  local rows = change.rows
  -- from_rows validates the shape itself (equal-length lanes, steps in range),
  -- so a malformed host payload dies in the guard instead of half-applying.
  if rows then st.grid = pattern.from_rows(rows) end
  return reply({ state = snapshot() })
end

return M