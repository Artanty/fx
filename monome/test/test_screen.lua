-- monome/test/test_screen.lua -- the framebuffer, the font, and the layout.
--
-- Goldens here are 128x64 screens printed one character per pixel, so a failing
-- diff is a picture of what moved rather than a number nobody reads. That is the
-- whole reason the screen is tested this way: a wrong pixel has to be visible.
--
-- The font is hand-authored, because there is no hardware here to capture from.
-- The metrics are the device's (5x7 in a 6x8 cell, six pixel advance), so layout
-- written against this file transfers unchanged, but individual glyph shapes may
-- differ from the firmware font. When hardware is back, tools/capture_font.lua
-- replaces font6x8.lua's GLYPHS and these goldens show exactly which glyphs
-- moved - which is the point of testing the screen as text.

-- A golden row is 128 characters of picture plus quoting, so the 100 column limit
-- does not apply here. The line-length rule is about code, not about art.
-- luacheck: max_line_length 200

local t = require 'harness'
local screen = require 'screen'
local font = require 'font6x8'
local ui = require 'ui'

local W, H = screen.WIDTH, screen.HEIGHT

t.suite('the framebuffer', function()
  t.test('new is 128x64 and blank', function()
    local s = screen.new()
    t.eq(128, s.width)
    t.eq(64, s.height)
    t.eq(string.rep(string.rep('.', 128) .. '\n', 63) .. string.rep('.', 128), s:to_ascii())
  end)

  t.test('levels are clamped to 0..15', function()
    local s = screen.new()
    s:set(0, 0, 99)
    s:set(1, 0, -5)
    s:set(2, 0, 15)
    s:set(3, 0, 7.6)
    t.eq(15, s:get(0, 0), 'above range clamps to 15')
    t.eq(0, s:get(1, 0), 'below range clamps to 0')
    t.eq(15, s:get(2, 0))
    t.eq(8, s:get(3, 0), 'rounds to nearest')
  end)

  t.test('writes outside the screen are ignored, not errors', function()
    local s = screen.new()
    t.falsy(s:set(-1, 0, 5))
    t.falsy(s:set(0, -1, 5))
    t.falsy(s:set(128, 0, 5))
    t.falsy(s:set(0, 64, 5))
    t.eq(0, s:get(500, 500))
  end)

  t.test('setting the same level twice reports no change', function()
    local s = screen.new()
    t.truthy(s:set(10, 10, 5))
    t.falsy(s:set(10, 10, 5), 'no change means no dirty rect either')
    t.truthy(s:set(10, 10, 6))
  end)

  t.test('fill draws a solid block', function()
    local s = screen.new()
    s:fill(2, 2, 4, 3, 9)
    t.eq(table.concat({
      '........',
      '........',
      '..####..',
      '..####..',
      '..####..',
      '........',
      '........',
    }, '\n'), s:to_ascii(0, 0, 8, 7))
  end)

  t.test('hline and vline', function()
    local s = screen.new()
    s:hline(0, 0, 4, 7)
    s:vline(0, 1, 3, 7)
    t.eq(table.concat({
      '####.',
      '#....',
      '#....',
      '#....',
    }, '\n'), s:to_ascii(0, 0, 5, 4))
  end)

  t.test('line draws a diagonal with Bresenham', function()
    local s = screen.new()
    s:line(0, 0, 3, 3, 15)
    s:line(0, 4, 3, 4, 15)
    t.eq(table.concat({
      '#...',
      '.#..',
      '..#.',
      '...#',
      '####',
    }, '\n'), s:to_ascii(0, 0, 4, 5))
  end)

  t.test('dirty bounds cover everything drawn', function()
    local s = screen.new()
    t.falsy(s:is_dirty(), 'a new screen has nothing to flush')
    s:set(4, 4, 1)
    s:set(20, 10, 1)
    local _, bounds = s:take_dirty()
    t.eq(4, bounds.x)
    t.eq(4, bounds.y)
    t.eq(17, bounds.w, 'x 4..20 inclusive is 17 wide')
    t.eq(7, bounds.h, 'y 4..10 inclusive is 7 tall')
    t.falsy(s:is_dirty(), 'taking the dirty list clears it')
  end)

  t.test('a draw entirely off-screen does not mark anything dirty', function()
    local s = screen.new()
    s:fill(200, 200, 10, 10, 5)
    t.falsy(s:is_dirty())
  end)

  t.test('text advances six pixels per char', function()
    local s = screen.new()
    t.eq(12, s:text(0, 0, 'AB', 15), 'returns the x after the string')
    t.eq(12, s:text_right(12, 8, 'AB', 15), 'right-aligned ends at the right edge')
    -- centred two chars (12px) on 128: floor((128 - 12) / 2) = 58, ending at 70
    t.eq(70, s:text_center(16, 'AB', 15))
  end)
end)

