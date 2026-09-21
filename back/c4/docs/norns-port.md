# C4 Synth — norns port checklist

Port the C4 randomizer (and beyond) to a monome **norns**, with the C4 Synth
connected to the norns **USB host port**. The reference implementation is the
web workbench in `back/c4/server.js` + `web/src/app/c4/c4.component.ts`; this
file is the norns-side checklist: architecture, the HID bridge, the Lua script,
and every constant/command that must match the JS protocol.

Decision (2026-09-21): **full-parity** architecture = norns Lua script + a
small zero-dependency **C HID bridge** on the norns OS. No MIDI CC mapping, no
MIDI channel coupling — the bridge talks the same raw-HID Neuro protocol as
`c4Protocol.js`, so the whole 128-byte body (bit-packed fields included) stays
reachable, and random presets can be persisted to any of the 128 slots.

## Architecture

```
norns screen/encoders/keys (Lua script, dust/scripts/c4synth/)
   │  io.popen / os.execute  (spawn the bridge, parse text output)
   ▼
c4hid  (static ARMv7 C binary, zero deps, /dev/hidraw)
   │  38-byte interrupt reports, framing per HID report below
   ▼
C4 Synth  (VID 0x29a4, PID 0x0302) on norns USB host port
```

The norns is reached over the LAN at `we@192.168.1.70` (password `sleep`) using
`scp`/`ssh`; script package lives under `/home/we/dust/code/c4synth/` (this
core has no `dust/scripts/`) and the bridge binary at `/home/we/dust/c4hid/c4hid`.
(The bottom-port USB-gadget filesystem/SSH was not used — wifi SSH is enough.)

## HID framing (must match c4Hid.js / c4Protocol.js)

- Report length `REPORT_LEN = 38`: `r[0] = command byte`, `r[1..] = args/addr`.
- Payload per read command `PAYLOAD_LEN = 32`; EEPROM size 256.
- `C4Hid.send` prefixes the 38-byte report with a leading `0x00` **report ID**
  on the Windows HID-class API. On Linux `/dev/hidraw` the report-ID byte is
  presented differently — confirm empirically on the device before trusting
  any command (see Risks). Expected Linux write() = 38 raw bytes, read() = 38
  bytes back.
- Commands (from c4Hid.js `CMD`):
  - `0x45` CONFIG_GET → reply `0x32`: `[fw u16][deviceModel][numPresets][activePreset][...]`
  - `0x36` FLASH_READ addr(3) → reply `0x36` + 32 bytes payload
  - `0x77` ACTIVE_SET idx,0 — switch active preset
  - `0x6e` ACTIVE_WRITE idx,1 + 32B name
  - `0x76` ACTIVE_STORE last,off,len + 32B data (writes in 32-byte blocks)
  - `0x70` CTRL_SET liveIndex,hi,lo — realtime (ignored by C4 firmware for
    most params; flash-commit path is the one that works)
  - `0x80`/`0x81` EEPROM_READ/WRITE
- Flash layout (`c4Model.js`): 128 user presets at `0x080000 + idx*0x1000`;
  body `0x20` (128 bytes), name `0xa0` (32 B, NUL-terminated ASCII).
- Writes run `waitMs(500)` per stage in the JS code; the bridge replicates that
  pacing (reads are fast).

## The bridge: `back/c4/norns/c4hid.c`

Plain C, no libc beyond POSIX (open/read/write/readlink on /dev/hidraw + sysfs
scans + vsnprintf). Cross-compiled static for the norns CPU (see Build).

Commands (line-oriented, stdout):

| command | output |
| ------- | ------ |
| `c4hid identify` | `model  <deviceModel>\nfw     <fw u16>\npresets <numPresets>\nactive  <activePreset>\nnode   /dev/hidrawN` |
| `c4hid names` | one row per preset: `idx\tname` (32B, trimmed; empty → ``) |
| `c4hid name <idx>` | `idx\tname` |
| `c4hid body <idx>` | 256 lowercase hex chars (128-byte body) |
| `c4hid activate <idx>` | exit 0 + `ok` on reply |
| `c4hid config` | machine-readable `active`/`midiChannel` etc. (later) |
| `c4hid commit <idx> <256hex> [name]` | (M2) flash-commit + verify + recall |

