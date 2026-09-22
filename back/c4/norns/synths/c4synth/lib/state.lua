-- lib/state.lua -- shared script state and actions (browse + settings page)

local state = {}

state.names = {}
state.active = -1
state.cursor = 0
state.top = 0
state.busy = false
state.status = 'starting'
state.error = ''

state.view = 'list'
state.detail = { idx = -1, name = '', rows = {}, body = {}, orig = {}, cursor = 0, top = 0, editing = false, edit_row = 0, edit_value = 0 }
state.menu_ctx = 'list'
state.menu_items = {
  { name = 'Settings page', action = 'detail' },
  { name = 'Randomizer build', action = 'rbuild' },
  { name = 'Randomizer groups', action = 'rgroups' },
  { name = 'Randomizer run', action = 'rrun' },
}
state.menu_cursor = 0
state.menu_top = 0

-- randomizer view cursors (pages below)
state.rb_cursor = 0
state.rb_top = 0
state.rg_cursor = 0
state.rg_top = 0
state.rr_cursor = 0
state.rr_top = 0

state.NAME_ROW_H = 8
state.ROWS_VISIBLE = 5

local c4hid = require 'c4hid'
local c4model = require 'c4model'
local rnd = require 'rnd'
state.rnd = rnd

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

-- Open the settings page for the preset under the cursor (fetch + decode body).
-- Callable from the action menu (K2 opens the menu; menu → Settings page).
function state.open_detail()
    if state.busy or state.view ~= 'menu' then return end
    if #state.names == 0 then
        state.status = 'no names yet - rescan'
        state.view = 'list'
        return
    end
    state.view = 'detail'
    state.busy = true
    state.deadline = os.time() + 4
    c4hid.body(state.cursor, function(r)
        state.busy = false
        print('c4dbg detail cb ok=' .. tostring(r.ok) .. ' idx=' .. tostring(state.cursor))
        if not r.ok then
            state.view = 'list'
            state.status = 'read failed'
            state.error = r.err or ''
        else
            state.detail.idx = state.cursor
            state.detail.name = state.names[state.cursor] or ''
            state.detail.body = r.data
            state.detail.orig = {}
            for i = 0, 127 do state.detail.orig[i] = r.data[i] end
            state.detail.rows = c4model.decode(r.data)
            state.detail.cursor = 0
            state.detail.top = 0
            state.detail.editing = false
            state.detail.edit_row = 0
            state.detail.edit_value = 0
            state.status = 'C4 Synth'
        end
        state.finish()
    end)
end

-- Refresh the values on the settings page (same preset, re-fetch body).
function state.refresh_detail()
    if state.busy or state.view ~= 'detail' then return end
    local idx = state.detail.idx
    if idx < 0 then return end
    state.busy = true
    state.deadline = os.time() + 4
    c4hid.body(idx, function(r)
        state.busy = false
        if r.ok then
            state.detail.body = r.data
            state.detail.orig = {}
            for i = 0, 127 do state.detail.orig[i] = r.data[i] end
            state.detail.rows = c4model.decode(r.data)
            state.detail.editing = false
            state.detail.edit_row = 0
            state.detail.edit_value = 0
            state.status = 'C4 Synth'
        else
            state.status = 'read failed'
            state.error = r.err or ''
        end
        state.finish()
    end)
end

-- Action menu (K2 from the list). Items are appended over time.
function state.show_menu()
    if state.busy or state.view ~= 'list' then return end
    state.menu_ctx = 'list'
    state.menu_items = {
        { name = 'Settings page', action = 'detail' },
        { name = 'Randomizer build', action = 'rbuild' },
        { name = 'Randomizer groups', action = 'rgroups' },
        { name = 'Randomizer run', action = 'rrun' },
    }
    state.menu_cursor = 0
    state.menu_top = 0
    state.view = 'menu'
end

