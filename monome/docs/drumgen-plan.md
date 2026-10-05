# drumgen — generative drum machine for the norns (Logic Pro Drummer style)

Status: **planned, not started** (2026-10-04). Session 1 was research + planning;
implementation starts next session from Phase 0.

## Goal

A standalone norns script, `monome/drumgen/`, that plays generated drum parts
in the spirit of Logic Pro Drummer: pick a style, it generates and mutates a bar
as it loops, with intensity/complexity/swing/variation control and fills — and
everything it generates stays editable in a step grid.

Scope decisions already made by the user:

- **Output**: switchable — norns internal audio *and* MIDI out to external gear.
- **Pattern model**: generator + editable grid (not generator-only).
- **Kit**: 10 voices, no clap.
- **Clock/storage**: own clock with optional MIDI clock sync; patterns saved as
  JSON on the norns.
- **No C4 / HID / c4synth coupling** — the script must not touch the C4 bridge.

## Device facts (verified read-only on 2026-10-04)

Target: `norns.local` / `192.168.1.121`, user `we`, password `sleep`
(`SSH_ASKPASS` trick lives in `back/c4/norns/deploy.ps1`). Kernel
`5.10.92-18-g458e2253667a`, Debian 10.2.1, ARM. Disk: 671 MB free.

**Script packaging** (from `back/c4/docs/norns-port.md` + device listing)

- Package is `<name>/<name>.lua` + `lib/*.lua`, deployed flat to
  `/home/we/dust/code/<name>/`. This core has no `dust/scripts/` directory.
- The core dofiles **only** the selected `.lua`; it does not load
  `init/redraw/enc/key.lua`. All four norns callbacks must be **globals in the
  entry file**.
- `lib/`, `data/`, `crow/` are filtered out of the norns script menu
  (`find ~/dust/code -mindepth 2 ... | grep -Ev "/(lib|data|crow)/"`).
- Entry file must prepend `norns.state.path .. 'lib/?.lua'` to `package.path`
  and **nil out `package.loaded[...]`** for every module before requiring:
  `Script.clear()` does not reset the cache, so a stale module keeps a stopped
  metro (source of the old "device is busy" bug in c4synth).
- Lua on device is **5.1.5** — `luac -p` every file after pushing.
- `screen.display` does not exist on this core; use `screen.update`.

**Timing** — `/home/we/norns/lua/lib/beatclock.lua`

- `BeatClock.new(name)` → `:start(dev_id)`, `:stop(dev_id)`, `:bpm_change(bpm)`,
  `:add_clock_params()` (adds `bpm`, `clock` internal/external, `clock out`),
  `:clock_source_change(source)`, `:enable_midi()`.
- `on_step()` fires **per tick**, `ticks_per_step = 6` at `steps_per_beat = 4`
  (24 ticks/quarter; `metro.time = 60/(ticks_per_step * steps_per_beat * bpm)`).
  At 120 bpm one tick is ~20 ms.
- Plan: set `ticks_per_step = 12` (~10 ms at 120 bpm) so swing (3-tick offsets)
  and ±1-tick humanization are expressible.
- External clock: `external = true` stops the metro and MIDI clock bytes drive
  `tick()`. Outgoing clock: `send = true` (broadcasts 0xF8/FA/FB/FC).
- There is **no swing support** in beatclock or in `core/clock.lua` — swing and
  humanization are ours to implement (offset the odd steps).

**MIDI out** — `/home/we/norns/lua/core/midi.lua`

- `midi.devices` is a table **keyed by id**, not an array — iterate with `pairs`
  (c4synth's `state.pedal_on()` got this wrong, hence the id-guard bug history).
- `Midi:note_on(note, vel, ch)`, `:note_off(note, vel, ch)`, `:cc`, `:send(data)`,
  `:start()`, `:stop()`, `:continue()`, `:clock()`, `Midi.connect(n)`.
- matron owns `/dev/snd/midi*`; the script must go through these objects.

**Audio** — the risk area

- **No `dust` engine binary anywhere on the device** (`find / -name dust` → only
  the `/home/we/dust` directory). Sample playback via dust is off the table.
- `matron/src/snd_file.c` is exposed only as `audio.file_info(path)`
  (channels/frames/rate) — there is **no `audio.play_file`** on this core.
  WAV one-shot playback is therefore almost certainly impossible.
- Built-in Lua engines that ship with the core: `polyperc`
  (params `amp`, `pw`, `release`, `cutoff`, `gain`, `pan`) and `polysub`, in
  `/home/we/norns/lua/engine/`. `polyperc` is a percussive synth voice and is the
  most promising internal-drum source.
- `crone` DSP source is at `/home/we/norns/crone`, but it needs a **compiled**
  patch (faust) and no precompiled patch was found on the device — treat crone as
  unavailable unless Phase 0 proves otherwise.
- The full engine list must be probed **at runtime** inside a script: plain
  `lua` on the device has none of matron's globals (`audio`, `midi`, `clock`,
  `musicutil`, `sequins`, `softclock` are all nil there — verified).
