-- monome/drumgen/lib/kit.lua -- the 10-voice kit (no clap).
--
-- A voice is data: id, label, role (what the generator asks for), MIDI note for
-- the external output, engine name for the internal one, plus the two trims the
-- kit page edits - gain and pan.
--
-- `engine` is deliberately EMPTY here. Which engines this norns core actually
-- carries is unverified: monome/docs/drumgen-plan.md records that there is no
-- dust engine directory and no snd_file sample playback, and that engine names
-- can only be listed from inside a running script, so the Phase 0 probe on the
-- device has to fill this in via kit.set_engine(). Guessing names here would
-- ship a kit that is silent on the one machine that can tell us the truth.
--
-- Notes are the familiar GM percussion map so the MIDI-out path lines up with
-- any drum machine or sampler on the other end of the cable.
--
-- Pure Lua 5.1, no norns globals.

local kit = {}

-- The base kit. gain is a linear trim (1.0 = as designed), pan is -1..1.
local BASE = {
  { id = 'kick',   label = 'Kick',      role = 'kick',  note = 36, gain = 1.00, pan =  0.00, vel = 112 },
  { id = 'snare',  label = 'Snare',     role = 'snare', note = 38, gain = 0.85, pan =  0.00, vel = 104 },
  { id = 'rim',    label = 'Rimshot',   role = 'rim',   note = 37, gain = 0.55, pan =  0.20, vel =  70 },
  { id = 'shaker', label = 'Shaker',    role = 'shak',  note = 70, gain = 0.45, pan =  0.30, vel =  54 },
  { id = 'hatc',   label = 'Hat closed',role = 'hatc',  note = 42, gain = 0.55, pan =  0.10, vel =  76 },
  { id = 'hato',   label = 'Hat open',  role = 'hato',  note = 46, gain = 0.50, pan =  0.10, vel =  92 },
  { id = 'ride',   label = 'Ride',      role = 'ride',  note = 51, gain = 0.40, pan = -0.25, vel =  62 },
  { id = 'crash',  label = 'Crash',     role = 'crash', note = 49, gain = 0.45, pan = -0.15, vel = 100 },
  { id = 'toml',   label = 'Tom low',   role = 'tom',   note = 41, gain = 0.70, pan = -0.35, vel =  88 },
  { id = 'tomh',   label = 'Tom high',  role = 'tom',   note = 45, gain = 0.70, pan =  0.35, vel =  88 },
}

-- Hats and cymbals choke each other, like the acoustic instruments they stand
-- in for: an open hat cuts the closed one (choke group 'metal' is cut by a
-- crash, so a fill can end on a crash without the ring stacking up).
local CHOKE = {
  hatc = 'metal',
  hato = 'metal',
  ride = 'metal',
  crash = 'metal',
  tomh = 'tom',
  toml = 'tom',
}

kit.count = function()
  return #BASE
end

-- Working copy: kit.set() trims this, BASE stays pristine for kit.reset().
local voices = {}
for i = 1, #BASE do
  local v = BASE[i]
  voices[i] = {
    id = v.id, label = v.label, role = v.role, note = v.note,
    gain = v.gain, pan = v.pan, vel = v.vel,
    engine = nil,
    choke = CHOKE[v.id],
    lane = i,
  }
end

-- Every voice, in lane order. The result is the live table, not a copy.
function kit.voices()
  return voices
end

-- lane -> voice, 1-based like the pattern grid.
function kit.at(lane)
  local v = voices[lane]
  if not v then error(string.format('kit: lane %s out of range 1..%d', tostring(lane), #voices)) end
  return v
end

function kit.index(id)
  for i = 1, #voices do
    if voices[i].id == id then return i end
  end
  return nil
end

function kit.get(id)
  local i = kit.index(id)
  return i and voices[i] or nil
end

function kit.id_at(lane)
  return kit.at(lane).id
end

function kit.role_at(lane)
  return kit.at(lane).role
end

function kit.note_at(lane)
  return kit.at(lane).note
end

function kit.choke_at(lane)
  return kit.at(lane).choke
end

-- All lanes sharing a role, ascending. The generator uses it for the roles with
-- more than one voice (two toms, so a fill can ramp between them).
function kit.by_role(role)
  local out = {}
  for i = 1, #voices do
    if voices[i].role == role then out[#out + 1] = i end
  end
  return out
end

-- First lane for a role, or nil when the role is not in the kit. The generator
-- skips a voice it cannot find instead of failing a bar mid-performance.
function kit.lane_for(role)
  return kit.by_role(role)[1]
end

local function clamp(v, lo, hi, name)
  if type(v) ~= 'number' or v ~= v then
    error('kit: ' .. name .. ' must be a number, got ' .. tostring(v))
  end
  if v < lo then return lo end
  if v > hi then return hi end
  return v
end

-- set(id, field, value) for the editable trims; returns the voice.
function kit.set(id, field, value)
  local v = kit.get(id)
  if not v then error('kit: no voice with id ' .. tostring(id)) end
  if field == 'gain' then
    v.gain = clamp(value, 0, 1, 'gain')
  elseif field == 'pan' then
    v.pan = clamp(value, -1, 1, 'pan')
  elseif field == 'vel' then
    v.vel = math.floor(clamp(value, 1, 127, 'vel') + 0.5)
  else
    error('kit: field ' .. tostring(field) .. ' is not editable')
  end
  return v
end

-- Called by the device layer once audio.engine_names() has been read on the
-- norns; an unknown engine name is rejected here rather than at playback.
function kit.set_engine(id, name)
  local v = kit.get(id)
  if not v then error('kit: no voice with id ' .. tostring(id)) end
  if name == nil then
    v.engine = nil
  elseif type(name) ~= 'string' or name == '' then
    error('kit: engine name must be a non-empty string or nil')
  else
    v.engine = name
  end
  return v
end

function kit.reset()
  for i = 1, #voices do
    voices[i].gain = BASE[i].gain
    voices[i].pan = BASE[i].pan
    voices[i].vel = BASE[i].vel
    voices[i].engine = nil
  end
  return voices
end

-- Lane that triggers every voice in a choke group when `lane` fires, excluding
-- lane itself. Returns nil when the voice chokes nothing.
function kit.choked_by(lane)
  local v = kit.at(lane)
  if not v.choke then return nil end
  local out = {}
  for i = 1, #voices do
    if i ~= lane and voices[i].choke == v.choke then out[#out + 1] = i end
  end
  if #out == 0 then return nil end
  return out
end

-- Self-check for the tests and for the kit page: 10 voices, unique ids, unique
-- notes, no clap, gains and pans in range. Returns true or fails loudly.
function kit.assert_valid()
  if #voices ~= 10 then
    error(string.format('kit: expected 10 voices, got %d', #voices))
  end
  local ids, notes = {}, {}
  for i = 1, #voices do
    local v = voices[i]
    if v.id == 'clap' then error('kit: the clap is not in this kit') end
    if ids[v.id] then error('kit: duplicate voice id ' .. v.id) end
    ids[v.id] = true
    if notes[v.note] then
      error(string.format('kit: %s and %s share MIDI note %d', notes[v.note], v.id, v.note))
    end
    notes[v.note] = v.id
    if v.gain < 0 or v.gain > 1 then error('kit: ' .. v.id .. ' gain out of range') end
    if v.pan < -1 or v.pan > 1 then error('kit: ' .. v.id .. ' pan out of range') end
    if v.note < 0 or v.note > 127 then error('kit: ' .. v.id .. ' note out of range') end
  end
  return true
end

return kit