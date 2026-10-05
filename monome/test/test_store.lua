-- monome/test/test_store.lua -- JSON encode/decode, validation and file io.
--
-- The file io tests use a throwaway directory under the system temp dir, so
-- nothing here touches a real drumgen.json.

local t = require 'harness'
local pattern = require 'pattern'
local kit = require 'kit'
local store = require 'store'

local function tmp_dir()
  local base = os.tmpname()
  os.remove(base)
  local dir = base .. '.drumgen'
  os.execute('mkdir -p ' .. dir)
  return dir
end

local function rm_dir(dir)
  os.execute('rm -rf ' .. dir)
end

local function sample()
  local p = pattern.new{ steps = 16, lanes = kit.count() }
  pattern.set(p, 1, 1, 112)
  pattern.set(p, 2, 5, 104)
  pattern.set(p, 10, 16, 90)
  local data = store.defaults()
  data.patterns = { store.new_entry('Verse', p), store.new_entry('Chorus', p) }
  data.style = 'breakbeat'
  data.params.swing = 0.25
  kit.set('kick', 'gain', 0.8)
  data.kit[1].gain = 0.8
  return data
end

t.suite('store json round-trip', function()
  t.test('encode produces sorted keys and stable indentation', function()
    local text = store.encode(store.defaults())
    t.truthy(string.find(text, '"version": 1', 1, true))
    t.truthy(string.find(text, '\n  "kit": [', 1, true))
    t.truthy(string.sub(text, -1) == '\n')
    -- stable: encoding twice gives the same bytes
    t.eq(text, store.encode(store.defaults()))
  end)

  t.test('a full document survives encode -> decode', function()
    local data = sample()
    local back = store.decode(store.encode(data))
    t.deq(data, back)
  end)

  t.test('strings are escaped and unescaped', function()
    local data = store.defaults()
    data.patterns = { store.new_entry('a "b" \\ c', pattern.new()) }
    local text = store.encode(data)
    t.truthy(string.find(text, '\\"', 1, true))
    local back = store.decode(text)
    t.eq('a "b" \\ c', back.patterns[1].name)
  end)

  t.test('newlines, tabs and control bytes survive', function()
    local data = store.defaults()
    data.patterns = { store.new_entry('one\ntwo\tthree', pattern.new()) }
    local back = store.decode(store.encode(data))
    t.eq('one\ntwo\tthree', back.patterns[1].name)
  end)

  t.test('utf-8 and \\u escapes survive', function()
    local data = store.defaults()
    data.patterns = { store.new_entry('caf\xc3\xa9', pattern.new()) }
    t.eq('caf\xc3\xa9', store.decode(store.encode(data)).patterns[1].name)
    -- a hand-written \u escape decodes to the same utf-8 bytes
    local raw = store.decode('{"a": "caf\\u00e9"}')
    t.eq('caf\xc3\xa9', raw.a)
    -- and a surrogate pair (U+1F600) becomes a 4-byte sequence
    local emoji = store.decode('{"a": "\\ud83d\\ude00"}')
    t.eq(4, #emoji.a)
  end)

  t.test('integers stay integers, floats keep their point', function()
    local data = store.defaults()
    data.params.intensity = 0.125
    local back = store.decode(store.encode(data))
    t.eq(0.125, back.params.intensity)
    t.eq(112, store.decode('{"v": 112}').v)
  end)

  t.test('empty arrays and objects round-trip', function()
    t.deq({ a = {} }, store.decode(store.encode{ a = {} }))
  end)

  t.test('booleans and null are decoded', function()
    local v = store.decode('{"yes": true, "no": false, "nothing": null}')
    t.eq(true, v.yes)
    t.eq(false, v.no)
    t.eq(store.NULL, v.nothing)
  end)
end)

t.suite('store json rejection', function()
  t.test('malformed input is refused with a position, never a crash', function()
    local cases = {
      { '{', 'expected a key' },
      { '{"a" 1}', "expected ':'" },
      { '{"a": }', 'unexpected input' },
      { '{a: 1}', 'expected a key' },
      { '[1, 2', 'expected' },
      { '{"a": 1} trailing', 'trailing content' },
      { '', 'unexpected input' },
      { '{"a": 1, "a": 2}', 'duplicate key' },
      { '{"a": "\\q"}', 'bad escape' },
      { '{"a": [1,,2]}', 'unexpected input' },
      { '{"a": [1}', "expected ',' or ']'" },
    }
    for i = 1, #cases do
      local text, needle = cases[i][1], cases[i][2]
      local data, err = store.decode(text)
      t.eq(nil, data, 'should not decode: ' .. text)
      t.truthy(string.find(err, 'malformed JSON', 1, true), text .. ' -> ' .. tostring(err))
      if needle ~= '' then
        t.truthy(string.find(err, needle, 1, true), text .. ' -> ' .. tostring(err))
      end
    end
  end)

  t.test('deeply nested input is refused instead of blowing the stack', function()
    local deep = string.rep('[', 200) .. string.rep(']', 200)
    local data, err = store.decode(deep)
    t.eq(nil, data)
    t.truthy(string.find(err, 'nested too deeply', 1, true))
  end)

  t.test('a non-string argument is refused', function()
    local data, err = store.decode(nil)
    t.eq(nil, data)
    t.truthy(string.find(err, 'expected a string', 1, true))
  end)
end)

t.suite('store validation', function()
  t.test('defaults are valid', function()
    t.eq(true, store.validate(store.defaults()))
    t.eq(true, store.validate(sample()))
  end)

  t.test('a wrong version is refused', function()
    local data = store.defaults()
    data.version = 2
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'version 2 is not 1', 1, true))
  end)

  t.test('out-of-range params are refused', function()
    for i = 1, #store.PARAM_KEYS do
      local data = store.defaults()
      data.params[store.PARAM_KEYS[i]] = 1.5
      local ok, err = store.validate(data)
      t.eq(false, ok, store.PARAM_KEYS[i])
      t.truthy(string.find(err, 'must be 0..1', 1, true))
    end
  end)

  t.test('an out-of-range velocity is refused', function()
    local data = sample()
    data.patterns[1].rows[2][5] = 200
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'velocity must be 0..127, got 200', 1, true))
  end)

  t.test('a fractional velocity is refused', function()
    local data = sample()
    data.patterns[1].rows[1][1] = 100.5
    t.eq(false, store.validate(data))
  end)

  t.test('a ragged or short lane is refused', function()
    local data = sample()
    data.patterns[1].rows[4][16] = nil
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'lane 4 must have 16 cells', 1, true))
  end)

  t.test('a wrong lane count is refused', function()
    local data = sample()
    table.remove(data.patterns[1].rows)
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'rows must have 10 lanes', 1, true))
  end)

  t.test('a bad name is refused', function()
    for _, bad_name in ipairs{ '', string.rep('x', 33), 'two\nlines' } do
      local data = sample()
      data.patterns[1].name = bad_name
      t.eq(false, store.validate(data), 'name ' .. string.format('%q', bad_name))
    end
  end)

  t.test('kit trims out of range are refused', function()
    local data = sample()
    data.kit[1].gain = 1.2
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'gain must be 0..1', 1, true))
    data = sample()
    data.kit[1].pan = -2
    t.eq(false, store.validate(data))
  end)

  t.test('a missing field is refused rather than defaulted silently', function()
    local data = sample()
    data.params.swing = nil
    local ok, err = store.validate(data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'params.swing must be a number', 1, true))
  end)
