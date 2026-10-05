-- A 128x64 pixel screen that knows nothing about norns.
--
-- Levels are 0..15, matching the norns display: 0 is off, 15 is full brightness.
-- Nothing here touches a global `screen`. The device adapter diffs the dirty
-- rectangles and pushes them with screen.pixel()/screen.update(); the browser
-- reads get() to paint one ImageData. Both see the same pixels because both
-- read the same buffer.
--
-- Deliberately norns-free: no screen, no _menu, no clock. This file is the only
-- thing that knows how a pixel is stored, which is what makes the browser view
-- and the device view provably the same picture.

local font = require 'font6x8'

local M = {}

M.WIDTH = 128
M.HEIGHT = 64
M.MAX_LEVEL = 15

-- Levels arrive as numbers from the generator and from callers, so they are
-- rounded to an integer here rather than trusted. math.round does not exist in
-- Lua 5.1 or LuaJIT (the device), so it is spelled out.
local function clamp_level(level)
  level = math.floor((level or 0) + 0.5)
  return math.max(0, math.min(M.MAX_LEVEL, level))
end

function M.new(width, height)
  local w = width or M.WIDTH
  local h = height or M.HEIGHT
  -- min_x/min_y/max_x/max_y are deliberately absent: nil means nothing is dirty,
  -- which is what is_dirty() and take_dirty() key off.
  local self = {
    width = w,
    height = h,
    pixels = {},
    -- dirty rect list, in paint order
    rects = {},
  }
  for i = 1, w * h do self.pixels[i] = 0 end
  -- the drawing functions live on M, so an instance needs them as methods too;
  -- without this `sb:set(...)` would not resolve on a screen from new()
  for name, fn in pairs(M) do
    if type(fn) == 'function' and self[name] == nil then self[name] = fn end
  end
  return self
end

local function inside(self, x, y)
  return x >= 0 and y >= 0 and x < self.width and y < self.height
end

function M.get(self, x, y)
  if not inside(self, x, y) then return 0 end
  return self.pixels[y * self.width + x + 1]
end

-- Fold a drawn area into the dirty bounds. The rect list keeps paint order, so
-- these bounds are only ever the union of everything drawn - never an order.
local function mark(self, x0, y0, x1, y1)
  x0, y0 = math.max(0, x0), math.max(0, y0)
  x1, y1 = math.min(self.width - 1, x1), math.min(self.height - 1, y1)
  if x1 < x0 or y1 < y0 then return end
  if not self.min_x then
    self.min_x, self.min_y, self.max_x, self.max_y = x0, y0, x1, y1
  else
    self.min_x = math.min(self.min_x, x0)
    self.min_y = math.min(self.min_y, y0)
    self.max_x = math.max(self.max_x, x1)
    self.max_y = math.max(self.max_y, y1)
  end
end

function M.rect(self, x, y, w, h)
  self.rects[#self.rects + 1] = { x = x, y = y, w = w, h = h }
  mark(self, x, y, x + w - 1, y + h - 1)
end

function M.set(self, x, y, level)
  if not inside(self, x, y) then return false end
  level = clamp_level(level)
  local i = y * self.width + x + 1
  if self.pixels[i] == level then return false end
  self.pixels[i] = level
  self:rect(x, y, 1, 1)
  return true
end

function M.clear(self, level)
  level = clamp_level(level)
  for i = 1, self.width * self.height do
    if self.pixels[i] ~= level then self.pixels[i] = level end
  end
  self:rect(0, 0, self.width, self.height)
end

function M.fill(self, x, y, w, h, level)
  for py = y, y + h - 1 do
    for px = x, x + w - 1 do
      self:set(px, py, level)
    end
  end
end

function M.hline(self, x, y, w, level)
  for px = x, x + w - 1 do self:set(px, y, level) end
end

function M.vline(self, x, y, h, level)
  for py = y, y + h - 1 do self:set(x, py, level) end
end

function M.line(self, x0, y0, x1, y1, level)
  -- Bresenham, so no per-diagonal test and no float
  local dx = math.abs(x1 - x0)
  local dy = -math.abs(y1 - y0)
  local sx = x0 < x1 and 1 or -1
  local sy = y0 < y1 and 1 or -1
  local err = dx + dy
  while true do
    self:set(x0, y0, level)
    if x0 == x1 and y0 == y1 then break end
    local e2 = 2 * err
    if e2 >= dy then err = err + dy; x0 = x0 + sx end
    if e2 <= dx then err = err + dx; y0 = y0 + sy end
  end
end

-- Draw one char, left edge at x. Returns the x of the next cell, so callers can
-- loop without recomputing the advance.
function M.char(self, x, y, ch, level)
  local columns = font.glyph(ch) or font.glyph('?')
  for col = 0, font.WIDTH - 1 do
    local bits = columns[col + 1]
    if bits then
      for row = 0, font.HEIGHT - 1 do
        if bits & (1 << row) ~= 0 then
          self:set(x + col, y + row, level)
        end
      end
    end
  end
  return x + font.WIDTH
end

function M.text(self, x, y, str, level)
  level = level or M.MAX_LEVEL
  for i = 1, #str do
    x = self:char(x, y, str:sub(i, i), level)
  end
  return x
end

function M.text_right(self, right, y, str, level)
  return self:text(right - font.width(str), y, str, level)
end

function M.text_center(self, y, str, level)
  return self:text(math.floor((self.width - font.width(str)) / 2), y, str, level)
end

-- The dirty rectangles accumulated since the last call, plus the bounds. Reading
-- them clears the list: the device adapter flushes to the display, the browser
-- just needs to know there is something new, and both then continue drawing.
function M.take_dirty(self)
  local rects = self.rects
  local bounds = nil
  if self.min_x then
    bounds = {
      x = self.min_x,
      y = self.min_y,
      w = self.max_x - self.min_x + 1,
      h = self.max_y - self.min_y + 1,
    }
  end
  self.rects = {}
  self.min_x, self.min_y, self.max_x, self.max_y = nil, nil, nil, nil
  return rects, bounds
end

function M.is_dirty(self)
  return self.min_x ~= nil
end

-- One character per pixel, '.' for level 0 and '#' for anything lit. A screen
-- assertable as plain text: a diff of this IS a picture of what changed, which
-- is what monome/test/test_screen.lua compares.
function M.to_ascii(self, x, y, w, h)
  x = x or 0
  y = y or 0
  w = w or (self.width - x)
  h = h or (self.height - y)
  local lines = {}
  for py = y, y + h - 1 do
    local row = {}
    for px = x, x + w - 1 do
      row[#row + 1] = self:get(px, py) > 0 and '#' or '.'
    end
    lines[#lines + 1] = table.concat(row)
  end
  return table.concat(lines, '\n')
end

return M