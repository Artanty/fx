-- monome/test/test_kit.lua -- the 10-voice kit.

local t = require 'harness'
local kit = require 'kit'

t.suite('kit contents', function()
  t.test('has exactly 10 voices, no clap', function()
    t.eq(10, kit.count())
    t.eq(10, #kit.voices())
    t.truthy(kit.assert_valid())
    t.eq(nil, kit.get('clap'))
    t.eq(nil, kit.index('clap'))
  end)

  t.test('ids and notes are unique and lanes match ids', function()
    local ids, notes = {}, {}
    for lane = 1, kit.count() do
      local v = kit.at(lane)
      t.eq(lane, v.lane)
      t.eq(v.id, kit.id_at(lane))
      t.eq(v.note, kit.note_at(lane))
      t.falsy(ids[v.id], 'duplicate id ' .. tostring(v.id))
      t.falsy(notes[v.note], 'duplicate note ' .. tostring(v.note))
      ids[v.id] = true
      notes[v.note] = true
    end
  end)

  t.test('every voice is addressable by id and by lane', function()
    for lane = 1, kit.count() do
      local v = kit.at(lane)
      t.eq(lane, kit.index(v.id))
      t.eq(v, kit.get(v.id))
    end
    t.eq(nil, kit.index('nope'))
    t.eq(nil, kit.get('nope'))
  end)

  t.test('lanes are the well-known GM percussion notes', function()
    t.eq(36, kit.note_at(kit.index('kick')))
    t.eq(38, kit.note_at(kit.index('snare')))
    t.eq(42, kit.note_at(kit.index('hatc')))
    t.eq(46, kit.note_at(kit.index('hato')))
  end)

  t.test('an out-of-range lane raises', function()
    t.raises(function() kit.at(0) end, 'lane 0 out of range 1..10')
    t.raises(function() kit.at(11) end, 'lane 11 out of range 1..10')
  end)

  t.test('gains start in range and pans are signed', function()
    for lane = 1, kit.count() do
      local v = kit.at(lane)
      t.truthy(v.gain > 0 and v.gain <= 1, v.id .. ' gain')
      t.truthy(v.pan >= -1 and v.pan <= 1, v.id .. ' pan')
    end
    t.truthy(kit.at(kit.index('toml')).pan < 0)
    t.truthy(kit.at(kit.index('tomh')).pan > 0)
  end)
end)

t.suite('kit lookup by role', function()
  t.test('lane_for finds the generator roles', function()
    t.eq(kit.index('kick'), kit.lane_for('kick'))
    t.eq(kit.index('snare'), kit.lane_for('snare'))
    t.eq(nil, kit.lane_for('conga'))
  end)

  t.test('by_role returns every voice with that role', function()
    local toms = kit.by_role('tom')
    t.eq(2, #toms)
    t.eq(kit.index('toml'), toms[1])
    t.eq(kit.index('tomh'), toms[2])
    t.eq(1, #kit.by_role('kick'))
    t.eq(0, #kit.by_role('conga'))
  end)
end)

t.suite('kit choke groups', function()
  t.test('the hats and cymbals share one group', function()
    t.eq('metal', kit.choke_at(kit.index('hatc')))
    t.eq('metal', kit.choke_at(kit.index('hato')))
    t.eq('metal', kit.choke_at(kit.index('crash')))
  end)

  t.test('kick and snare choke nothing', function()
    t.eq(nil, kit.choke_at(kit.index('kick')))
    t.eq(nil, kit.choked_by(kit.index('snare')))
  end)

  t.test('an open hat cuts the closed one and the other cymbals', function()
    local cut = kit.choked_by(kit.index('hato'))
    t.eq(3, #cut)
    for i = 1, #cut do
      t.eq('metal', kit.choke_at(cut[i]))
    end
  end)
end)

t.suite('kit trims', function()
  t.test('set edits gain, pan and velocity within range', function()
    kit.set('kick', 'gain', 0.5)
    t.eq(0.5, kit.get('kick').gain)
    kit.set('kick', 'gain', 9)                  -- capped
    t.eq(1, kit.get('kick').gain)
    kit.set('toml', 'pan', -2)                  -- capped
    t.eq(-1, kit.get('toml').pan)
    kit.set('toml', 'pan', 2)
    t.eq(1, kit.get('toml').pan)
    kit.set('rim', 'vel', 200)
    t.eq(127, kit.get('rim').vel)
    kit.reset()
  end)

  t.test('set rejects unknown ids, fields and junk values', function()
    t.raises(function() kit.set('nope', 'gain', 1) end, 'no voice with id nope')
    t.raises(function() kit.set('kick', 'note', 36) end, 'is not editable')
    t.raises(function() kit.set('kick', 'gain', 'loud') end, 'gain must be a number')
  end)

  t.test('reset restores the designed trims', function()
    local before = kit.get('kick').gain
    kit.set('kick', 'gain', 0.01)
    kit.reset()
    t.eq(before, kit.get('kick').gain)
    t.truthy(kit.assert_valid())
  end)
end)

t.suite('kit engines', function()
  t.test('no voice claims an engine until the device probe says so', function()
    for lane = 1, kit.count() do
      t.eq(nil, kit.at(lane).engine, kit.id_at(lane) .. ' must start engine-less')
    end
  end)

  t.test('set_engine records and clears a name', function()
    kit.set_engine('kick', 'polyperc')
    t.eq('polyperc', kit.get('kick').engine)
    kit.set_engine('kick', nil)
    t.eq(nil, kit.get('kick').engine)
  end)

  t.test('set_engine rejects an empty name', function()
    t.raises(function() kit.set_engine('kick', '') end, 'non-empty string or nil')
    t.raises(function() kit.set_engine('nope', 'polyperc') end, 'no voice with id nope')
  end)
end)