end)

t.suite('store file io', function()
  t.test('save then load round-trips through a real file', function()
    local dir = tmp_dir()
    local data = sample()
    t.eq(true, store.save(dir, data))
    t.truthy(store.exists(dir))
    local back, err = store.load(dir)
    t.eq(nil, err)
    t.deq(data, back)
    t.eq(112, pattern.get(store.pattern_of(back.patterns[1]), 1, 1))
    rm_dir(dir)
  end)

  t.test('save refuses invalid data and writes nothing', function()
    local dir = tmp_dir()
    local data = store.defaults()
    data.version = 99
    local ok, err = store.save(dir, data)
    t.eq(false, ok)
    t.truthy(string.find(err, 'version 99 is not 1', 1, true))
    t.falsy(store.exists(dir))
    rm_dir(dir)
  end)

  t.test('a first run with no file yields defaults', function()
    local dir = tmp_dir()
    t.falsy(store.exists(dir))
    local data, err = store.load(dir)
    t.eq(nil, err)
    t.eq('four_on_floor', data.style)
    t.eq(1, #data.patterns)
    t.eq('A', data.patterns[1].name)
    t.eq(true, store.validate(data))
    rm_dir(dir)
  end)

  t.test('a corrupt file is reported, not silently reset', function()
    local dir = tmp_dir()
    local f = assert(io.open(store.path(dir), 'wb'))
    f:write('{"version": 1, "style": ')
    f:close()
    local data, err = store.load(dir)
    t.eq(nil, data)
    t.truthy(string.find(err, 'malformed JSON', 1, true))
    t.truthy(string.find(err, 'drumgen.json', 1, true))
    rm_dir(dir)
  end)

  t.test('an empty file is reported', function()
    local dir = tmp_dir()
    local f = assert(io.open(store.path(dir), 'wb'))
    f:close()
    local data, err = store.load(dir)
    t.eq(nil, data)
    t.truthy(string.find(err, 'is empty', 1, true))
    rm_dir(dir)
  end)

  t.test('a valid JSON file with the wrong schema is reported', function()
    local dir = tmp_dir()
    local f = assert(io.open(store.path(dir), 'wb'))
    f:write('{"version": 1, "style": "x", "params": {}, "kit": [], "patterns": []}')
    f:close()
    local data, err = store.load(dir)
    t.eq(nil, data)
    t.truthy(string.find(err, 'params.intensity', 1, true))
    rm_dir(dir)
  end)

  t.test('saving twice overwrites cleanly, leaving no .tmp', function()
    local dir = tmp_dir()
    t.eq(true, store.save(dir, store.defaults()))
    local data = store.defaults()
    data.style = 'trap'
    t.eq(true, store.save(dir, data))
    local back = store.load(dir)
    t.eq('trap', back.style)
    local f = io.open(store.path(dir) .. '.tmp', 'rb')
    t.eq(nil, f, 'the temp file must not survive')
    rm_dir(dir)
  end)
end)