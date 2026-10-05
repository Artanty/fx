-- monome/drumgen/lib/store.lua -- patterns and kit trims as JSON on the norns.
--
-- The storage directory is a PARAMETER, never norns.state.path, so this module
-- is pure Lua and testable on the host: the device layer just passes its own
-- script directory. Same hand-rolled JSON approach as c4synth's rnd.lua (no
-- external JSON library on the norns, and the file is small enough that a
-- dependency would cost more than it saves).
--
-- Schema (version 1):
--   { version = 1,
--     style = 'four_on_floor',
--     params = { intensity = .5, complexity = .5, variation = .5, swing = 0 },
--     kit = { { gain = 1, pan = 0 }, ... one per voice },
--     patterns = { { name = 'A', rows = { { 16 cells }, ... one per lane } } } }
--
-- Nothing is written before store.validate() passes, and a corrupt file is
-- reported rather than quietly replaced by defaults - losing a saved pattern
-- silently is worse than a visible error.

local pattern = require 'pattern'
local kit = require 'kit'

local store = {}

store.VERSION = 1
store.FILE = 'drumgen.json'
store.MAX_PATTERNS = 64
store.MAX_NAME = 32
store.PARAM_KEYS = { 'intensity', 'complexity', 'variation', 'swing' }

-- JSON null, kept distinct from nil so a file containing null is rejected by
-- validate() instead of turning into a hole in the middle of the data.
store.NULL = setmetatable({}, { __tostring = function() return 'null' end })

--------------------------------------------------------------------------------
-- encoding
--------------------------------------------------------------------------------

local ESCAPES = {
  ['"'] = '\\"', ['\\'] = '\\\\', ['\b'] = '\\b', ['\f'] = '\\f',
  ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t',
}

local function escape_char(c)
  return ESCAPES[c] or string.format('\\u%04x', string.byte(c))
end

local function quote(s)
  -- bytes >= 128 pass through untouched: Lua strings are byte strings and the
  -- file is UTF-8, so this round-trips exactly what the user typed.
  return '"' .. string.gsub(s, '[%c"\\]', escape_char) .. '"'
end

local function number(v)
  if v ~= v or v == math.huge or v == -math.huge then
    error('store.encode: ' .. tostring(v) .. ' has no JSON representation')
  end
  if v == math.floor(v) and math.abs(v) < 2 ^ 53 then
    return string.format('%d', v)
  end
  return string.format('%.14g', v)
end

local encode_value