- Third-party drum WAVs do exist on the device
  (`/home/we/dust/audio/o-o-o/samples/{kick000,sd002,ch001}.wav`,
  `/home/we/dust/audio/tehn/drum*.wav`) but there is no way to play them, and
  they live in a community directory that can be uninstalled.

**Available libs** — `/home/we/norns/lua/lib`: `beatclock`, `sequins`,
`pattern_time`, `musicutil`, `lattice`, `pattern`(?), `util`, `tabutil`,
`textentry`, `filters`, `asl`, ... (no `softclock`; beatclock is the norns one).
Also present: `/home/we/norns/crone`, `sox`, `python3`, aubio tools,
`scsynth`/`sclang` in `/usr/local/bin`.

## Architecture

| File | Role |
| --- | --- |
| `drumgen.lua` | entry: `package.path`, `package.loaded` clears, encoder `sens`/`accel`, `init()`, global `redraw()`/`enc()`/`key()` dispatching on `state.view`, 30 fps repaint metro (playhead), BeatClock params |
| `lib/state.lua` | views (`grid`/`menu`/`style`/`out`/`vel`), cursors, menu hub, status, swing/intensity/complexity/variation, playhead, pattern save/load glue |
| `lib/pattern.lua` | pattern data (16 steps × 10 voices, per-cell velocity + flags), ops (clear/fill/lock/humanize/quantize), JSON via the `rnd.lua` serializer approach |
| `lib/gen.lua` | generator: styles, per-bar mutation, accents/ghosts/syncopation, fills, A/B variation |
| `lib/kit.lua` | 10 voice definitions (note, MIDI velocity, engine params, gain/pan, choke groups) |
| `lib/drums.lua` | transport + trigger: BeatClock, swing/humanize offsets, voice stealing, choke groups, fill scheduling |
| `lib/out.lua` | output backend switch: norns engine vs MIDI out (device id + channel), MIDI clock in/out |

Constraint: `pattern`, `gen` and `kit` must stay free of matron globals so they
can be exercised on-device with plain `lua` (the trick used for
`monome/c4synth/lib/inswap.lua`). `state.lua` stays thin; it is the only module
that touches `redraw()`, `params`, `audio`, `midi`.

## Kit (10 voices, no clap)

kick, snare, closed hat, open hat, ride, crash, low tom, mid tom, high tom,
shaker. Choke groups: open hat chokes closed hat, crash chokes hats. Each voice
gets an MGM note number and, for the internal backend, engine params (cutoff,
release, pitch, gain, pan).

## Screens

1. **grid** (main) — 10 voice rows × 16 step columns: 24 px label column, steps
   6 px wide, rows 5 px tall (header y=8, grid y≈12..62, footer y=63). Velocity
   as pixel brightness, ghost hits as dim dots, playhead column bright, cursor
   cell outlined. E2 = step cursor, E3 = voice row, K3 = toggle hit (K3 again on
   an existing hit → velocity popover), K2 = menu.
2. **menu** — hub like c4synth's: Style ▸, Generate (new bar), Fill, Clear,
   Humanize (loose/tight), Intensity ±, Complexity ±, Variation ±, Play/Stop,
   Save pattern, Load pattern, Output ▸, Kit trim ▸, Reset.
3. **style** — style list (E2 scroll, K3 select).
4. **out** — backend (norns audio / MIDI out), MIDI device + channel, MIDI clock
   in/out, clock source.

## Generator design

A style is a table of per-voice rules:

```lua
boom_bap = {
  swing = 0.56,
  fill_every = 8,                    -- bars
  voices = {
    kick  = { base = '1...1...1.....1.', density = 0.5, ghost = 0.15, accent = 0.2, sync = 0.35 },
    snare = { base = '....1.......1...', ... },
    ...
  },
  fills = { { 'tom run' }, { 'snare roll up' }, { 'kick drop + crash' } },
}
```

Per bar: for every voice and step, keep / remove / add a hit within the style's
legal positions, apply accent and ghost velocities, add syncopation weighted by
`complexity`, gate density by `intensity`. Every N bars (`variation`) regenerate
the bar outright; on section boundaries insert a style-appropriate fill whose
length/intensity follows `intensity`. Two banks (A/B) so "variations" can be
recalled, like Drummer's A/B/C/D sections.

## Phases

1. **Phase 0 — capability probe** (gates the internal kit). A throwaway probe
   script on the device printing:
   - `table.concat(audio.engine_names(), ', ')`
   - existence of `audio.play_file`, `audio.load_engine`, `audio.file_info`
   - `midi.devices` ids + names, and which can send
   - one hit on `polyperc` plus any FM/noise engine found, so we can hear it
   If nothing usable exists, internal audio drops out and we go MIDI-out only
   (needs a user decision).