-- Randomizer build page menu (K2 on the builder): save / clear / back.
function state.show_build_menu()
    if state.busy or state.view ~= 'rbuild' then return end
    state.menu_ctx = 'rbuild'
    state.menu_items = {
        { name = 'Save group', action = 'rb_save' },
        { name = 'Clear selection', action = 'rb_clear' },
        { name = 'Back', action = 'rb_back' },
    }
    state.menu_cursor = 0
    state.menu_top = 0
    state.view = 'menu'
end

-- K2 in any menu always pops back to the MAIN screen (list), never to the
-- page the menu was opened from - otherwise rbuild <-> build-menu cycles trap
-- the user off the list (they cannot return to the main screen).
function state.close_menu()
    state.view = 'list'
    state.status = 'C4 Synth'
    state.menu_ctx = 'list'
end

function state.menu_move(d)
    local n = #state.menu_items
    if n == 0 then return end
    state.menu_cursor = math.max(0, math.min(n - 1, state.menu_cursor + d))
    if state.menu_cursor < state.menu_top then state.menu_top = state.menu_cursor end
    if state.menu_cursor >= state.menu_top + state.ROWS_VISIBLE then
        state.menu_top = state.menu_cursor - state.ROWS_VISIBLE + 1
    end
end

-- Execute the item under the menu cursor (K3 in the menu).
function state.menu_select()
    if #state.menu_items == 0 then return end
    local item = state.menu_items[state.menu_cursor + 1]
    if item.action == 'detail' then
        state.open_detail()
    elseif item.action == 'rbuild' then
        state.open_rbuild()
    elseif item.action == 'rgroups' then
        state.open_rgroups()
    elseif item.action == 'rrun' then
        state.open_rrun()
    elseif item.action == 'rnd_toggle' then
        state.rnd_runtoggle()
    elseif item.action == 'rrun_back' then
        if state.rnd.running or state.rnd.paused then state.rnd.stop() end
        state.view = 'list'
        state.menu_ctx = 'list'
        state.status = state.rnd.stopping and 'restoring preset...' or 'C4 Synth'
    elseif item.action == 'rb_save' then
        state.rb_save()
    elseif item.action == 'rb_clear' then
        state.rb_clear()
        state.view = 'rbuild'
        state.menu_ctx = 'rbuild'
    elseif item.action == 'rb_back' then
        state.view = 'list'
        state.menu_ctx = 'list'
        state.status = 'C4 Synth'
    end
end

-- Randomizer: build page -----------------------------------------------------

-- Open the group-builder: the full param list (minus exclusions) with a
-- check for each row currently selected into the working set.
function state.open_rbuild()
    if state.busy or state.view ~= 'menu' then return end
    state.menu_ctx = 'rbuild'
    state.rb_cursor = 0
    state.rb_top = 0
    state.view = 'rbuild'
    state.status = 'build group - K3 toggles param'
end

function state.rb_move(d)
    local n = #state.rnd.eligible
    if n == 0 then return end
    state.rb_cursor = math.floor(state.rb_cursor + d)
    if state.rb_cursor < 0 then state.rb_cursor = 0 end
    if state.rb_cursor > n - 1 then state.rb_cursor = n - 1 end
    if state.rb_cursor < state.rb_top then state.rb_top = state.rb_cursor end
    if state.rb_cursor >= state.rb_top + state.ROWS_VISIBLE then
        state.rb_top = state.rb_cursor - state.ROWS_VISIBLE + 1
    end
end

function state.rb_toggle()
    local e = state.rnd.eligible[state.rb_cursor + 1]
    if not e then return end
    if state.rnd.sel.rows[e.rn] then
        state.rnd.sel.rows[e.rn] = nil
    else
        state.rnd.sel.rows[e.rn] = true
    end
end