-- `pretty` controls the whitespace: the device file wants a readable diff, the
-- bridge wants one line per reply because it travels over JSON on every frame.
local function encode_table(v, indent, depth, pretty)
  local pad, pad_in = string.rep('  ', depth), string.rep('  ', depth + 1)
  local sep, pad_each = pretty and ',\n' or ',', pretty and pad_in or ''
  -- An array is any table with a [1]; an empty table encodes as {} and decodes
  -- back as an empty table, which validate() then checks against the schema.
  if #v > 0 then
    local parts = {}
    for i = 1, #v do
      parts[i] = pad_each .. encode_value(v[i], indent, depth + 1, pretty)
    end
    if #parts == 0 then return '[]' end
    if pretty then return '[\n' .. table.concat(parts, sep) .. '\n' .. pad .. ']' end
    return '[' .. table.concat(parts, sep) .. ']'
  end
  local keys = {}
  for k in pairs(v) do
    if type(k) ~= 'string' then
      error('store.encode: object key must be a string, got ' .. type(k))
    end
    keys[#keys + 1] = k
  end
  if #keys == 0 then return '{}' end
  table.sort(keys)
  local parts = {}
  for i = 1, #keys do
    parts[i] = pad_each .. quote(keys[i]) .. (pretty and ': ' or ':')
      .. encode_value(v[keys[i]], indent, depth + 1, pretty)
  end
  if pretty then return '{\n' .. table.concat(parts, sep) .. '\n' .. pad .. '}' end
  return '{' .. table.concat(parts, sep) .. '}'
end

encode_value = function(v, indent, depth, pretty)
  local t = type(v)
  if v == store.NULL then return 'null' end
  if t == 'nil' or t == 'boolean' then return tostring(v) end
  if t == 'number' then return number(v) end
  if t == 'string' then return quote(v) end
  if t == 'table' then return encode_table(v, indent, depth, pretty) end
  error('store.encode: cannot encode a ' .. t)
end

-- Stable key order and 2-space indent: the file is small, and this way a diff
-- after a session's worth of edits is readable.
function store.encode(data)
  return encode_value(data, '  ', 0, true) .. '\n'
end

--- One line, no indentation. Used by the bridge, which answers a host on every
--- frame and has no use for pretty whitespace.
function store.compact(data)
  return encode_value(data, '', 0, false)
end

--------------------------------------------------------------------------------
-- decoding
--------------------------------------------------------------------------------

local MAX_DEPTH = 64

local function utf8(cp)
  if cp < 0x80 then
    return string.char(cp)
  elseif cp < 0x800 then
    return string.char(0xC0 + math.floor(cp / 0x40), 0x80 + cp % 0x40)
  elseif cp < 0x10000 then
    return string.char(0xE0 + math.floor(cp / 0x1000),
      0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
  end
  return string.char(0xF0 + math.floor(cp / 0x40000),
    0x80 + math.floor(cp / 0x1000) % 0x40,
    0x80 + math.floor(cp / 0x40) % 0x40, 0x80 + cp % 0x40)
end

local function decode_string(s, i)
  -- s[i] is the opening quote; returns the string and the index after the close
  local out = {}
  local j = i + 1
  while true do
    local c = string.sub(s, j, j)
    if c == '' then error('unterminated string', j) end
    if c == '"' then return table.concat(out), j + 1 end
    if c == '\\' then
      local e = string.sub(s, j + 1, j + 1)
      if e == 'u' then
        local hex = string.sub(s, j + 2, j + 5)
        local cp = tonumber(hex, 16)
        if not cp or #hex < 4 then error('bad \\u escape', j) end
        j = j + 6
        if cp >= 0xD800 and cp <= 0xDBFF then      -- surrogate pair
          if string.sub(s, j, j + 1) == '\\u' then
            local lo = tonumber(string.sub(s, j + 2, j + 5), 16)
            if lo and lo >= 0xDC00 and lo <= 0xDFFF then
              cp = 0x10000 + (cp - 0xD800) * 0x400 + (lo - 0xDC00)
              j = j + 6
            end
          end
        end
        out[#out + 1] = utf8(cp)
      else
        local simple = { ['"'] = '"', ['\\'] = '\\', ['/'] = '/', b = '\b',
          f = '\f', n = '\n', r = '\r', t = '\t' }
        if not simple[e] then error('bad escape \\' .. e, j) end
        out[#out + 1] = simple[e]
        j = j + 2
      end
    else
      out[#out + 1] = c
      j = j + 1
    end
  end
end

local function skip_space(s, i)
  local _, j = string.find(s, '^[ \t\n\r]*', i)
  return j + 1
end

local LITERALS = { ['true'] = true, ['false'] = false, ['null'] = store.NULL }

local function decode_value(s, i, depth)
  if depth > MAX_DEPTH then error('nested too deeply', i) end
  i = skip_space(s, i)
  local c = string.sub(s, i, i)
  if c == '{' then
    local obj = {}
    i = skip_space(s, i + 1)
    if string.sub(s, i, i) == '}' then return obj, i + 1 end
    while true do
      if string.sub(s, i, i) ~= '"' then error('expected a key', i) end
      local key
      key, i = decode_string(s, i)
      i = skip_space(s, i)
      if string.sub(s, i, i) ~= ':' then error("expected ':'", i) end
      local value
      value, i = decode_value(s, i + 1, depth + 1)
      if obj[key] ~= nil then error('duplicate key ' .. key, i) end
      obj[key] = value
      i = skip_space(s, i)
      local d = string.sub(s, i, i)
      if d == ',' then i = skip_space(s, i + 1)
      elseif d == '}' then return obj, i + 1
      else error("expected ',' or '}'", i) end
    end
  elseif c == '[' then
    local arr = {}
    i = skip_space(s, i + 1)
    if string.sub(s, i, i) == ']' then return arr, i + 1 end
    while true do
      local value
      value, i = decode_value(s, i, depth + 1)
      arr[#arr + 1] = value
      i = skip_space(s, i)
      local d = string.sub(s, i, i)
      if d == ',' then i = i + 1
      elseif d == ']' then return arr, i + 1
      else error("expected ',' or ']'", i) end
    end
  elseif c == '"' then
    return decode_string(s, i)
  else
    local word = string.match(s, '^[%a]+', i)
    -- membership, not truthiness: LITERALS['false'] IS false
    if word and LITERALS[word] ~= nil then return LITERALS[word], i + #word end
    local num = string.match(s, '^-?%d+%.?%d*[eE]?[-+]?%d*', i)
    if num and #num > 0 then
      local v = tonumber(num)
      if v then return v, i + #num end
    end
    error('unexpected input', i)
  end
end

-- Returns data, or nil plus a message that points at the offending byte.
function store.decode(text)
  if type(text) ~= 'string' then
    return nil, 'store.decode: expected a string, got ' .. type(text)
  end
  local ok, result = pcall(function()
    local data, i = decode_value(text, 1, 0)
    local rest = string.sub(text, skip_space(text, i))
    if rest ~= '' then error('trailing content', i) end
    return data
  end)
  if not ok then
    return nil, 'store.decode: malformed JSON: ' .. tostring(result)
  end
  return result
end

--------------------------------------------------------------------------------
-- validation
--------------------------------------------------------------------------------

local function bad(msg)
  return false, msg
end

local function is_int(v)
  return type(v) == 'number' and v == math.floor(v)
end

local function check_name(name, where)
  if type(name) ~= 'string' then
    return bad(where .. ': name must be a string, got ' .. type(name))
  end
  if #name < 1 or #name > store.MAX_NAME then
    return bad(string.format('%s: name must be 1..%d characters, got %d',
      where, store.MAX_NAME, #name))
  end
  if string.find(name, '%c') then
    return bad(where .. ': name must not contain control characters')
  end
  return true
end

-- true, or false plus a human-readable reason.
function store.validate(data)
  if type(data) ~= 'table' then
    return bad('store: expected a table, got ' .. type(data))
  end
  if data.version ~= store.VERSION then
    return bad(string.format('store: version %s is not %d',
      tostring(data.version), store.VERSION))
  end
  local style_ok, style_err = check_name(data.style, 'store')
  if not style_ok then return false, style_err end

  if type(data.params) ~= 'table' then
    return bad('store: params must be a table')
  end
  for i = 1, #store.PARAM_KEYS do
    local key = store.PARAM_KEYS[i]
    local v = data.params[key]
    if type(v) ~= 'number' then
      return bad(string.format('store: params.%s must be a number, got %s',
        key, type(v)))
    end
    if v < 0 or v > 1 then
      return bad(string.format('store: params.%s must be 0..1, got %s', key, tostring(v)))
    end
  end

  if type(data.kit) ~= 'table' or #data.kit ~= kit.count() then
    return bad(string.format('store: kit must have %d entries', kit.count()))
  end
  for lane = 1, #data.kit do
    local trim = data.kit[lane]
    if type(trim) ~= 'table' then
      return bad(string.format('store: kit entry %d must be a table', lane))
    end
    if type(trim.gain) ~= 'number' or trim.gain < 0 or trim.gain > 1 then
      return bad(string.format('store: kit entry %d gain must be 0..1', lane))
    end
    if type(trim.pan) ~= 'number' or trim.pan < -1 or trim.pan > 1 then
      return bad(string.format('store: kit entry %d pan must be -1..1', lane))
    end
  end

  if type(data.patterns) ~= 'table' then
    return bad('store: patterns must be a table')
  end
  if #data.patterns > store.MAX_PATTERNS then
    return bad(string.format('store: at most %d patterns, got %d',
      store.MAX_PATTERNS, #data.patterns))
  end
  for i = 1, #data.patterns do
    local entry = data.patterns[i]
    local where = string.format('store: pattern %d', i)
    if type(entry) ~= 'table' then
      return bad(where .. ' must be a table')
    end
    local ok, err = check_name(entry.name, where)
    if not ok then return false, err end
    if not is_int(entry.steps) or entry.steps < pattern.MIN_STEPS
        or entry.steps > pattern.MAX_STEPS then
      return bad(string.format('%s: steps must be %d..%d, got %s', where,
        pattern.MIN_STEPS, pattern.MAX_STEPS, tostring(entry.steps)))
    end
    if type(entry.rows) ~= 'table' or #entry.rows ~= kit.count() then
      return bad(string.format('%s: rows must have %d lanes', where, kit.count()))
    end
    for lane = 1, #entry.rows do
      local row = entry.rows[lane]
      if type(row) ~= 'table' or #row ~= entry.steps then
        return bad(string.format('%s: lane %d must have %d cells', where,
          lane, entry.steps))
      end
      for s = 1, #row do
        local v = row[s]
        if not is_int(v) or v < 0 or v > pattern.VEL_MAX then
          return bad(string.format('%s: lane %d step %d velocity must be 0..%d, got %s',
            where, lane, s, pattern.VEL_MAX, tostring(v)))
        end
      end
    end
  end
  return true
end

--------------------------------------------------------------------------------
-- file io
--------------------------------------------------------------------------------

-- A fresh kit trims + one empty pattern: what the script starts with before any
-- file exists.
function store.defaults(opts)
  opts = opts or {}
  local trims = {}
  for lane = 1, kit.count() do
    trims[lane] = { gain = kit.at(lane).gain, pan = kit.at(lane).pan }
  end
  local params = {}
  for i = 1, #store.PARAM_KEYS do params[store.PARAM_KEYS[i]] = 0.5 end
  params.swing = 0
  return {
    version = store.VERSION,
    style = opts.style or 'four_on_floor',
    params = params,
    kit = trims,
    patterns = { store.new_entry('A', pattern.new()) },
  }
end

function store.new_entry(name, p)
  return { name = name, steps = pattern.steps(p), rows = pattern.to_rows(p) }
end

function store.pattern_of(entry)
  return pattern.from_rows(entry.rows)
end

function store.path(dir)
  return (dir or '.') .. '/' .. store.FILE
end

function store.exists(dir)
  local f = io.open(store.path(dir), 'rb')
  if not f then return false end
  f:close()
  return true
end

-- save returns true, or false plus a reason. The write goes to a .tmp and is
-- renamed, so a full disk cannot leave a half-written drumgen.json behind.
function store.save(dir, data)
  local ok, err = store.validate(data)
  if not ok then return false, err end
  local text = store.encode(data)
  local tmp = store.path(dir) .. '.tmp'
  local f, ferr = io.open(tmp, 'wb')
  if not f then return false, 'store.save: cannot write ' .. tmp .. ': ' .. tostring(ferr) end
  local wok, werr = f:write(text)
  f:close()
  if not wok then
    os.remove(tmp)
    return false, 'store.save: write failed: ' .. tostring(werr)
  end
  local rok, rerr = os.rename(tmp, store.path(dir))
  if not rok then
    os.remove(tmp)
    return false, 'store.save: rename failed: ' .. tostring(rerr)
  end
  return true
end

-- load returns data, or nil plus a reason. A missing file is the first-run case
-- and yields defaults; a file that exists but does not parse or validate is an
-- error, never a silent reset.
function store.load(dir)
  local path = store.path(dir)
  local f = io.open(path, 'rb')
  if not f then return store.defaults(), nil end
  local text = f:read('*a')
  f:close()
  if text == '' then
    return nil, 'store.load: ' .. path .. ' is empty'
  end
  local data, derr = store.decode(text)
  if not data then return nil, derr .. ' (' .. path .. ')' end
  local ok, err = store.validate(data)
  if not ok then return nil, err .. ' (' .. path .. ')' end
  return data, nil
end

return store