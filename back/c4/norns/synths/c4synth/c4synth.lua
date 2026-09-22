-- c4synth: browse and activate the 128 presets of a Source Audio C4 Synth
-- over USB HID, via the c4hid bridge at dust/c4hid/c4hid.
--
-- Controls:
--   E2  scroll (always; presets / menu items / params per view)
--   E3  page (per view)
--   K1  OS/menu button - not handled here
--   K2  back to the parent / main screen from every view (list opens the menu)
--   K3  engage preset (list), open menu item (menu), edit param (detail),
--       mark param (rbuild), toggle group (rgroups), start/pause (rrun)
-- Settings page (via menu -> Settings page):
--   E2/E3 adjust the edited value (E3 steps x8); K3 saves to the preset +
--   recalls it so you hear it, K2 cancels the edit; K2 back to the list
--
-- The C4 must be plugged into a norns USB host port; the bridge is built
-- on-device (see back/c4/docs/norns-port.md). lib/ modules are excluded from
-- the norns script menu by the core's scan filter.

package.path = norns.state.path .. 'lib/?.lua;' .. package.path

-- Reload-safe: this core's Script.clear does not reset package.loaded (only
-- 'asl' is special-cased), so on script reload a cached module would keep its
-- old poller metro (already stop()ed by clear) and never complete calls - the
-- "device is busy" bug. c4model is also cleared so option-name edits on disk
-- actually show up on the next run. Drop the cache so each load is fresh.
package.loaded['c4hid'] = nil
package.loaded['state'] = nil
package.loaded['c4model'] = nil
package.loaded['rnd'] = nil

local state = require 'state'

local c4model = require 'c4model'

-- redraw hook for the randomizer loop (rnd is async via the bridge poller).
state.rnd.on_change = function()
    if not state.busy then
        screen.ping()
        redraw()
    end
end

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
                state.status = 'device busy - retry'
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
    norns.enc.sens(2, 2)
    norns.enc.accel(3, false)
    norns.enc.sens(3, 2)
    c4metro:start()
    state.scan()
end

function redraw()
    screen.aa(0)
    screen.font_face(1)
    screen.font_size(8)
    screen.clear()
    if state.view == 'detail' then
        draw_detail()
    elseif state.view == 'menu' then
        draw_menu()
    elseif state.view == 'rbuild' then
        draw_rbuild()
    elseif state.view == 'rgroups' then
        draw_rgroups()
    elseif state.view == 'rrun' then
        draw_rrun()
    else
        draw_list()
    end
    screen.update()
end

function draw_list()
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
    screen.move(0, 63)
    screen.text_trim('E3 page K2 menu K3 load', 124)
end

function draw_menu()
    screen.move(0, 8)
    screen.level(15)
    screen.text_trim('Menu  ' .. (state.status or ''), 124)

    for row = 0, state.ROWS_VISIBLE - 1 do
        local ri = state.menu_top + row
        if ri < #state.menu_items then
            local y = 20 + row * state.NAME_ROW_H
            local item = state.menu_items[ri + 1]
            if ri == state.menu_cursor then
                screen.level(15)
                screen.move(0, y)
                screen.text('>')
            else
                screen.level(6)
            end
            screen.move(8, y)
            screen.text_trim(item.name, 116)
        end
    end

    screen.level(4)
    screen.move(0, 63)
    screen.text_trim('K2 back K3 open', 124)
end