-- Save the current working selection as a new enabled group.
function state.rb_save()
    local rows = {}
    for rn in pairs(state.rnd.sel.rows) do rows[#rows + 1] = rn end
    if #rows == 0 then
        state.status = 'no params selected'
        return
    end
    table.sort(rows)
    local name = 'grp'
    local i = 1
    while true do
        local cand = 'grp ' .. i
        local taken = false
        for _, g in ipairs(state.rnd.groups) do
            if g.name == cand then taken = true break end
        end
        if not taken then name = cand break end
        i = i + 1
    end
    state.rnd.groups[#state.rnd.groups + 1] = { name = name, enabled = true, rows = rows }
    state.rnd.sel.rows = {}
    state.rnd.save()
    state.status = 'saved ' .. name
    state.rg_cursor = #state.rnd.groups - 1
    state.rg_top = 0
    state.view = 'rgroups'
    state.menu_ctx = 'list'
end

function state.rb_clear()
    state.rnd.sel.rows = {}
    state.status = 'selection cleared'
end

-- Randomizer: groups page ----------------------------------------------------

function state.open_rgroups()
    if state.busy or state.view ~= 'menu' then return end
    state.rg_cursor = 0
    state.rg_top = 0
    state.view = 'rgroups'
    state.status = 'groups - K3 toggles on/off'
end

function state.rg_move(d)
    local n = #state.rnd.groups
    if n == 0 then return end
    state.rg_cursor = math.floor(state.rg_cursor + d)
    if state.rg_cursor < 0 then state.rg_cursor = 0 end
    if state.rg_cursor > n - 1 then state.rg_cursor = n - 1 end
    if state.rg_cursor < state.rg_top then state.rg_top = state.rg_cursor end
    if state.rg_cursor >= state.rg_top + state.ROWS_VISIBLE then
        state.rg_top = state.rg_cursor - state.ROWS_VISIBLE + 1
    end
end

function state.rg_toggle()
    local g = state.rnd.groups[state.rg_cursor + 1]
    if not g then return end
    g.enabled = not g.enabled
    state.rnd.save()
end

-- Randomizer: run page -------------------------------------------------------

-- Open the run page: fetch the ACTIVE preset body, cache the union of enabled
-- groups' rows, and show their live values. Start happens from the run menu.
function state.open_rrun()
    if state.busy or state.view ~= 'menu' then return end
    if state.active < 0 then
        state.status = 'load a preset first (K3)'
        return
    end
    state.view = 'rrun'
    state.rr_cursor = 0
    state.rr_top = 0
    if state.rnd.running then
        state.status = 'C4 Synth'
        return
    end
    state.busy = true
    state.deadline = os.time() + 4
    c4hid.body(state.active, function(r)
        state.busy = false
        print('c4dbg rrun cb ok=' .. tostring(r.ok) .. ' idx=' .. tostring(state.active))
        if not r.ok then
            state.view = 'list'
            state.status = 'read failed'
            state.error = r.err or ''
        else
            state.rr_cursor = 0
            state.rr_top = 0
            state.rnd.idx = state.active
            state.rnd.name = state.names[state.active] or ''
            state.rnd.orig = {}
            state.rnd.body = {}
            for i = 0, 127 do
                state.rnd.orig[i] = r.data[i]
                state.rnd.body[i] = r.data[i]
            end
            state.rnd.run_rows = state.rnd.union_rows()
            state.status = 'C4 Synth'
        end
        state.finish()
    end)
end

function state.rr_move(d)
    local n = #state.rnd.run_rows
    if n == 0 then return end
    state.rr_cursor = math.floor(state.rr_cursor + d)
    if state.rr_cursor < 0 then state.rr_cursor = 0 end
    if state.rr_cursor > n - 1 then state.rr_cursor = n - 1 end
    if state.rr_cursor < state.rr_top then state.rr_top = state.rr_cursor end
    if state.rr_cursor >= state.rr_top + state.ROWS_VISIBLE then
        state.rr_top = state.rr_cursor - state.ROWS_VISIBLE + 1
    end
end

-- K3 on the run page: start the loop or pause it (values held). The pause
-- resumes from the last randomized values on the next K3.
function state.rnd_runtoggle()
    if state.view ~= 'rrun' then return end
    if state.rnd.running then
        state.rnd.pause()
        state.status = 'paused - last values held'
    else
        state.rnd.start()
        if state.rnd.running then
            state.status = 'randomizer on - every 5 s'
        else
            state.status = 'not started - ' .. (state.rnd.error ~= '' and state.rnd.error or 'busy')
        end
    end
end

-- K2 on the run page: leave for the main screen, restoring the original
-- preset if the loop ran or was paused.
function state.rrun_back()
    if state.view ~= 'rrun' then return end
    if state.rnd.running or state.rnd.paused then state.rnd.stop() end
    state.view = 'list'
    state.menu_ctx = 'list'
    state.status = state.rnd.stopping and 'restoring preset...' or 'C4 Synth'
end

function state.close_detail()
    state.view = 'list'
    state.detail.idx = -1
    state.detail.name = ''
    state.detail.rows = {}
    state.detail.body = {}
    state.detail.orig = {}
    state.detail.editing = false
    state.detail.edit_row = 0
    state.detail.edit_value = 0
    state.status = 'C4 Synth'
end

-- Parameter editing -----------------------------------------------------------

-- Enter value-edit mode for the row under the cursor (K2 in detail view).
function state.enter_edit()
    local d = state.detail
    if d.editing or #d.rows == 0 or d.idx < 0 then return end
    d.edit_row = d.cursor + 1
    d.edit_value = c4model.raw(d.body, d.edit_row)
    d.editing = true
    state.status = 'edit'
end

-- Adjust the edited value by d (wrap at the row's max). E2 = fine, E3 = coarse.
function state.edit_step(d)
    local d2 = state.detail
    if not d2.editing or d2.edit_row < 1 then return end
    local max = c4model.row(d2.edit_row).max
    d2.edit_value = (d2.edit_value + d) % (max + 1)
    c4model.set(d2.body, d2.edit_row, d2.edit_value)
    local e = d2.rows[d2.edit_row]
    e.value = c4model.display(d2.edit_row, d2.edit_value)
    e.num = d2.edit_value
end

-- Cancel editing: restore the fetched body and re-decode (K3 while editing).
function state.cancel_edit()
    local d = state.detail
    if not d.editing then return end
    for i = 0, 127 do d.body[i] = d.orig[i] or 0 end
    d.rows = c4model.decode(d.body)
    d.editing = false
    d.edit_row = 0
    d.edit_value = 0
    state.status = 'C4 Synth'
end

-- Commit the working body to the pedal slot and recall it (K2 while editing).
function state.commit_edit()
    local d = state.detail
    if state.busy or not d.editing or d.idx < 0 then return end
    state.busy = true
    state.deadline = os.time() + 8
    state.status = 'saving...'
    c4hid.commit(d.idx, d.body, d.name, function(r)
        state.busy = false
        print('c4dbg commit cb ok=' .. tostring(r.ok) .. ' idx=' .. tostring(d.idx))
        if r.ok then
            state.active = d.idx
            d.editing = false
            d.edit_row = 0
            d.edit_value = 0
            d.rows = c4model.decode(d.body)
            state.status = 'saved #' .. string.format('%02d', d.idx)
        else
            state.status = 'save failed'
            state.error = r.err or ''
        end
        state.finish()
    end)
end

function state.detail_move(d)
    local n = #state.detail.rows
    if n == 0 then return end
    state.detail.cursor = math.max(0, math.min(n - 1, state.detail.cursor + d))
    if state.detail.cursor < state.detail.top then state.detail.top = state.detail.cursor end
    if state.detail.cursor >= state.detail.top + state.ROWS_VISIBLE then
        state.detail.top = state.detail.cursor - state.ROWS_VISIBLE + 1
    end
end

function state.detail_page(d)
    local n = #state.detail.rows
    if n == 0 then return end
    local step = state.ROWS_VISIBLE
    if d < 0 then step = -step end
    state.detail.cursor = math.max(0, math.min(n - 1, state.detail.cursor + step))
    if state.detail.cursor < state.detail.top then state.detail.top = state.detail.cursor end
    if state.detail.cursor >= state.detail.top + state.ROWS_VISIBLE then
        state.detail.top = state.detail.cursor - state.ROWS_VISIBLE + 1
    end
end

function state.finish()
    redraw()
end

return state