Discovery: iterate `/dev/hidraw*`, read
`/sys/class/hidraw/hidrawN/device/uevent` (`HID_ID`/`HID_NAME`), match VID
0x29a4 PID 0x0302, open, send CONFIG_GET, require a valid `0x32` reply;
remember the node. Non-zero exit + message on stderr on failure.

## The script: `back/c4/norns/synths/c4synth/`

norns package layout, **single-file style** (this core `dofile`s one entry file
and does NOT auto-load `init/redraw/enc/key.lua`; `ps.lua` is also dead):

```
c4synth/
  c4synth.lua      -- entry: init/redraw/enc/key (dofile'd by the core)
  lib/c4hid.lua    -- bridge wrapper (run bridge, parse stdout)
  lib/state.lua    -- shared state + actions (scan/move/activate)
```

`c4synth.lua` prepends `<script>/lib/?.lua` to `package.path` and requires the
modules by bare name (`require 'state'`). The core's script scan is
`find ~/dust/code -mindepth 2 ... -name "*.lua" | grep -Ev "/(lib|data|crow)/"`,
so `lib/` is excluded from the menu and the entry shows as `C4SYNTH`.

M1 (preset browser):
- `init`: add a `Rescan Presets` trigger param, then `state.scan()`.
- `lib/c4hid.lua` resolves the bridge lazily via `norns.state.path .. '../../c4hid/c4hid'`
  (fallback `_path.dust .. '/c4hid/c4hid'`); runs `c4hid names` / `identify` /
  `activate` via `os.execute` (stdout redirected to `/tmp/c4hid.out`), normalizing
  `os.execute`'s return (number on LuaJIT/5.1, boolean on 5.2+).
- `redraw`: status line (C4 / count / errors + active marker `A00`), 6 scrollable
  rows, `>` cursor, `*` on the active preset, footer hints.
- `enc` E2 scroll (accelerated), E3 page; K2 = `c4hid activate <cursor>` (pedal
  switches sound), K3 = rescan. Bridge calls run inside `clock.run` with a
  `busy` flag so the header shows `scanning...`.

M2+ milestones:
- randomizer core (algorithms/groups ported from `c4.component.ts`), base body
  via `c4hid body <idx>`, write via `c4hid commit <idx> <hex> <name>`;
- hear-and-preview + save-to-slot, scene back/forward, auto-play timer,
  saved-preset browser (JSON files under the script dir).

## Build

Primary (cross, on the dev box): `zig cc -target arm-linux-musleabihf -static -O2 -s c4hid.c -o c4hid`
(zig is a single portable binary; norns = RPi CM3, ARMv7 hard-float).
`build.ps1` in this folder wraps both the ARM build and a x64 musl build for
VM testing.

Cross-gcc variants: `arm-linux-gnueabihf-gcc -static -O2 c4hid.c -o c4hid`
(MSYS2 / WSL Ubuntu with `apt install gcc-arm-linux-gnueabihf`).

On-device build (**used for M1**): this norns image already ships `cc`/`gcc`
and `make` (and has no `pacman`), so no install is needed. Copy `c4hid.c` over
and build in place with `build-norns.sh`:

```
cc -O2 -Wall c4hid.c -o c4hid      # -> ELF 32-bit ARM, LSB, EABI5
```

The bridge links only libc + the kernel's hidraw interface (`/dev/hidraw*`,
`open/write/read/poll`), so no extra HID library is required. `./c4hid` with no
args prints usage; `./c4hid identify` with no C4 attached exits non-zero with
`no hidraw node matches Source Audio VID/PID (0x29a4/0x0302)`.

Note (status 2026-09-21): the dev box has no compiler installed (zig/gcc/clang/
docker all missing) and ziglang.org's CDN was heavily throttled when tested, so
the on-device build above is the path used; `build.ps1` (zig cross) is kept for
when a toolchain is available.

