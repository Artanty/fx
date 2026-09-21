-- lib/c4hid.lua -- async bridge access via a background shell job + poller.
-- The C bridge (dust/c4hid/c4hid) does the (up to ~2 s) USB round-trip; we
-- run it as a background subshell that writes stdout to /tmp/c4hid.out and a
-- completion marker to /tmp/c4hid.done, then a poller metro watches for the
-- marker. matron never blocks on the bridge.
--
-- Bridge output protocol (see back/c4/norns/c4hid.c):
--   identify -> "key<space>value" lines: model/fw/presets/active/channel/node/name
--   names    -> 128 lines "idx<TAB>name"
--   activate -> "ok <idx>" on success, nothing on failure
--   errors   -> stderr, redirected to /tmp/c4hid.err

local c4hid = {}

local BRIDGE = '/home/we/dust/c4hid/c4hid'
local OUT = '/tmp/c4hid.out'
local ERR = '/tmp/c4hid.err'
local DONE = '/tmp/c4hid.done'

local job = false

local function file_exists(p)
    local f = io.open(p, 'rb')
    if f then f:close() return true end
    return false
end

local function cleanup()
    os.remove(OUT)
    os.remove(ERR)
    os.remove(DONE)
end

local poller = metro.init {
    time = 0.05,
    count = -1,
    event = function()
        if job and file_exists(DONE) then
            local reply = ''
            local f = io.open(OUT, 'rb')
            if f then reply = f:read('*a') or '' end
            f:close()
            local err = ''
            local e = io.open(ERR, 'rb')
            if e then err = e:read('*a') or '' end
            e:close()
            local cb = job.cb
            job = false
            cleanup()
            cb(reply, err)
        end
    end
}
poller:start()

-- launch one bridge call; return false if another job is still running.
function c4hid.run(args, parser, cb)
    if job then return false end
    cleanup()
    job = {
        cb = function(out, err)
            cb((parser or function(o) return o end)(out, err))
        end
    }
    os.execute('( ' .. BRIDGE .. ' ' .. args .. ' > ' .. OUT .. ' 2> ' .. ERR
        .. '; echo done > ' .. DONE .. ' ) &')
    return true
end

function c4hid.identify(cb)
    return c4hid.run('identify', function(out, err)
        if out and out ~= '' then
            local info = {}
            for line in out:gmatch('[^\n]+') do
                local k, v = line:match('^(%w+)%s+(%S+)')
                if k then
                    if k == 'model' or k == 'fw' or k == 'presets' or k == 'active' or k == 'channel' then
                        info[k] = tonumber(v)
                    else
                        info[k] = v
                    end
                end
            end
            return { ok = true, info = info, err = err or '' }
        end
        return { ok = false, info = nil, err = (err ~= '' and err) or 'identify: no reply' }
    end, cb)
end

function c4hid.names(cb)
    return c4hid.run('names', function(out, err)
        if out and out ~= '' then
            local names = {}
            local i = 0
            for line in out:gmatch('[^\n]+') do
                local name = line:match('^%d+\t(.*)$')
                if name then name = (name:gsub('[%z\1-\31\127-\255]', '')) end
                names[i] = name or ''
                i = i + 1
            end
            return { ok = true, names = names, err = err or '' }
        end
        return { ok = false, names = {}, err = (err ~= '' and err) or 'names: no reply' }
    end, cb)
end

function c4hid.activate(idx, cb)
    return c4hid.run('activate ' .. tostring(idx), function(out, err)
        return { ok = out ~= '', err = (err ~= '' and err) or 'activate: no reply' }
    end, cb)
end

return c4hid