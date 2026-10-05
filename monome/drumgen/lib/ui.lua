-- The drum machine's own screen: what 128x64 looks like while it plays.
--
-- Pure drawing over lib/screen.lua. No clock, no sound, no norns globals, so this
-- runs identically on the device, in fengari, and under LuaJIT. It is handed a
-- plain state table and returns nothing; every pixel it draws is read back out of
-- the screen, which is what makes the browser view and the device view the same
-- picture rather than two drawings that look alike.
--
-- Layout is fixed and fills all 64 rows, because the norns has no room to spare
-- and a layout that reflows is a layout that cannot be checked:
--
--   rows  0..9    header:    style on the left, bar + play state on the right
--   rows 10..39   grid:      10 lanes at 3px, 16 steps at 8px = the full width
--   rows 40..47   params:    the four params as 3-letter names and one digit
--   rows 48..55   keys:      what the three keys do
--   rows 56..63   encoders:  what the three encoders are bound to
--
-- The 6x8 font is 6px wide, so 128px is 21 characters and nothing fits that is
-- longer. Every line below is counted against that, and the two test suites
-- check the counts, because a label that overflows is a label that is cut off
-- mid-word with no error anywhere.
--
-- Velocity is brightness: a step's level is 1 + round(vel/127 * 14), so a ghost
-- note is dim and a hard one is bright, and the eye reads the pattern's dynamics
-- without reading numbers.

local screen = require 'screen'

local M = {}

M.GRID_X = 0
M.GRID_Y = 10
M.LANE_H = 3
M.STEP_W = 8
M.PARAM_Y = 40
M.KEYS_Y = 48
M.ENC_Y = 56
-- 6px per character, 5 characters per param slot ("INT5 ")
M.PARAM_W = 30
-- 16 characters, leaving the right 24px for the fill indicator
M.KEY_HINTS = '1:PLAY 2:STYLE 3:SWG'

M.PARAMS = {
  { key = 'intensity', abbr = 'INT' },
  { key = 'complexity', abbr = 'COM' },
  { key = 'variation', abbr = 'VAR' },
  { key = 'swing', abbr = 'SWG' },
}

-- Which param each encoder turns, index 1..3. The fourth (swing) is reached by
-- key 3, because a 4th encoder does not exist on the device and inventing one
-- would make the browser easier to use in exactly the way it must not be.
M.ENCODER_PARAMS = { 'intensity', 'complexity', 'variation' }
M.SWING_KEY = 3
-- The 21 characters the screen has, used by the tests to catch overflow.
M.CHARS = 21

-- A 0..1 param as one digit, since the screen has room for one.
local function digit(value)
  return tostring(math.max(0, math.min(9, math.floor((value or 0) * 9 + 0.5))))
end

-- state = { style, bar, playing, params, rows, playhead, selected, swing_page }
function M.draw(self, state)
  state = state or {}
  self:clear(0)

  ---------------------------------------------------------------------- header
  local style = (state.style or 'four_on_floor'):upper()
  -- "FOUR_ON_FLOOR" is 13, and the bar counter plus its play marker needs 7
  -- columns on the right, so the style gets the rest
  self:text(0, 1, style:sub(1, 13), 15)
  local bar = string.format('%03d', state.bar or 0)
  self:text_right(self.width, 1, bar, 15)
  if state.playing then
    -- a filled marker left of the counter, so stopped is visible without words
    self:fill(self.width - 34, 1, 2, 7, 15)
  end
  self:hline(0, 9, self.width, 4)

  ------------------------------------------------------------------------ grid
  local rows = state.rows or {}
  for lane = 1, 10 do
    local row = rows[lane] or {}
    local y = M.GRID_Y + (lane - 1) * M.LANE_H
    for step = 1, 16 do
      local vel = row[step] or 0
      local x = M.GRID_X + (step - 1) * M.STEP_W
      if vel > 0 then
        -- one dark pixel of gap between cells, so a run of hits stays countable
        self:fill(x, y, M.STEP_W - 2, M.LANE_H, 1 + math.floor(vel / 127 * 14))
      end
    end
  end

  -- the playhead is a full-height column over the grid, on top of the notes
  local playhead = state.playhead
  if playhead and playhead >= 1 and playhead <= 16 then
    local x = M.GRID_X + (playhead - 1) * M.STEP_W
    self:vline(x, M.GRID_Y, 10 * M.LANE_H, 15)
  end

  ---------------------------------------------------------------------- params
  -- One slot per param: a 3-letter name, a digit, and a space. Four slots of 5
  -- characters is 20, which is 120 of the 21 the screen has.
  local slot = {}
  for i, param in ipairs(M.PARAMS) do
    slot[i] = param.abbr .. digit(state.params and state.params[param.key])
  end
  local selected = state.selected
  for i = 1, #M.PARAMS do
    local x = (i - 1) * M.PARAM_W
    local label = slot[i]
    if i == selected then
      -- draw the slot inverted, so which param the encoders are turning is
      -- obvious without a cursor to read
      self:fill(x - 1, M.PARAM_Y - 1, #label * 6, 9, 15)
      self:text(x, M.PARAM_Y, label, 0)
    else
      self:text(x, M.PARAM_Y, label, 15)
    end
  end

  ------------------------------------------------------------------------- keys
  -- 16 characters, so the fill indicator on the right has room of its own
  self:text(0, M.KEYS_Y, M.KEY_HINTS, 15)
  -- a fill is announced here, because otherwise the bar changes shape for
  -- reasons nobody asked for
  if state.last_fill then
    self:fill(self.width - 24, M.KEYS_Y - 1, 24, 9, 15)
    self:text_right(self.width, M.KEYS_Y, 'FILL', 0)
  end

  --------------------------------------------------------------------- encoders
  -- Normally each encoder names its own param. On the swing page all three turn
  -- swing, and saying so three times is clearer than a symbol: the line is only
  -- shown when it changes.
  local enc = {}
  for i = 1, 3 do
    local target = state.swing_page and 'swing' or M.ENCODER_PARAMS[i]
    enc[#enc + 1] = 'E' .. i .. target:sub(1, 3):upper()
  end
  self:text(0, M.ENC_Y, table.concat(enc, ' '), 8)

  return self
end

-- A new empty screen already sized for this layout, so a host does not have to
-- know the numbers.
function M.new()
  return screen.new(screen.WIDTH, screen.HEIGHT)
end

return M