function draw_rbuild()
    local sel = state.rnd.sel.rows
    local nchecked = 0
    for _ in pairs(sel) do nchecked = nchecked + 1 end

    screen.move(0, 8)
    screen.level(15)
    screen.text_trim('Build group  [' .. nchecked .. ']  ' .. (state.status or ''), 124)

    for row = 0, state.ROWS_VISIBLE - 1 do
        local ri = state.rb_top + row
        if ri < #state.rnd.eligible then
            local y = 20 + row * state.NAME_ROW_H
            local e = state.rnd.eligible[ri + 1]
            if ri == state.rb_cursor then
                screen.level(15)
            else
                screen.level(6)
            end
            screen.move(0, y)
            screen.text('>')
            screen.move(8, y)
            screen.text_trim(truncate(e.label, 18), 92)
            if sel[e.rn] then
                screen.level(15)
                screen.move(124, y)
                screen.text_right('x')
            else
                screen.level(6)
                screen.move(124, y)
                screen.text_right(' ')
            end
        end
    end

    screen.level(4)
    screen.move(0, 63)
    screen.text_trim('E3 page K3 mark K2 menu', 124)
end

function draw_rgroups()
    local n = #state.rnd.groups
    local nen = 0
    for _, g in ipairs(state.rnd.groups) do
        if g.enabled then nen = nen + 1 end
    end

    screen.move(0, 8)
    screen.level(15)
    screen.text_trim('Groups  ' .. nen .. '/' .. n .. '  ' .. (state.status or ''), 124)

    for row = 0, state.ROWS_VISIBLE - 1 do
        local ri = state.rg_top + row
        if ri < n then
            local y = 20 + row * state.NAME_ROW_H
            local g = state.rnd.groups[ri + 1]
            if ri == state.rg_cursor then
                screen.level(15)
                screen.move(0, y)
                screen.text('>')
            else
                screen.level(6)
            end
            screen.move(8, y)
            screen.text_trim(truncate(g.name, 20), 96)
            screen.level(g.enabled and 15 or 6)
            screen.move(124, y)
            screen.text_right(g.enabled and 'on' or 'off')
        end
    end

    screen.level(4)
    screen.move(0, 63)
    screen.text_trim('E3 page K3 toggle K2 back', 124)
end

function draw_rrun()
    local rn = state.rnd
    local n = #rn.run_rows

    local header = 'Rand #' .. string.format('%02d', math.max(rn.idx, 0))
    if rn.name and rn.name ~= '' then header = header .. ' ' .. rn.name end
    if rn.running then
        header = header .. '  #' .. rn.tick .. '  ' .. math.max(0, rn.due - os.time()) .. 's'
    elseif rn.paused then
        header = header .. '  paused'
    end
    if rn.stopping then header = header .. '  restoring' end
    if rn.error and rn.error ~= '' then header = header .. ' !' .. truncate(rn.error, 10) end
    screen.move(0, 8)
    screen.level(15)
    screen.text_trim(header, 124)

    for row = 0, state.ROWS_VISIBLE - 1 do
        local ri = state.rr_top + row
        if ri < n then
            local y = 20 + row * state.NAME_ROW_H
            local e = c4model.row(rn.run_rows[ri + 1])
            if ri == state.rr_cursor then
                screen.level(15)
                screen.move(0, y)
                screen.text('>')
            else
                screen.level(6)
            end
            screen.move(8, y)
            screen.text_trim(truncate(e.label, 14), 64)
            screen.level(ri == state.rr_cursor and 15 or 8)
            screen.move(124, y)
            local rownum = rn.run_rows[ri + 1]
            screen.text_right(c4model.display(rownum, c4model.raw(rn.body, rownum)))
        end
    end

    screen.level(4)
    screen.move(0, 63)
    if rn.running then
        screen.text_trim('E3 page K2 back K3 pause', 124)
    else
        screen.text_trim('E3 page K2 back K3 start', 124)
    end
end