2. **Core** — `pattern.lua`, `kit.lua`, `drums.lua`, `out.lua`: transport, grid
   data, trigger path, MIDI out working.
3. **Generator** — `gen.lua` with the styles above.
4. **UI** — grid matrix, menu hub, style picker, velocity popover, output page.
5. **Persistence** — save/load patterns + kit trims to `drumgen.json` in the
   script dir (device-only; `scp dir/.` deploys do not delete extra files).
6. **Verify** — the pure core is covered on the host by `monome/test/`
   (`luajit monome/test/run.lua`, LuaJIT = Lua 5.1 = the norns dialect): ~500
   bars across all styles asserting legal positions, velocity bounds and fill
   cadence, plus pattern/kit/store units and the harness itself. On-device this
   reduces to `luac -p` on the glue and UI files the host cannot run; deploy flat
   and check `test -f /home/we/dust/code/drumgen/drumgen.lua` and
   `test ! -e /home/we/dust/code/drumgen/drumgen`; then the user judges timing.

## Open decisions (answered next session)

1. **Script name** — `drumgen`? (device dir and menu entry become `DRUMGEN`.)
2. **Steps per bar** — 16 only for v1 (fits the screen; fills are separate
   1-bar patterns), or 32 with a scrolling grid?
3. **Deploy tooling** — `back/c4/norns/deploy.ps1` is hardcoded to
   `monome/c4synth` and has the documented `scp -r $local` re-nesting bug.
   Generalize it with a `-Script` param and push `$local/.` (fixes the bug too),
   or deploy ad-hoc with `connect.js scp`?
4. **Commit prefix** — reuse `[pedal-app]`, or add a new one (e.g.
   `[norns-drums]`) for this project?

## Useful commands

```powershell
# capability probe / read-only device work
$ask = Join-Path $env:TEMP 'ask.cmd'; Set-Content -LiteralPath $ask -Value "@echo sleep" -Encoding Ascii
$env:SSH_ASKPASS=$ask; $env:SSH_ASKPASS_REQUIRE='force'; $env:DISPLAY='localhost:0'
node back/c4/norns/connect.js resolve
scp -r "C:\server\fx\monome\drumgen\." we@norns.local:/home/we/dust/code/drumgen/   # contents, not the dir
ssh we@norns.local "cd /home/we/dust/code/drumgen && for f in *.lua lib/*.lua; do luac -p $f; done"

# plain-lua unit test of the pure modules (no matron globals needed)
lua /tmp/gen_test.lua            # run *on the device*
```

Note the deploy rule from `AGENTS.md`: push contents (`dir/.`), never
`scp -r dir`, or the script re-nests as `code/drumgen/drumgen/drumgen` and shows
up as a spurious `drumgen/drumgen/drumgen` entry in the norns menu.
## Next step: run it on a connected device

Host testing is done and the browser page works; what is left needs the norns in
front of us. The pure core (`lib/pattern.lua`, `lib/kit.lua`, `lib/store.lua`,
`lib/gen.lua`, plus `screen.lua`, `font6x8.lua`, `ui.lua`) passes 181 host tests
under LuaJIT, so the generator is trustworthy. Three things cannot be checked off
the device and are the whole point of the next session:

1. **Timing and feel** — the host only proves bars are legal, not that they feel
   right at tempo. The swing settings and fill cadence get judged by ear.
2. **Font and layout** — `font6x8.lua` is provisional, written to norns metrics
   but never rendered on a real screen. `screen.peek()` and the real panel may
   disagree about widths; `ui.lua` needs an actual look at 128×64.
3. **Device glue** — `drumgen.lua`, `lib/clock.lua` and `lib/out.lua` do not
   exist yet. They are the norns-only shell: `metro` for the clock, `audio` for
   voices, `screen` for the panel, params for the encoders. Everything they call
   into is already tested, so this is wiring, not new logic.

Deploy flat and keep the script visible under `DRUMGEN`:

```
scp -r "monome/drumgen/." we@norns.local:/home/we/dust/code/drumgen/
ssh we@norns.local "test -f /home/we/dust/code/drumgen/drumgen.lua && test ! -e /home/we/dust/code/drumgen/drumgen && cd /home/we/dust/code/drumgen && for f in *.lua lib/*.lua; do luac -p $f; done"
```

Push contents (`dir/.`), never `scp -r dir`, or it re-nests on the second push
and shadows the real entry in the script menu.

Audio is still unverified in the browser too: the page holds the host clock and
drums through WebAudio, and headless Chromium cannot make a sound, so the gap at
each bar loop point found and fixed in the scheduler has only been reasoned
about, not heard. Checking that in a browser is cheap and can be done before the
device session.
