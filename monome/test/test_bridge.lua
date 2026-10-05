-- monome/test/test_bridge.lua -- the JSON boundary every host goes through.
--
-- The browser, the future device entry script and anything else all call these
-- five functions, so anything asserted here holds for every host. The important
-- property is not that a function works but that a bad payload comes back as a
-- reply rather than killing the host: in the browser that means an error on the
-- page instead of a blank canvas, on the device it means a printed message.

local t = require 'harness'
local bridge = require 'bridge'
local store = require 'store'

-- Call an entry point and decode the reply, so a test reads like the API.
local function call(fn, json)
  local text = bridge[fn](json)
  local value, err = store.decode(text)
  t.truthy(value, fn .. ' returned undecodable JSON: ' .. tostring(err))
  return value
end

local function booted()
  call('boot', '{"gen":{"style":"four_on_floor","seed":7}}')
end

local function pair_count(tbl)
  local n = 0
  for _ in pairs(tbl) do n = n + 1 end
  return n
end

-- Each test gets a fresh instance. Without this they leak style, bar counter and
-- playhead into each other, and a failure names the wrong cause.
local function fresh()
  return function() booted() end
end

t.suite('bridge lifecycle', function()
  t.before_each(fresh())

  t.test('a fresh process reports not booted', function()
    bridge.state = nil
    -- before_each has just booted it, so nil it out on purpose
    local snap = bridge.snapshot()
    t.eq(1, pair_count(snap), 'nothing but the booted flag')
    t.eq(false, snap.booted)
  end)

  t.test('every entry point refuses to work before boot', function()
    bridge.state = nil
    for _, fn in ipairs({ 'tick', 'set', 'cells', 'render', 'input' }) do
      local reply = call(fn, nil)
      t.falsy(reply.ok, fn .. ' must not succeed before boot')
      t.eq('not booted', reply.error, fn .. ' says why')
    end
  end)

  t.test('boot returns a state a host can draw from', function()
    local reply = call('boot', '{"gen":{"style":"four_on_floor","seed":7}}')
    t.truthy(reply.ok)
    t.truthy(reply.state.booted)
    t.eq('four_on_floor', reply.state.style)
    t.eq(16, reply.state.steps)
    t.eq(10, reply.state.lanes)
    t.eq(16, #reply.state.rows[1])
    t.eq(10, #reply.state.voices)
    t.eq(36, reply.state.voices[1].note, 'the kit resolves note numbers')
    t.eq(false, reply.state.playing)
  end)

  t.test('boot with no argument works, because a host may have nothing to send', function()
    local reply = call('boot', nil)
    t.truthy(reply.ok)
    t.eq('four_on_floor', reply.state.style, 'the generator default style')
  end)

  t.test('boot is repeatable and does not accumulate state', function()
    booted()
    call('tick', nil)
    booted()
    t.eq(0, call('boot', '{"gen":{"seed":7}}').state.bar, 'bar counter reset')
  end)

  t.test('tempo can be set at boot', function()
    t.eq(140, call('boot', '{"tempo":140}').state.tempo)
    t.eq(120, call('boot', '{"tempo":9000}').state.tempo, 'an absurd tempo is refused')
  end)
end)

t.suite('bridge tick', function()
  t.before_each(fresh())

  t.test('tick generates a bar and returns its events', function()
    booted()
    local reply = call('tick', nil)
    t.truthy(reply.ok)
    t.eq(1, reply.state.bar)
    t.truthy(#reply.events > 0)
    for _, e in ipairs(reply.events) do
      -- the kit spans 36..70 (shaker is 70), not a tidy 36..51
      t.truthy(e.note >= 36 and e.note <= 70, 'note ' .. tostring(e.note) .. ' is in the kit')
      t.truthy(e.vel >= 0 and e.vel <= 127)
      t.truthy(e.step >= 1 and e.step <= 16)
    end
  end)

  t.test('events come back in tick order, which is what a host schedules on', function()
    booted()
    local reply = call('tick', nil)
    local last = -1
    for _, e in ipairs(reply.events) do
      t.truthy(e.tick >= last, 'tick ' .. e.tick .. ' after ' .. last)
      last = e.tick
    end
  end)

  t.test('bar_rows is the generated bar, rows is the editable grid', function()
    booted()
    local reply = call('tick', nil)
    t.eq(16, #reply.state.bar_rows[1])
    t.eq(16, #reply.state.rows[1])
    -- the grid the host edits starts empty; the generator does not write into it
    local hits = 0
    for _, v in ipairs(reply.state.rows[1]) do hits = hits + (v > 0 and 1 or 0) end
    t.eq(0, hits, 'the editable grid is untouched by the generator')
  end)

  t.test('force_fill makes this bar a fill', function()
    -- fill_every 0 is the way to say "never fill on the cadence", so these bars
    -- can only be fills because the host asked for it
    call('boot', '{"gen":{"style":"four_on_floor","seed":7,"fill_every":0}}')
    t.falsy(call('tick', nil).state.last_fill, 'bar 1 is not a fill')
    t.truthy(call('tick', '{"force_fill":true}').state.last_fill, 'bar 2 is one')
    t.falsy(call('tick', nil).state.last_fill, 'and the cadence has not shifted')
  end)

  t.test('the cadence fills on its own', function()
    call('boot', '{"gen":{"style":"four_on_floor","seed":7,"fill_every":2}}')
    t.falsy(call('tick', nil).state.last_fill)
    t.truthy(call('tick', nil).state.last_fill, 'every second bar')
    t.falsy(call('tick', nil).state.last_fill)
    t.truthy(call('tick', nil).state.last_fill)
  end)

  t.test('swing moves only the swung eighths', function()
    booted()
    local reply = call('tick', '{"swing":0.5}')
    for _, e in ipairs(reply.events) do
      if e.step % 4 ~= 3 then
        t.eq((e.step - 1) * 12, e.tick,
          'step ' .. e.step .. ' is not swung (ticks_per_step is 12, not 6)')
      end
    end
  end)
end)

t.suite('bridge render', function()
  t.before_each(fresh())

  t.test('render returns run-length encoded pixels of the right size', function()
    call('tick', nil)
    local reply = call('render', nil)
    t.truthy(reply.ok)
    t.truthy(reply.dirty, 'the draw was flushed')
    t.eq(128, reply.pixels.width)
    t.eq(64, reply.pixels.height)
    t.truthy(#reply.pixels.rle > 0)
    -- every pixel accounted for exactly once
    local total = 0
    for _, run in ipairs(reply.pixels.rle) do
      t.truthy(run[1] > 0, 'a run is never zero long')
      t.truthy(run[2] >= 0 and run[2] <= 15, 'level in 0..15')
      total = total + run[1]
    end
    t.eq(128 * 64, total)
  end)

  t.test('adjacent equal pixels are merged into one run', function()
    booted()
    local reply = call('render', nil)
    local px = reply.pixels
    for i = 2, #px.rle do
      t.truthy(px.rle[i][2] ~= px.rle[i - 1][2], 'run ' .. i .. ' changed level')
    end
  end)

  t.test('render carries the playhead and play state onto the screen', function()
    booted()
    local a = call('render', '{"playhead":1,"playing":true}')
    local b = call('render', '{"playhead":9,"playing":true}')
    t.truthy(a.dirty)
    t.eq(1, a.state.playhead)
    -- moving the playhead must change pixels, or the screen is not showing it
    t.truthy(store.compact(a.pixels.rle) ~= store.compact(b.pixels.rle))
  end)

  t.test('playing false removes the play marker', function()
    booted()
    local on = call('render', '{"playing":true}')
    local off = call('render', '{"playing":false}')
    t.truthy(store.compact(on.pixels.rle) ~= store.compact(off.pixels.rle))
  end)

  t.test('every render redraws, so it is always worth pushing', function()
    -- There is no retained display that could go stale, so there is nothing to
    -- cache and nothing to skip. dirty says whether this call changed anything
    -- at all, which a host needs before it decides to push pixels.
    t.truthy(call('render', nil).dirty)
    t.truthy(call('render', nil).dirty, 'redrawing the same thing still counts')
  end)

  t.test('render before the first bar draws the empty editable grid', function()
    local reply = call('render', nil)
    t.eq(10, #reply.state.rows)
    t.eq(nil, reply.state.bar_rows, 'no generated bar yet')
    t.truthy(reply.dirty)
  end)
end)

t.suite('bridge input', function()
  t.test('an encoder turns its own param', function()
    booted()
    local before = call('boot', '{"gen":{"seed":7}}').state.params.intensity
    call('boot', '{"gen":{"seed":7}}')
    local reply = call('input', '{"events":[{"kind":"enc","n":1,"d":3}]}')
    t.truthy(reply.ok)
    t.near(before + 0.06, reply.state.params.intensity, 0.001, 'three detents of 0.02')
  end)

  t.test('encoders clamp at 0 and 1 instead of erroring', function()
    call('boot', nil)
    local up = call('input', '{"events":[{"kind":"enc","n":1,"d":100}]}')
    t.eq(1, up.state.params.intensity)
    local down = call('input', '{"events":[{"kind":"enc","n":1,"d":-100}]}')
    t.eq(0, down.state.params.intensity)
  end)

  t.test('each encoder drives a different param', function()
    local keys = { 'intensity', 'complexity', 'variation' }
    for n = 1, 3 do
      local before = call('boot', nil).state
      local reply = call('input', string.format('{"events":[{"kind":"enc","n":%d,"d":5}]}', n))
      t.near(before.params[keys[n]] + 0.1, reply.state.params[keys[n]], 0.001,
        keys[n] .. ' moved')
      -- and the other two did not
      for m = 1, 3 do
        if m ~= n then
          t.near(before.params[keys[m]], reply.state.params[keys[m]], 0.0001,
            keys[m] .. ' is left alone')
        end
      end
    end
  end)

  t.test('a fourth encoder is refused with a readable message', function()
    call('boot', nil)
    local reply = call('input', '{"events":[{"kind":"enc","n":4,"d":1}]}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('4'), 'the message names the bad encoder')
  end)

  t.test('key 1 toggles play', function()
    call('boot', nil)
    t.eq(true, call('input', '{"events":[{"kind":"key","n":1,"z":true}]}').state.playing)
    t.eq(false, call('input', '{"events":[{"kind":"key","n":1,"z":true}]}').state.playing)
  end)

  t.test('only the press edge acts, so a host sending z:false does not double toggle', function()
    call('boot', nil)
    local reply = call('input', '{"events":[{"kind":"key","n":1,"z":false}]}')
    t.eq(false, reply.state.playing, 'a release does nothing')
  end)

  t.test('key 2 steps through the styles and comes back round', function()
    local names = call('boot', '{"gen":{"style":"breakbeat"}}').state.styles
    t.eq('breakbeat', names[1], 'styles() is sorted, so the lap is stable')
    t.eq('disco', names[2])
    local seen = {}
    for _ = 1, #names do
      local style = call('input', '{"events":[{"kind":"key","n":2,"z":true}]}').state.style
      local known = false
      for _, n in ipairs(names) do known = known or n == style end
      t.truthy(known, style .. ' is a known style')
      t.falsy(seen[style], style .. ' is only visited once per lap')
      seen[style] = true
    end
    -- the loop above already walked a full lap, so the next press lands on the
    -- style we started from
    t.eq('disco', call('input', '{"events":[{"kind":"key","n":2,"z":true}]}').state.style,
      'and the lap comes back round')
  end)

  t.test('key 3 is the swing page, which is how a fourth param is reachable', function()
    call('boot', nil)
    t.eq(true, call('input', '{"events":[{"kind":"key","n":3,"z":true}]}').state.swing_page)
    -- on the swing page the encoders move swing instead of their own param
    -- swing starts at 0, so five detents of 0.02 is 0.1
    local reply = call('input', '{"events":[{"kind":"enc","n":1,"d":5}]}')
    t.near(0.1, reply.state.params.swing, 0.001)
    t.near(0.5, reply.state.params.intensity, 0.001, 'intensity is left alone')
    -- and the screen shows the swing param as selected
    t.eq(4, reply.state.selected)
    -- leaving the page puts it back
    t.eq(1, call('input', '{"events":[{"kind":"key","n":3,"z":true}]}').state.selected)
  end)

  t.test('a fourth key is refused', function()
    call('boot', nil)
    local reply = call('input', '{"events":[{"kind":"key","n":4,"z":true}]}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('4'))
  end)

  t.test('an unknown input kind is refused rather than ignored', function()
    call('boot', nil)
    local reply = call('input', '{"events":[{"kind":"wheel","n":1,"d":1}]}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('wheel'))
  end)

  t.test('an empty event list is fine', function()
    call('boot', nil)
    t.truthy(call('input', '{"events":[]}').ok)
    t.truthy(call('input', nil).ok)
  end)

  t.test('several events in one call all apply', function()
    call('boot', nil)
    local reply = call('input', '{"events":[' ..
      '{"kind":"key","n":1,"z":true},' ..
      '{"kind":"enc","n":2,"d":5},' ..
      '{"kind":"key","n":2,"z":true}]}')
    t.eq(true, reply.state.playing)
    t.near(0.6, reply.state.params.complexity, 0.001)
    -- styles() is sorted: breakbeat, disco, four_on_floor, halftime, trap
    t.eq('halftime', reply.state.style, 'one key 2 press steps one place round')
  end)

  t.test('tempo arrives through input, and an absurd tempo is ignored', function()
    call('boot', nil)
    t.eq(140, call('input', '{"tempo":140}').state.tempo)
    t.eq(140, call('input', '{"tempo":9000}').state.tempo, 'clamped to what it had')
  end)
end)

t.suite('bridge set and cells', function()
  t.before_each(fresh())

  t.test('set changes the style and the params', function()
    call('boot', nil)
    t.eq('trap', call('set', '{"style":"trap"}').state.style)
    t.near(0.2, call('set', '{"params":{"swing":0.2}}').state.params.swing, 0.001)
    t.eq(true, call('set', '{"playing":true}').state.playing)
  end)

  t.test('set refuses an unknown style without killing the host', function()
    local reply = call('set', '{"style":"nope"}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('nope'))
    t.truthy(reply.error:find('gen.lua'), 'the traceback names where it raised')
    t.truthy(call('render', nil).ok, 'the host is still usable afterwards')
    t.eq('four_on_floor', bridge.snapshot().style, 'and nothing was half applied')
  end)

  t.test('cells replaces the editable grid', function()
    -- a full 10 lane grid: the pattern is 10x16 and from_rows insists on it
    local rows = {}
    for lane = 1, 10 do
      rows[lane] = {}
      for step = 1, 16 do rows[lane][step] = (step == 1 and lane * 10 or 0) end
    end
    local reply = call('cells', store.compact({ rows = rows }))
    t.truthy(reply.ok)
    t.eq(10, #reply.state.rows)
    t.eq(16, #reply.state.rows[1])
    t.eq(10, reply.state.rows[1][1])
    t.eq(100, reply.state.rows[10][1])
    t.eq(0, reply.state.rows[1][2])
  end)

  t.test('a short grid is refused, not padded', function()
    local reply = call('cells', '{"rows":[[100,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]]}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('lanes'), 'the message says what was wrong')
  end)

  t.test('cells rejects a malformed grid without half applying it', function()
    local rows = {}
    for lane = 1, 10 do
      rows[lane] = {}
      for step = 1, 16 do rows[lane][step] = (step == 1 and 100 or 0) end
    end
    call('cells', store.compact({ rows = rows }))
    local reply = call('cells', '{"rows":[[1,2],[1]]}')
    t.falsy(reply.ok)
    t.eq(100, bridge.snapshot().rows[1][1], 'the old grid is intact')
  end)
end)

t.suite('bridge error containment', function()
  t.before_each(fresh())

  t.test('malformed JSON in any entry point becomes a reply', function()
    for _, fn in ipairs({ 'tick', 'set', 'cells', 'render', 'input' }) do
      local reply = call(fn, '{"not json')
      t.falsy(reply.ok, fn .. ' must not raise')
      t.truthy(type(reply.error) == 'string' and #reply.error > 0, fn .. ' explains itself')
    end
  end)

  t.test('a JSON value that is not an object is refused', function()
    t.falsy(call('set', '[1,2,3]').ok)
    t.falsy(call('input', '"hello"').ok)
    t.falsy(call('input', '42').ok, 'a bare number is not a payload either')
    t.truthy(call('input', '{"events":[1,2]}').ok == false, 'and so is a non-object event')
  end)

  t.test('nothing to send is not an error', function()
    -- A host with no changes should not have to invent a payload, so nil and the
    -- empty string both mean "no change". A JSON string value is still refused:
    -- that is a host sending the wrong type, not a host with nothing to say.
    t.truthy(call('tick', nil).ok)
    t.truthy(call('tick', '').ok)
    t.truthy(call('input', nil).ok)
    t.truthy(call('input', '').ok)
    t.falsy(call('tick', '""').ok, 'but a JSON string is a host bug, not a no-op')
  end)

  t.test('a Lua error inside an entry point is returned with a traceback', function()
    local reply = call('set', '{"style":"nope"}')
    t.falsy(reply.ok)
    t.truthy(reply.error:find('gen.lua'),
      'the traceback names the file that raised, so it is debuggable')
  end)

  t.test('the raw entry points raise instead of replying', function()
    t.raises(function() bridge.raw.set('{"style":"nope"}') end, 'unknown style',
      'a test that wants the traceback gets it')
  end)
end)

t.suite('bridge determinism', function()
  t.test('the same seed gives the same bars twice', function()
    local function two_bars()
      call('boot', '{"gen":{"style":"breakbeat","seed":42}}')
      return store.compact({ call('tick', nil).events, call('tick', nil).events })
    end
    t.eq(two_bars(), two_bars())
  end)

  t.test('turning a knob does not change what the RNG does next', function()
    local function one_bar()
      call('boot', '{"gen":{"style":"breakbeat","seed":42}}')
      return store.compact({ call('tick', nil).events })
    end
    local expected = one_bar()
    -- intensity does change the output, so turn it and turn it back
    call('boot', '{"gen":{"style":"breakbeat","seed":42}}')
    call('input', '{"events":[{"kind":"enc","n":1,"d":-3}]}')
    call('input', '{"events":[{"kind":"enc","n":1,"d":3}]}')
    call('input', '{"events":[{"kind":"key","n":3,"z":true},{"kind":"key","n":3,"z":true}]}')
    local after = store.compact({ call('tick', nil).events })
    t.eq(expected, after,
      'a knob moved and returned leaves the RNG stream where it was')
  end)

  t.test('the swing page leaves no trace on the stream either', function()
    local function one_bar()
      call('boot', '{"gen":{"style":"breakbeat","seed":42}}')
      return store.compact({ call('tick', nil).events })
    end
    local expected = one_bar()
    call('boot', '{"gen":{"style":"breakbeat","seed":42}}')
    call('input', '{"events":[{"kind":"key","n":3,"z":true}]}')
    call('input', '{"events":[{"kind":"enc","n":1,"d":0}]}')
    call('input', '{"events":[{"kind":"key","n":3,"z":true}]}')
    local after = store.compact({ call('tick', nil).events })
    t.eq(expected, after)
  end)
end)