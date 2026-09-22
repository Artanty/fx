-- lib/rnd.lua -- on-device randomizer: param-group builder, group on/off
-- list, and a 5 s run loop that randomly re-sets each enabled group's params
-- and commits the working body to the ACTIVE preset slot so the changes are
-- heard. The C4 ignores CTRL_SET (only the flash-commit path is audible), so
-- the original body is snapshotted at start and committed back on stop: the
-- preset itself is never left modified. Groups persist to rndgroups.json in
-- the script dir.

local rnd = {}

rnd.groups = {}
rnd.sel = { rows = {} }
rnd.eligible = {}
rnd.running = false
rnd.stopping = false
rnd.paused = false
rnd.busy = false
rnd.tick = 0
rnd.due = 0
rnd.error = ''
rnd.idx = -1
rnd.name = ''
rnd.orig = {}
rnd.body = {}
rnd.run_rows = {}
rnd.on_change = nil

local c4hid = require 'c4hid'
local c4model = require 'c4model'

local EXCLUDE = {}
for _, n in ipairs {
  'ext_control_enable',
  'ext1_destination', 'ext1_source', 'ext1_min', 'ext1_max',
  'ext2_destination', 'ext2_source', 'ext2_min', 'ext2_max',
  'ext3_destination', 'ext3_source', 'ext3_min', 'ext3_max',
  'knob1_assign', 'knob2_assign',
  'routing_option',
  'pitch_detect_input', 'pitch_detect_mode',
  'pitch_detect_low_note', 'pitch_detect_high_note',
  'lfo_midi_clock_sync',
} do EXCLUDE[n] = true end