function draw_detail()
    local d = state.detail

    -- header: preset number + name
    local header = '#'
    if d.idx >= 0 then header = header .. string.format('%02d', d.idx) end
    if d.name and d.name ~= '' then header = header .. ' ' .. d.name end
    if d.idx >= 0 and d.idx == state.active then
        header = header .. ' *'
    end
    if d.editing and d.edit_row >= 1 then
        header = header .. ' edit:' .. d.rows[d.edit_row].label
    end
    screen.move(0, 8)
    screen.level(15)
    screen.text_trim(header, 124)

    -- parameter rows
    for row = 0, state.ROWS_VISIBLE - 1 do
        local ri = d.top + row
        if ri < #d.rows then
            local y = 20 + row * state.NAME_ROW_H
            local entry = d.rows[ri + 1]
            if ri == d.cursor then
                screen.level(15)
                screen.move(0, y)
                screen.text('>')
            else
                screen.level(6)
            end
            screen.move(8, y)
            screen.text_trim(truncate(entry.label, 14), 64)
            screen.level(ri == d.cursor and 15 or 8)
            screen.move(124, y)
            local val = entry.value
            if d.editing and (ri + 1) == d.edit_row then val = val .. ' *' end
            screen.text_right(val)
        end
    end

    -- footer hints
    screen.level(4)
    screen.move(0, 63)
    if d.editing then
        screen.text_trim('E2/E3 value K2 cancel K3 save', 124)
    else
        screen.text_trim('E3 page K2 back K3 edit', 124)
    end
end

function enc(n, d)
    print('c4dbg enc ' .. n .. ' ' .. d)
    if state.busy then return end
    if state.view == 'detail' then
        if state.detail.editing then
            if n == 2 then
                state.edit_step(d)
            elseif n == 3 then
                state.edit_step(d * 8)
            end
        else
            if n == 2 then
                state.detail_move(d)
            elseif n == 3 then
                state.detail_page(d)
            end
        end
    elseif state.view == 'rbuild' then
        if n == 2 then
            state.rb_move(d)
        elseif n == 3 then
            state.rb_move(d > 0 and state.ROWS_VISIBLE or -state.ROWS_VISIBLE)
        end
    elseif state.view == 'rgroups' then
        if n == 2 then
            state.rg_move(d)
        elseif n == 3 then
            state.rg_move(d > 0 and state.ROWS_VISIBLE or -state.ROWS_VISIBLE)
        end
    elseif state.view == 'rrun' then
        if n == 2 then
            state.rr_move(d)
        elseif n == 3 then
            state.rr_move(d > 0 and state.ROWS_VISIBLE or -state.ROWS_VISIBLE)
        end
    elseif state.view == 'menu' then
        if n == 2 then
            state.menu_move(d)
        elseif n == 3 then
            state.menu_move(d > 0 and state.ROWS_VISIBLE or -state.ROWS_VISIBLE)
        end
    else
        if n == 2 then
            state.move(d)
        elseif n == 3 then
            state.page(d)
        end
    end
end

function key(n, z)
    print('c4dbg key ' .. n .. ' ' .. z)
    if n == 1 then return end -- K1 is the OS button on this norns
    if z ~= 1 then return end -- ignore releases
    if state.busy then return end
    if state.view == 'detail' then
        if state.detail.editing then
            if n == 2 then
                state.cancel_edit()
            elseif n == 3 then
                state.commit_edit()
            end
        else
            if n == 2 then
                state.close_detail()
            elseif n == 3 then
                state.enter_edit()
            end
        end
    elseif state.view == 'rbuild' then
        if n == 2 then
            state.show_build_menu()
        elseif n == 3 then
            state.rb_toggle()
        end
    elseif state.view == 'rgroups' then
        if n == 2 then
            state.view = 'list'
            state.status = 'C4 Synth'
        elseif n == 3 then
            state.rg_toggle()
        end
    elseif state.view == 'rrun' then
        if n == 2 then
            state.rrun_back()
        elseif n == 3 then
            state.rnd_runtoggle()
        end
    elseif state.view == 'menu' then
        if n == 2 then
            state.close_menu()
        elseif n == 3 then
            state.menu_select()
        end
    else
        if n == 2 then
            state.show_menu()
        elseif n == 3 then
            state.activate_cursor()
        end
    end
end