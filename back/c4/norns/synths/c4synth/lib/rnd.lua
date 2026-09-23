-- lib/rnd.lua -- on-device randomizer: param-group builder, group on/off
-- list, and a 5 s run loop that randomly re-sets each enabled group's params
-- and commits the working body to the ACTIVE preset slot so the changes are
-- heard. The C4 ignores CTRL_SET (only the flash-commit path is audible), so
-- the original body is snapshotted at start and committed back on stop: the
-- preset itself is never left modified. Groups persist to rndgroups.json in
-- the script dir.

local rnd = {}

rnd.HIST_MAX = 10 -- iterations remembered for E1 prev/next on the run page
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
rnd.hist = {}      -- newest-last; each entry { tick = n, body = {0..127} }
rnd.hist_pos = 0   -- 1-based index of the audible/current iteration
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

-- Remember the current body as a completed iteration (newest-last, capped at
-- HIST_MAX). The most recent entry is the audible/current one; earlier ones can
-- be revisited with E1 prev on the run page.
function rnd.hist_push()
  local snap = {}
  for i = 0, 127 do snap[i] = rnd.body[i] or 0 end
  rnd.hist[#rnd.hist + 1] = { tick = rnd.tick, body = snap }
  while #rnd.hist > rnd.HIST_MAX do table.remove(rnd.hist, 1) end
  rnd.hist_pos = #rnd.hist
end

-- Randomize the current body and commit it to the pedal. Shared by the 5 s
-- timer (tick_once) and the run page's E1 next-past-the-newest handler: each
-- success becomes a new remembered iteration. The next iteration waits for the
-- next timer tick.
function rnd.gen_next()
  if rnd.busy then return end
  rnd.busy = true
  rnd.due = os.time() + 5
  randomize()
  if not c4hid.commit(rnd.idx, rnd.body, rnd.name, function(r)
    rnd.busy = false
    if r.ok then
      rnd.tick = rnd.tick + 1
      rnd.error = ''
      rnd.hist_push()
    else
      rnd.error = r.err or 'commit failed'
    end
    if rnd.on_change then rnd.on_change() end
  end) then
    rnd.busy = false
  end
end

-- One timer tick: randomize and commit (audible), remembering the result.
function rnd.tick_once()
  if not rnd.running or rnd.busy then return end
  rnd.gen_next()
end

-- Re-commit a remembered iteration so it is heard, and make it the current
-- one. The iteration counter is unchanged (recalling is not a new tick). The
-- 5 s timer keeps running, so the loop continues from wherever the user
-- lands.
function rnd.recall(pos)
  local e = rnd.hist[pos]
  if not e or rnd.busy then return end
  rnd.busy = true
  -- Adopt the recalled entry's own iteration number so the run header shows
  -- the held state's count, and restart the countdown to a full 5 s when the
  -- loop is running (manual E1 stepping owns the pedal; paused stays stopped).
  if e.tick then rnd.tick = e.tick end
  rnd.due = os.time() + 5
  for i = 0, 127 do rnd.body[i] = e.body[i] or 0 end
  rnd.hist_pos = pos
  -- E1 owns the heel here: repaint the header the moment the step lands so the
  -- iteration # (and ll/l> glyph) tracks the knob without waiting on the async
  -- c4hid commit round-trip (that callback only clears busy / reports errors).
  if rnd.on_change then rnd.on_change() end
  if rnd.on_change then rnd.on_change() end
  if not c4hid.commit(rnd.idx, rnd.body, rnd.name, function(r)
    rnd.busy = false
    if not r.ok then rnd.error = r.err or 'recall failed' end
    if rnd.on_change then rnd.on_change() end
  end) then
    rnd.busy = false
  end
end

-- E1 on the run page: step through the remembered iterations. d > 0 goes
-- forward; stepping forward past the newest IMMEDIATELY generates a brand-new
-- random iteration (it does not wait for the 5 s timer) and it becomes the
-- current one. d < 0 steps back through older iterations, recalling each so it
-- is hearddbg. The timer loop is untouched and keeps running throughout.
function rnd.iter_step(d)
  if #rnd.hist == 0 then return end
  if rnd.busy then return end
  if d > 0 then
    if rnd.hist_pos >= #rnd.hist then
      rnd.gen_next()
      return
    end
    rnd.recall(rnd.hist_pos + 1)
  else
    if rnd.hist_pos <= 1 then return end
    rnd.recall(rnd.hist_pos - 1)
  end
end

function rnd.start()
  if rnd.running or rnd.stopping or not (_G and _G.c4rnd_metro) then
    rnd.error = rnd.stopping and 'restore in progress - wait' or (rnd.running and 'already running' or '')
    return
  end
  if not rnd.paused then rnd.tick = 0 end
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
  -- Hold pedal state but reset the countdown to the full 5 s window so the
  -- resume (start/play) begins from a clean full window; stays stopped while
  -- paused (metro stops below).
  rnd.due = os.time() + 5
  rnd.due = os.time() + 5
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