for i = 1, c4model.count() do
  local row = c4model.row(i)
  if row and not EXCLUDE[row.name] then
    rnd.eligible[#rnd.eligible + 1] = { rn = i, label = row.label }
  end
end

math.randomseed(os.time() % 100000 + 1)

-- Singleton 5 s loop. A global stash lets the reload-safe require() stop a
-- leaked metro from a previous script instance (running flag guards it too).
if metro then
  if _G and _G.c4rnd_metro then _G.c4rnd_metro:stop() end
  _G.c4rnd_metro = metro.init {
    time = 5,
    count = -1,
    event = function() rnd.tick_once() end
  }
end

-- --- JSON persistence -------------------------------------------------------

local FILE = 'rndgroups.json'

local function file_path()
  if norns and norns.state and norns.state.path then
    return norns.state.path .. FILE
  end
  return '/tmp/c4rndgroups.json'
end

local function jstr(s)
  s = tostring(s or ''):gsub('[%z\1-\31\\"]', function(c)
    if c == '"' then return '\\"' end
    if c == '\\' then return '\\\\' end
    if c == '\n' then return '\\n' end
    if c == '\r' then return '\\r' end
    if c == '\t' then return '\\t' end
    return string.format('\\u%04x', c:byte())
  end)
  return '"' .. s .. '"'
end

function rnd.to_json(groups)
  local parts = {}
  for i, g in ipairs(groups) do
    local rows = {}
    for j, rn in ipairs(g.rows) do rows[#rows + 1] = tostring(rn) end
    parts[#parts + 1] = '{'
      .. jstr('name') .. ':' .. jstr(g.name) .. ','
      .. jstr('enabled') .. ':' .. (g.enabled and 'true' or 'false') .. ','
      .. jstr('rows') .. ':[' .. table.concat(rows, ',') .. ']}'
  end
  return '[' .. table.concat(parts, ',') .. ']'
end

local function decode_json(s)
  local pos = 0
  local n = #s
  local function skip()
    while pos < n do
      local c = s:sub(pos + 1, pos + 1)
      if c == ' ' or c == '\t' or c == '\r' or c == '\n' then pos = pos + 1 else break end
    end
  end
  local function eat(c)
    skip()
    if s:sub(pos + 1, pos + 1) ~= c then error('format') end
    pos = pos + 1
  end
  local function str()
    eat('"')
    local out = {}
    while pos < n do
      local c = s:sub(pos + 1, pos + 1)
      pos = pos + 1
      if c == '"' then break end
      if c == '\\' then
        local e = s:sub(pos + 1, pos + 1)
        if e == 'n' then out[#out + 1] = '\n'
        elseif e == 'r' then out[#out + 1] = '\r'
        elseif e == 't' then out[#out + 1] = '\t'
        elseif e == '"' then out[#out + 1] = '"'
        elseif e == '\\' then out[#out + 1] = '\\'
        elseif e == 'u' then
          out[#out + 1] = string.char(tonumber(s:sub(pos + 2, pos + 5), 16) or 63)
          pos = pos + 4
        end
      else
        out[#out + 1] = c
      end
    end
    return table.concat(out)
  end
  local function val()
    skip()
    local c = s:sub(pos + 1, pos + 1)
    if c == '{' then
      pos = pos + 1
      local o = {}
      skip()
      if s:sub(pos + 1, pos + 1) == '}' then pos = pos + 1 return o end
      while true do
        local k = str()
        eat(':')
        o[k] = val()
        skip()
        local cc = s:sub(pos + 1, pos + 1)
        if cc == ',' then pos = pos + 1
        elseif cc == '}' then pos = pos + 1 break
        else error('format') end
      end
      return o
    elseif c == '[' then
      pos = pos + 1
      local a = {}
      skip()
      if s:sub(pos + 1, pos + 1) == ']' then pos = pos + 1 return a end
      while true do
        a[#a + 1] = val()
        skip()
        local cc = s:sub(pos + 1, pos + 1)
        if cc == ',' then pos = pos + 1
        elseif cc == ']' then pos = pos + 1 break
        else error('format') end
      end
      return a
    elseif c == '"' then return str()
    elseif c == 't' then pos = pos + 4 return true
    elseif c == 'f' then pos = pos + 5 return false
    elseif c == 'n' then pos = pos + 4 return nil
    else
      local m = s:match('^-?%d+', pos + 1)
      if not m then error('format') end
      pos = pos + #m
      return tonumber(m)
    end
  end
  local v = val()
  skip()
  if pos ~= n then error('trailing') end
  return v
end

function rnd.load()
  local f = io.open(file_path(), 'rb')
  if not f then return end
  local s = f:read('*a')
  f:close()
  local groups = {}
  local ok, data = pcall(decode_json, s)
  if ok and type(data) == 'table' then
    for _, g in ipairs(data) do
      if type(g) == 'table' and type(g.name) == 'string' and type(g.rows) == 'table' then
        local rows = {}
        for _, rn in ipairs(g.rows) do
          rn = tonumber(rn)
          if rn and rn >= 1 and rn <= c4model.count() then rows[#rows + 1] = rn end
        end
        groups[#groups + 1] = { name = g.name, enabled = (g.enabled ~= false), rows = rows }
      end
    end
  end
  rnd.groups = groups
end

function rnd.save()
  local f = io.open(file_path(), 'wb')
  if not f then
    rnd.error = 'cannot write groups file'
    return
  end
  f:write(rnd.to_json(rnd.groups))
  f:close()
end

-- --- group run-logic --------------------------------------------------------

function rnd.union_rows()
  local seen = {}
  local out = {}
  for _, g in ipairs(rnd.groups) do
    if g.enabled then
      for _, rn in ipairs(g.rows) do
        if not seen[rn] then
          seen[rn] = true
          out[#out + 1] = rn
        end
      end
    end
  end
  table.sort(out)
  return out
end

local function randomize()
  for _, rn in ipairs(rnd.run_rows) do
    local row = c4model.row(rn)
    if row then
      local v
      if row.type == 'toggle' then
        v = math.random(0, 1)
      else
        v = math.random(0, row.max)
      end
      c4model.set(rnd.body, rn, v)
    end
  end
end

function rnd.tick_once()
  if not rnd.running or rnd.busy then return end
  rnd.busy = true
  rnd.due = os.time() + 5
  randomize()
  if not c4hid.commit(rnd.idx, rnd.body, rnd.name, function(r)
    rnd.busy = false
    if r.ok then
      rnd.tick = rnd.tick + 1
      rnd.error = ''
    else
      rnd.error = r.err or 'commit failed'
    end
    if rnd.on_change then rnd.on_change() end
  end) then
    rnd.busy = false
  end
end

function rnd.start()
  if rnd.running or rnd.stopping or not (_G and _G.c4rnd_metro) then
    rnd.error = rnd.stopping and 'restore in progress - wait' or (rnd.running and 'already running' or '')
    return
  end
  rnd.tick = 0
  rnd.error = ''
  rnd.paused = false
  rnd.running = true
  rnd.run_rows = rnd.union_rows()
  if #rnd.run_rows == 0 then
    rnd.running = false
    rnd.error = 'no enabled groups - add or enable groups first'
    return
  end
  rnd.due = os.time() + 5
  _G.c4rnd_metro:start()
  rnd.tick_once()
end

-- Pause the loop: stop the metro but HOLD the last randomized values so a
-- later start() resumes from them. The original preset is not restored until
-- stop().
function rnd.pause()
  if not rnd.running then return end
  rnd.running = false
  rnd.paused = true
  if _G and _G.c4rnd_metro then _G.c4rnd_metro:stop() end
end

function rnd.restore()
  if not c4hid.commit(rnd.idx, rnd.orig, rnd.name, function(r)
    rnd.busy = false
    rnd.stopping = false
    rnd.paused = false
    for i = 0, 127 do rnd.body[i] = rnd.orig[i] or 0 end
    if not r.ok then rnd.error = r.err or 'restore failed' end
    if rnd.on_change then rnd.on_change() end
  end) then
    rnd.busy = false
    rnd.stopping = false
    rnd.paused = false
    for i = 0, 127 do rnd.body[i] = rnd.orig[i] or 0 end
    if rnd.on_change then rnd.on_change() end
  end
end

function rnd.stop()
  if not (rnd.running or rnd.paused) then return end
  rnd.running = false
  rnd.paused = false
  rnd.stopping = true
  if _G and _G.c4rnd_metro then _G.c4rnd_metro:stop() end
  if rnd.busy then
    local retry = metro.init {
      time = 0.5,
      count = 1,
      event = function()
        if rnd.busy then
          retry:start()
        else
          rnd.busy = true
          rnd.restore()
        end
      end
    }
    retry:start()
  else
    rnd.busy = true
    rnd.restore()
  end
end

rnd.load()

return rnd