## Deploy

1. Reach the norns over wifi: `scp`/`ssh we@192.168.1.70` (password `sleep`).
2. `scp` the bridge to `/home/we/dust/c4hid/`, build on-device, `chmod +x`.
3. Plug the C4 into the norns HOST port; run `./c4hid identify` then
   `./c4hid names` — acceptance for M1 backend.
4. `scp` the script dir to `/home/we/dust/code/c4synth/`, then re-scan
   (SELECT → RESCAN) and launch; verify the list + K2 activate.

Sanity after any push: `luac -p` every `.lua` (Lua 5.1.5 on-device) and confirm
no BOM/CRLF (PowerShell `-Encoding UTF8` pipes add a BOM that Lua rejects; use
`scp`).

### hidraw permissions (required)

The C4's `/dev/hidrawN` node is created `root:root 0600`, so the norns script
(running as `we`) cannot `open()` it — and the bridge reports that as
"node matched but none answered CONFIG_GET" (it masks the open failure). Grant
access with a udev rule (`we` is in `plugdev`):

```
# /etc/udev/rules.d/50-c4synth.rules
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="29a4", ATTRS{idProduct}=="0302", MODE="0660", GROUP="plugdev"
```

```
sudo udevadm control --reload-rules
sudo udevadm trigger --action=add --subsystem-match=hidraw
```

The node then shows `crw-rw---- root plugdev` and `./c4hid identify` works as
`we` with no sudo. Quick check if it ever regresses: `sudo ./c4hid identify`
(works) vs `./c4hid identify` (fails) ⇒ permissions, not framing.

Reference ground-truth (captured 2026-09-21 from the live C4 via node-hid on
the Lenovo): `back/c4/norns/m1-reference/names.txt` (128 rows, `idx<TAB>name`,
trimmed) + `dump-names.js` to regenerate. The norns `./c4hid names` output
matches these 128 rows (verified: 0 mismatches after masking the reference's
ASCII-folded `0x7F` fill back to the bridge's raw `0xFF`; ~0.5 s for 128 rows).

## Risks / to confirm on-device

- hidraw write framing — **confirmed**: descriptor has no report IDs (vendor
  page 0xFFA0, 38-byte input + 38-byte output report), so 38 raw bytes with no
  leading report-ID byte is correct; CONFIG_GET returns a valid `0x32` reply.
- Node permissions — **resolved** via the udev rule above (was the M1 blocker;
  `root:root 0600` hidraw node, open() EACCES masked as "no CONFIG_GET reply").
- Single hidraw node on this setup (`hidraw0`, `usb-.../input2`) — the composite
  device only exposes interface 2 as HID, so node selection is unambiguous here.
- Norns host-port power: if the C4 isn't enumerated, the Neuro editor's
  "USB-MIDI Skip Power Check" option may be needed (MIDI-path caveat only).
- norns image arch/toolchain — **confirmed** `armv7l`, Linux 5.10.92, version
  231114, `cc`/`gcc` present; bridge builds on-device.
- Single-file script convention — **confirmed**: this core `dofile`s only the
  selected `.lua` (no `init/redraw/enc/key.lua` auto-load, no `ps.lua`), so the
  entry is `c4synth.lua` with `lib/` required modules.
- `screen.display` does **not** exist on this core (the Screen class has
  `screen.update` only) — calling it throws on every redraw and freezes the UI.
  Check `core/screen.lua` (`^Screen\.[a-z_]+ =`) before using a screen method.
- Do **not** `sudo systemctl restart norns-matron` on this image: matron
  segfaults on restart (`ssd1322_update: surface_buffer ((nil))`). Reload scripts
  from the SELECT menu; if matron is already down, `sudo reboot`.
- Bridge calls use blocking `os.execute`; matron's Lua is single-threaded, so
  each scan/activate freezes the UI for the command's duration (~0.5 s). Switch
  to `norns.system_cmd` (async, stdout to callback) if that feels bad.