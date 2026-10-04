-- lib/inswap.lua -- swap a preset body between "follows input 1" and
-- "follows input 2" (in-place, on the raw 128-byte body).
--
-- The C4 stores the input choice in several independent places, so a preset
-- only behaves as "input 1" or "input 2" when all of them agree. Byte values
-- below were read off all 128 flash presets on the device (2026-10-04), not
-- guessed:
--   * full-scale gain / mix is 0xfe (254): mix sits at 254 in 116 of 128
--     presets and never at 255; 0x00 is 0%.
--   * envelope1_input / envelope2_input are 4-bit fields, but only bit 1
--     selects the input - every input-2 patch on the pedal has bit 1 set
--     (nibble 2 or 3) and every input-1 patch has it clear (nibble 0, 8, 12).
--     c4Model.js names the field with just two options (0/1), which does not
--     match what the hardware writes, so we set/clear bit 1 and leave the rest
--     of the nibble untouched.
--   * pitch_detect_input is a plain 1-bit field: 0 = input 1, 1 = input 2.
--   * mix1/mix2 destination 1 = "Out 1 + Out 2".
--
-- Pure Lua (no norns globals) so it can be exercised on-device against a real
-- body without the UI; row numbers are resolved by name from c4model so a
-- regenerated decoder cannot silently shift them.

local c4model = require 'c4model'

local inswap = {}

local FULL = 254   -- the pedal's own 100%
local ZERO = 0
local MIX_BOTH = 1 -- "Out 1 + Out 2"

local function rownum(name)
  for i = 1, c4model.count() do
    local r = c4model.row(i)
    if r and r.name == name then return i end
  end
  error('inswap: unknown control row ' .. name)
end

local R = {
  input1_gain = rownum('input1_gain'),
  input2_gain = rownum('input2_gain'),
  mix = rownum('mix'),
  lo_retain = rownum('lo_retain'),
  mix1_dest = rownum('mix1_destination'),
  mix2_dest = rownum('mix2_destination'),
  env1_input = rownum('envelope1_input'),
  env2_input = rownum('envelope2_input'),
  pitch_input = rownum('pitch_detect_input'),
}

-- bit 1 of a 0..15 field value (Lua 5.1: no bitwise ops)
local function bit1(v)
  return math.floor(v / 2) % 2
end

-- The state a preset is currently in, read from envelope 1 (bit 1 of the
-- envelope-input field).
function inswap.is_input2(body)
  return bit1(c4model.raw(body, R.env1_input)) == 1
end

-- The state a preset will be in after apply/toggle.
function inswap.state_name(to2)
  return to2 and 'input 2' or 'input 1'
end

-- Force the envelope-input fields to follow `to2`, keeping every other bit of
-- the 4-bit field as it is.
local function set_env_input(body, row, to2)
  local v = c4model.raw(body, row)
  if to2 then
    v = v + (bit1(v) == 0 and 2 or 0)
  else
    v = v - (bit1(v) == 1 and 2 or 0)
  end
  c4model.set(body, row, v)
end

-- Write the complete two-state definition. Returns body.
function inswap.apply(body, to2)
  c4model.set(body, R.input1_gain, to2 and ZERO or FULL)
  c4model.set(body, R.input2_gain, to2 and FULL or ZERO)
  set_env_input(body, R.env1_input, to2)
  set_env_input(body, R.env2_input, to2)
  c4model.set(body, R.pitch_input, to2 and 1 or 0)
  -- same in both states
  c4model.set(body, R.mix, FULL)
  c4model.set(body, R.lo_retain, ZERO)
  c4model.set(body, R.mix1_dest, MIX_BOTH)
  c4model.set(body, R.mix2_dest, MIX_BOTH)
  return body
end

-- Flip to the other state; returns to2 (the state now in the body).
function inswap.toggle(body)
  local to2 = not inswap.is_input2(body)
  inswap.apply(body, to2)
  return to2
end

-- Human-readable check of the nine fields this module owns, for the settings
-- page / debugging.
function inswap.describe(body)
  return string.format(
    'g1=%d g2=%d mix=%d lo=%d env1=%d env2=%d pitch=%d out1=%d out2=%d',
    c4model.raw(body, R.input1_gain),
    c4model.raw(body, R.input2_gain),
    c4model.raw(body, R.mix),
    c4model.raw(body, R.lo_retain),
    c4model.raw(body, R.env1_input),
    c4model.raw(body, R.env2_input),
    c4model.raw(body, R.pitch_input),
    c4model.raw(body, R.mix1_dest),
    c4model.raw(body, R.mix2_dest))
end

return inswap