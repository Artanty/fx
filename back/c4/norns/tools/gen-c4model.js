// Generate back/c4/norns/synths/c4synth/lib/c4model.lua from c4Model.js
// WORKBENCH_CONTROL_SPECS. Keeps the norns decoder in sync with the web model.
const fs = require('fs');
const path = require('path');
const m = require('../../src/c4Model.js');
const { optsFor, labelFor } = require('./c4-overlay.js');

const specs = m.WORKBENCH_CONTROL_SPECS;

const HEAD = `-- lib/c4model.lua -- C4 preset-body decoder/encoder.
-- Generated from back/c4/src/c4Model.js WORKBENCH_CONTROL_SPECS; do not edit by hand.
-- decode(body) with body[0..127] int 0..255 returns display rows
-- { label, value, num }; raw()/set() read and write a single row's numeric
-- value in-place (Lua 5.1-safe, no bitwise ops). All rows are single-byte
-- (mask == max << shift, mask <= 255).

local m = {}

local ROWS = {
`;

const TAIL = `}

local function display(r, raw)
  if r.type == 'knob' then
    return tostring(raw)
  elseif r.type == 'toggle' then
    return raw == 0 and 'off' or 'on'
  else
    return r.opts and (r.opts[raw + 1] or tostring(raw)) or tostring(raw)
  end
end

-- Decode the 128-byte preset body into display rows.
function m.decode(body)
  local rows = {}
  for i = 1, #ROWS do
    local r = ROWS[i]
    local label = r.label
    local raw = math.floor((body[r.idx] or 0) / (2 ^ r.shift)) % (r.max + 1)
    rows[#rows + 1] = { label = label, value = display(r, raw), num = raw }
  end
  return rows
end

function m.row(rownum)
  return ROWS[rownum]
end

function m.count()
  return #ROWS
end

-- Raw numeric value (0..max) of a row in a body.
function m.raw(body, rownum)
  local r = ROWS[rownum]
  return math.floor((body[r.idx] or 0) / (2 ^ r.shift)) % (r.max + 1)
end

-- Display string for a row's numeric value.
function m.display(rownum, raw)
  return display(ROWS[rownum], raw)
end

-- Set a row's numeric value in-place in body[0..127]; returns body.
-- Recomposes the byte from its low bits + new field + high bits without
-- touching the neighbouring fields (no bitwise ops in Lua 5.1).
function m.set(body, rownum, raw)
  local r = ROWS[rownum]
  local b = body[r.idx] or 0
  local lvl = 2 ^ r.shift
  local field = math.floor(b / lvl) % (r.max + 1)
  local lo = b % lvl
  raw = raw % (r.max + 1)
  body[r.idx] = math.floor((math.floor(b / lvl) - field + raw) * lvl) + lo
  return body
end

return m
`;

const DATA = specs.map(s => {
  const fields = [`idx=${s.index}`, `type='${s.type}'`, `shift=${s.shift}`, `mask=${s.mask}`, `max=${s.max}`];
  const esc = (t) => t.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const label = labelFor(s.name).replace(/_/g, ' ');
  fields.push(`label='${esc(label)}'`);
  if (s.options) {
    const names = optsFor(s.name, s.options.map(o => o.text)).map(esc);
    fields.push(`opts={${names.map(n => `'${n}'`).join(',')}}`);
  }
  return `  { name='${s.name}', ${fields.join(', ')} },`;
}).join('\n');

fs.writeFileSync(path.join(__dirname, '../synths/c4synth/lib/c4model.lua'), HEAD + DATA + '\n' + TAIL);
console.log('wrote', specs.length, 'rows');