-- lib/state.lua -- shared script state and actions (M1 preset-name browser)

local state = {}

state.names = {}
state.active = -1
state.cursor = 0
state.top = 0
state.busy = false
state.status = 'starting'
state.error = ''

state.NAME_ROW_H = 8
state.ROWS_VISIBLE = 6

local c4hid = require 'c4hid'

-- Move cursor (E2). d may be >1 with accel.
function state.move(d)
    if #state.names == 0 then return end
    state.cursor = math.floor(state.cursor + d)
    if state.cursor < 0 then state.cursor = 0 end
    if state.cursor > 127 then state.cursor = 127 end
    state.keep_visible()
end

-- Page cursor (E3).
function state.page(d)
    if #state.names == 0 then return end
    state.cursor = math.floor(state.cursor + (d > 0 and state.ROWS_VISIBLE or -state.ROWS_VISIBLE))
    if state.cursor < 0 then state.cursor = 0 end
    if state.cursor > 127 then state.cursor = 127 end
    state.keep_visible()
end

function state.keep_visible()
    if state.cursor < state.top then state.top = state.cursor end
    if state.cursor >= state.top + state.ROWS_VISIBLE then
        state.top = state.cursor - state.ROWS_VISIBLE + 1
    end
end

-- Full refresh: read identity + all names (async; no blocking of the UI).
function state.scan(callback)
    state.busy = true
    state.deadline = os.time() + 3
    state.status = 'scanning...'
    state.error = ''
    c4hid.identify(function(id)
        print('c4dbg scan identify cb ok=' .. tostring(id.ok) .. ' active=' .. tostring(id.info and id.info.active))
        if not id.ok then
            state.busy = false
            state.status = 'no device'
            state.error = id.err or 'identify failed'
            print('c4dbg scan identify failed: ' .. tostring(id.err))
            if callback then callback() end
            state.finish()
            return
        end
        state.active = tonumber(id.info and id.info.active) or state.active
        state.status = 'C4 Synth'
        c4hid.names(function(all)
            print('c4dbg scan names cb ok=' .. tostring(all.ok) .. ' n=' .. tostring(all.names and #all.names or 0))
            if all.ok then
                state.names = all.names
                state.status = (#state.names > 0) and state.status or 'empty flash'
            else
                state.status = 'names failed'
                state.error = all.err or ''
                print('c4dbg scan names failed: ' .. tostring(all.err))
            end
            state.busy = false
            if callback then callback() end
            state.finish()
        end)
    end)
end

-- Load (activate) the preset under the cursor on the pedal.
function state.activate_cursor()
    if state.busy then return end
    if #state.names == 0 then
        state.status = 'no names yet - press K3'
        return
    end
    state.busy = true
    state.deadline = os.time() + 4
    c4hid.activate(state.cursor, function(r)
        state.busy = false
        print('c4dbg activate cb ok=' .. tostring(r.ok) .. ' st=' .. tostring(state.status))
        if r.ok then
            state.active = state.cursor
            state.status = 'now live: ' .. tostring(state.cursor)
        else
            state.status = 'activate failed'
            state.error = r.err or ''
        end
        state.finish()
    end)
end

function state.finish()
    redraw()
end

return state
