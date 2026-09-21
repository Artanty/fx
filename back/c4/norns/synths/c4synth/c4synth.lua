-- c4synth: browse and activate the 128 presets of a Source Audio C4 Synth
-- over USB HID, via the c4hid bridge at dust/c4hid/c4hid.
--
-- Controls:
--   E2  scroll presets (1:1)
--   E3  page up/down
--   K2  activate (load) the preset under the cursor
--   K3  rescan (re-read device + preset names)
--
-- The C4 must be plugged into a norns USB host port; the bridge is built
-- on-device (see back/c4/docs/norns-port.md). lib/ modules are excluded from
-- the norns script menu by the core's scan filter.

package.path = norns.state.path .. 'lib/?.lua;' .. package.path

local state = require 'state'

local function truncate(str, max)
    if #str <= max then return str end
    return str:sub(1, max - 1)
end

-- Continuous low-fps redraw so the panel stays live even on builds where the
-- render loop only draws on input events. Guarded so the menu is never drawn
-- over.
local c4metro = metro.init {
    time = 0.033,
    count = -1,
    event = function()
        if _menu.mode == false then
            if state.busy and os.time() > (state.deadline or 0) then
                state.busy = false
                state.status = 'device busy - K3 retry'
                print('c4dbg watchdog: forced unlock')
            end
            screen.ping()
            redraw()
        end
    end
}

function init()
    params:add_group('C4 Synth', 1)
    params:add {
        type = 'trigger',
        id = 'rescan',
        name = 'Rescan Presets',
        action = function() state.scan() end
    }
    norns.enc.accel(2, false)
    norns.enc.sens(2, 4)
    norns.enc.accel(3, false)
    norns.enc.sens(3, 2)
    c4metro:start()
    state.scan()
end

function redraw()
    _c4frames = (_c4frames or 0) + 1
    if _c4frames <= 40 then
        print(string.format('c4dbg redraw %d cur=%s top=%s busy=%s n=%d st=%s',
            _c4frames, tostring(state.cursor), tostring(state.top),
            tostring(state.busy), #state.names, tostring(state.status)))
    end
    screen.aa(0)
    screen.font_face(1)
    screen.font_size(8)
    screen.clear()

    -- header
    local header = state.status or ''
    if state.active >= 0 and not state.busy then
        header = header .. '  A' .. string.format('%02d', state.active)
    end
    if state.error and state.error ~= '' then
        header = header .. '  !' .. truncate(state.error, 16)
    end
    screen.move(0, 8)
    if state.busy then screen.level(6) else screen.level(15) end
    screen.text(truncate(header, 24))
    screen.level(15)

    -- preset rows
    for row = 0, state.ROWS_VISIBLE - 1 do
        local idx = state.top + row
        if idx < 128 then
            local y = 20 + row * state.NAME_ROW_H
            if idx == state.cursor then
                screen.level(15)
                screen.move(0, y)
                screen.text('>')
            else
                screen.level(6)
            end
            screen.move(8, y)
            screen.text(truncate(state.names[idx] or '', 23))
            if idx == state.active and idx ~= state.cursor then
                screen.level(15)
                screen.move(124, y)
                screen.text('*')
            end
        end
    end

    -- footer hints
    screen.level(4)
    screen.move(0, 64)
    screen.text('E2 move E3 page K2 load K3 scan')

    screen.update()
end

function enc(n, d)
    print('c4dbg enc ' .. n .. ' ' .. d)
    if state.busy then return end
    if n == 2 then
        state.move(d)
    elseif n == 3 then
        state.page(d)
    end
end

function key(n, z)
    print('c4dbg key ' .. n .. ' ' .. z)
    if z ~= 1 then return end -- ignore releases
    if state.busy then return end
    if n == 2 then
        state.activate_cursor()
    elseif n == 3 then
        state.scan()
    end
end