t.suite('the 6x8 font', function()
  t.test('cell metrics match the norns face', function()
    t.eq(6, font.WIDTH)
    t.eq(8, font.HEIGHT)
    t.eq(5, font.GLYPH_WIDTH)
    t.eq(7, font.GLYPH_HEIGHT)
    t.eq(18, font.width('abc'))
  end)

  t.test('a 21 char line fits 128 pixels', function()
    -- this is why the advance is six: 21 * 6 = 126 <= 128
    t.truthy(font.width(string.rep('x', 21)) <= W)
    t.truthy(font.width(string.rep('x', 22)) > W)
  end)

  t.test('lowercase shares the uppercase glyph', function()
    t.eq(font.glyph('A'), font.glyph('a'))
    t.eq(font.glyph('Q'), font.glyph('q'))
  end)

  t.test('an unmapped char has no glyph so it draws blank, not wrong', function()
    t.eq(nil, font.glyph('\1'))
  end)

  t.test('glyph bits are columns, bit 0 is the top row', function()
    local c = font.glyph('|')
    t.eq(font.WIDTH, #c)
    -- a vertical bar is one lit column, all seven rows, and the sixth column is
    -- the inter-letter gap
    t.eq(0x7f, c[3])
    t.eq(0, c[6])
  end)

  -- 32 chars * 6px = 192px, so this runs off the right edge deliberately: what
  -- is asserted is the part that fits, clipped at 128.
  t.test('golden: punctuation and digits', function()
    local s = screen.new()
    s:text(0, 0, ' !"#$%&\'()*+,-./0123456789:;<=>?', 15)
    t.eq(table.concat({
      '........#....#.#...#.#....#...##.....##.....#......#...#......................................#..###....#....###..#####....#..##',
      '........#....#.#...#.#...####.##..#.#..#....#.....#.....#...#.#.#...#........................#..#...#..##...#...#....#....##..#.',
      '........#.........#####.#.#......#...##..........#.......#...###....#.......................#...#..##...#.......#...#....#.#..##',
      '........#..........#.#...###....#....##..........#.......#..#####.#####.......#####.........#...#.#.#...#......#.....#..#..#....',
      '........#.........#####...#.#..#....#..#.........#.......#...###....#....##................#....##..#...#.....#.......#.#####...',
      '...................#.#..####..#..##.#..#..........#.....#...#.#.#...#.....#..........##...#.....#...#...#....#....#...#....#..#.',
      '........#..........#.#....#......##..##.#..........#...#.................#...........##...#......###...###..#####..###.....#...#',
      '................................................................................................................................'
    }, '\n'), s:to_ascii(0, 0, 128, 8))
  end)

  -- 26 chars * 6 = 156px > 128, so the tail is clipped off.
  t.test('golden: the uppercase alphabet', function()
    local s = screen.new()
    s:text(0, 0, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 15)
    t.eq(table.concat({
      '.###..####...###..###...#####.#####..###..#...#..###....###.#...#.#.....#...#.#...#..###..####...###..####...####.#####.#...#.#.',
      '#...#.#...#.#...#.#..#..#.....#.....#...#.#...#...#......#..#..#..#.....##.##.##..#.#...#.#...#.#...#.#...#.#.......#...#...#.#.',
      '#...#.#...#.#.....#...#.#.....#.....#.....#...#...#......#..#.#...#.....#.#.#.#.#.#.#...#.#...#.#...#.#...#.#.......#...#...#.#.',
      '#####.####..#.....#...#.####..####..#.###.#####...#......#..##....#.....#...#.#..##.#...#.####..#...#.####...###....#...#...#.#.',
      '#...#.#...#.#.....#...#.#.....#.....#...#.#...#...#......#..#.#...#.....#...#.#...#.#...#.#.....#.#.#.#.#.......#...#...#...#.#.',
      '#...#.#...#.#...#.#..#..#.....#.....#...#.#...#...#...#..#..#..#..#.....#...#.#...#.#...#.#.....#..#..#..#......#...#...#...#..#',
      '#...#.####...###..###...#####.#......###..#...#..###...##...#...#.#####.#...#.#...#..###..#......##.#.#...#.####....#....###....',
      '................................................................................................................................'
    }, '\n'), s:to_ascii(0, 0, 128, 8))
  end)
end)

t.suite('the drum machine layout', function()
  -- The whole 128x64 screen. This is the golden that matters: if the layout
  -- moves, the diff is a picture of what moved.
  t.test('golden: playing, four on the floor', function()
    local s = ui.new()
    ui.draw(s, {
      style = 'four_on_floor',
      bar = 4,
      playing = true,
      params = { intensity = 0.5, complexity = 0.5, variation = 0.5, swing = 0 },
      rows = { { 112, 0, 0, 0, 112, 0, 0, 0, 112, 0, 0, 0, 108, 0, 0, 0 } },
      playhead = 6,
      selected = 2,
    })
    t.eq(table.concat({
      '................................................................................................................................',
      '#####..###..#...#.####.........###..#...#.......#####.#......###...###..####..................##...............###...###.....#..',
      '#.....#...#.#...#.#...#.......#...#.##..#.......#.....#.....#...#.#...#.#...#.................##..............#...#.#...#...##..',
      '#.....#...#.#...#.#...#.......#...#.#.#.#.......#.....#.....#...#.#...#.#...#.................##..............#..##.#..##..#.#..',
      '####..#...#.#...#.####........#...#.#..##.......####..#.....#...#.#...#.####..................##..............#.#.#.#.#.#.#..#..',
      '#.....#...#.#...#.#.#.........#...#.#...#.......#.....#.....#...#.#...#.#.#...................##..............##..#.##..#.#####.',
      '#.....#...#.#...#.#..#........#...#.#...#.......#.....#.....#...#.#...#.#..#..................##..............#...#.#...#....#..',
      '#......###...###..#...#.#####..###..#...#.#####.#.....#####..###...###..#...#.................##...............###...###.....#..',
      '................................................................................................................................',
      '################################################################################################################################',
      '######..........................######..#.......................######..........................######..........................',
      '######..........................######..#.......................######..........................######..........................',
      '######..........................######..#.......................######..........................######..........................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '........................................#.......................................................................................',
      '.............................########################...........................................................................',
      '.###..#...#.#####.#####......##...###...##.###.#............#...#..###..####..#####........####.#...#..###...###................',
      '..#...##..#...#...#..........#.###.#.###.#..#..#.####.......#...#.#...#.#...#.#...........#.....#...#.#...#.#...#...............',
      '..#...#.#.#...#...####.......#.#####.###.#.#.#.#....#.......#...#.#...#.#...#.####........#.....#...#.#.....#..##...............',
      '..#...#..##...#.......#......#.#####.###.#.###.#####........#...#.#####.####......#........###..#.#.#.#.###.#.#.#...............',
      '..#...#...#...#.......#......#.#####.###.#.###.#####........#...#.#...#.#.#.......#...........#.#.#.#.#...#.##..#...............',
      '..#...#...#...#...#...#......#.###.#.###.#.###.#.###.........#.#..#...#.#..#..#...#...........#.##.##.#...#.#...#...............',
      '.###..#...#...#....###.......##...###...##.###.##...#.........#...#...#.#...#..###........####..#...#..###...###................',
      '.............................########################...........................................................................',
      '..#.........####..#......###..#...#........###.........####.#####.#...#.#.....#####.......#####........####.#...#..###..........',
      '.##....##...#...#.#.....#...#.#...#.......#...#..##...#.......#...#...#.#.....#..............#...##...#.....#...#.#...#.........',
      '..#....##...#...#.#.....#...#..#.#............#..##...#.......#....#.#..#.....#.............#....##...#.....#...#.#.............',
      '..#.........####..#.....#####...#............#.........###....#.....#...#.....####...........#.........###..#.#.#.#.###.........',
      '..#....##...#.....#.....#...#...#...........#....##.......#...#.....#...#.....#...............#..##.......#.#.#.#.#...#.........',
      '..#....##...#.....#.....#...#...#..........#.....##.......#...#.....#...#.....#...........#...#..##.......#.##.##.#...#.........',
      '.###........#.....#####.#...#...#.........#####.......####....#.....#...#####.#####........###........####..#...#..###..........',
      '................................................................................................................................',
      '#####...#....###..#...#.#####.......#####..###...###...###..#...#.......#####.#####.#...#..###..####............................',
      '#......##.....#...##..#...#.........#.....#...#.#...#.#...#.##.##.......#........#..#...#.#...#.#...#...........................',
      '#.......#.....#...#.#.#...#.........#.........#.#.....#...#.#.#.#.......#.......#...#...#.#...#.#...#...........................',
      '####....#.....#...#..##...#.........####.....#..#.....#...#.#...#.......####.....#..#...#.#####.####............................',
      '#.......#.....#...#...#...#.........#.......#...#.....#...#.#...#.......#.........#.#...#.#...#.#.#.............................',
      '#.......#.....#...#...#...#.........#......#....#...#.#...#.#...#.......#.....#...#..#.#..#...#.#..#............................',
      '#####..###...###..#...#...#.........#####.#####..###...###..#...#.......#####..###....#...#...#.#...#...........................',
      '................................................................................................................................',
}, '\n'), s:to_ascii())
  end)

  t.test('a stopped screen shows no play marker', function()
    local playing = ui.new()
    ui.draw(playing, { style = 'breakbeat', bar = 1, playing = true, params = {}, rows = {} })
    local stopped = ui.new()
    ui.draw(stopped, { style = 'breakbeat', bar = 1, playing = false, params = {}, rows = {} })
    t.truthy(
      playing:to_ascii(88, 0, 40, 8) ~= stopped:to_ascii(88, 0, 40, 8),
      'the marker area differs, so play state is visible without words')
  end)

  t.test('the selected param is inverted', function()
    local one = ui.new()
    ui.draw(one, {
      params = { intensity = 0.5, complexity = 0.5, variation = 0.5, swing = 0 },
      selected = 1,
      rows = {},
    })
    local two = ui.new()
    ui.draw(two, {
      params = { intensity = 0.5, complexity = 0.5, variation = 0.5, swing = 0 },
      selected = 2,
      rows = {},
    })
    t.truthy(one:to_ascii(0, ui.PARAM_Y, 60, 9) ~= two:to_ascii(0, ui.PARAM_Y, 60, 9))
  end)

  t.test('each param gets its own slot, and the digit in it is its own value', function()
    -- A param row that overlaps itself still looks like numbers, so this checks
    -- the pixels: each slot must match that param's label drawn on its own.
    local keys = {}
    for i, param in ipairs(ui.PARAMS) do keys[i] = param.key end
    for i, value in ipairs({ 1, 0.5, 0, 0.25 }) do
      local params = {}
      for _, key in ipairs(keys) do params[key] = 0 end
      params[keys[i]] = value
      local drawn = ui.new()
      -- selected = 0 so nothing is drawn inverted, which would hide a digit
      ui.draw(drawn, { params = params, rows = {}, selected = 0 })
      for slot = 1, 4 do
        local x = (slot - 1) * ui.PARAM_W
        local want = screen.new()
        local digit = tostring(math.floor(params[keys[slot]] * 9 + 0.5))
        want:text(x, ui.PARAM_Y, ui.PARAMS[slot].abbr .. digit, 15)
        t.eq(want:to_ascii(x, ui.PARAM_Y, 24, 8),
          drawn:to_ascii(x, ui.PARAM_Y, 24, 8),
          'slot ' .. slot .. ' holds only ' .. keys[slot])
      end
    end
  end)

  t.test('the params line never touches the keys line above the divider', function()
    local s = ui.new()
    ui.draw(s, { params = { intensity = 1, complexity = 1, variation = 1, swing = 1 } })
    -- row 39 is blank, row 40 starts the params: if a label ever grew past its
    -- slot it would land in the grid, which is the failure worth catching
    for x = 0, 127 do
      t.eq(0, s:get(x, ui.PARAM_Y - 1), 'column ' .. x .. ' above the params is blank')
    end
  end)

  t.test('the key hints and encoder names are legible, not clipped', function()
    local s = ui.new()
    ui.draw(s, { params = {} })
    for _, line in ipairs({ { ui.KEYS_Y, ui.KEY_HINTS } }) do
      t.truthy(#line[2] <= ui.CHARS,
        line[2] .. ' is ' .. #line[2] .. ' chars, the screen holds ' .. ui.CHARS)
      local reference = screen.new()
      reference:text(0, line[1], line[2], 15)
      t.eq(reference:to_ascii(0, line[1], 128, 8), s:to_ascii(0, line[1], 128, 8),
        line[2] .. ' draws in full')
    end
  end)

  t.test('the encoder line names all three, and names swing on the swing page', function()
    local off = ui.new()
    ui.draw(off, { params = {}, rows = {} })
    local on = ui.new()
    ui.draw(on, { params = {}, rows = {}, swing_page = true })
    local text = off:to_ascii(0, ui.ENC_Y, 128, 8)
    t.eq(17, #('E1INT E2COM E3VAR'), 'three names and three numbers')
    t.eq(text, (function()
      local r = screen.new()
      r:text(0, ui.ENC_Y, 'E1INT E2COM E3VAR', 8)
      return r:to_ascii(0, ui.ENC_Y, 128, 8)
    end)(), 'and that is exactly what is on the screen')
    t.truthy(on:to_ascii(0, ui.ENC_Y, 128, 8) ~= text, 'the swing page changes it')
    t.eq(on:to_ascii(0, ui.ENC_Y, 128, 8), (function()
      local r = screen.new()
      r:text(0, ui.ENC_Y, 'E1SWI E2SWI E3SWI', 8)
      return r:to_ascii(0, ui.ENC_Y, 128, 8)
    end)(), 'swing names swing on all three')
  end)

  t.test('velocity shows as brightness', function()
    local soft = ui.new()
    ui.draw(soft, { params = {}, rows = { { 1 } } })
    local hard = ui.new()
    ui.draw(hard, { params = {}, rows = { { 127 } } })
    local quiet = soft:get(0, ui.GRID_Y)
    local loud = hard:get(0, ui.GRID_Y)
    t.truthy(quiet > 0 and quiet < loud,
      string.format('soft %d is dimmer than loud %d', quiet, loud))
    t.truthy(loud <= screen.MAX_LEVEL)
  end)

  t.test('the grid spans the full width and every lane is drawn', function()
    local s = ui.new()
    local rows = {}
    for lane = 1, 10 do
      rows[lane] = {}
      rows[lane][1] = 100
    end
    ui.draw(s, { params = {}, rows = rows })
    for lane = 0, 9 do
      t.truthy(s:get(0, ui.GRID_Y + lane * ui.LANE_H) > 0,
        string.format('lane %d is lit', lane + 1))
    end
    -- step 1 starts at x 0 and step 16 ends at x 126, leaving a 1px gap
    t.truthy(s:get(0, ui.GRID_Y) > 0)
    t.eq(0, s:get(ui.STEP_W * 16 - 1, ui.GRID_Y), 'the gap after the last step')
  end)

  t.test('the playhead draws a full height column over the grid', function()
    local s = ui.new()
    ui.draw(s, { params = {}, rows = {}, playhead = 3 })
    local x = (3 - 1) * ui.STEP_W
    for i = 0, 10 * ui.LANE_H - 1 do
      t.eq(screen.MAX_LEVEL, s:get(x, ui.GRID_Y + i), 'playhead row ' .. i)
    end
  end)

  t.test('a playhead outside 1..16 draws nothing', function()
    local s = ui.new()
    ui.draw(s, { params = {}, rows = {}, playhead = 99 })
    t.eq(0, s:get(0, ui.GRID_Y))
  end)

  t.test('the key hints are on one line and fit', function()
    local s = ui.new()
    ui.draw(s, { params = {}, rows = {} })
    t.truthy(s:get(2, ui.KEYS_Y) > 0, 'the key hint line is drawn')
    t.eq(21 * 6, font.width('1:PLAY 2:STYLE 3:FILL'))
    t.truthy(font.width('1:PLAY 2:STYLE 3:FILL') <= W)
  end)

  t.test('the encoder line names what each encoder turns', function()
    local s = ui.new()
    ui.draw(s, { params = {}, rows = {} })
    t.truthy(s:get(2, ui.ENC_Y) > 0)
    t.eq(3, #ui.ENCODER_PARAMS, 'three encoders, like the device')
    t.eq(3, ui.SWING_KEY, 'swing is reached from a key, not a fourth encoder')
  end)

  t.test('the layout fills all 64 rows', function()
    t.eq(ui.PARAM_Y, ui.GRID_Y + 10 * ui.LANE_H, 'params start right after the grid')
    t.eq(ui.ENC_Y, ui.KEYS_Y + 8, 'keys then encoders, adjacent')
    t.eq(H, ui.ENC_Y + 8, 'the encoder line ends on the last row')
  end)
end)