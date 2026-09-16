# PRESET-EXPORT-NOTES.md — H90 Control preset library export automation

Session-scoped knowledge for exporting individual presets from the H90 Control
app's **Preset Library** tab into `.preset90` files.

## App platform (IMPORTANT)

- **Native Win32 / Direct2D app**, JUCE class `JUCE_1a0a37c17eb`.
- Single exe: `C:\Program Files\Eventide\H90 Control.exe` (~11 MB).
- **No Chromium / CEF / Electron / WebView2, no network ports, single process**
  -> **Playwright cannot attach**. Do not attempt.
- Working automation stack: **pywinauto (UIA backend)** + **Windows built-in
  OCR** (`Windows.Media.Ocr`) via PowerShell.
  - OCR engine driver: `C:\Users\Thoma\AppData\Local\Temp\opencode\ocr.ps1`
  - Usage: `powershell -File ocr.ps1 -ImagePath <png>` -> prints lines
    `L<idx>\t<first-word-top-Y>\t<text>`. Y coords are **window-relative**
    (relative to captured client image), NOT screen coords.
- The current model cannot read images directly (image attachments are not
  supported), so all "vision" goes through OCR.

## Window & coordinate system

- Main window screen rect: **L1, T31, R1023, B1039** (~1022x1008 client).
- OCR Y (window-relative) -> screen Y = **window_top (31) + window Y**.
- X is roughly equal (window at x=1): screen X ≈ window X.
- `pywinauto` `mouse.click(coords=...)` expects **screen** coords.
- UIA element rectangles via `el.rectangle()` return **screen** coords.

## Preset Library view layout (client coords, window-relative)

- Search/filter field: left column, `m1` typed in box at ~x184..250, y ~224
  (OCR reads `ml` for `m1`).
- Table area: center, below header. Headers at top:
  `Preset Name` (~x293), `Effect Type` (x~480), `Algorithm` (x~630).
- Table rows begin at ~y301 and are **40px tall** (row Y steps of 40).
  Visible rows: ~y301 .. ~y941 (~16-17 rows).
- First visible row in our filtered view often = `Planetariuml` (y301) —
  that is a *different* preset (ModEchoVerb, NOT an m1 preset). m1 rows start
  at ~y341.
- Sample visible rows (filter `m1`), window Y marks:
  - Planetariuml (301)
  - m1 delay Band_Delay (341)
  - m1 delay Bouquet_Delay (381)
  - m1 delay Digital_Delay (421)
  - m1 delay Ducked_Delay (461)
  - m1 delay Filter_Pong (501)
  - m1 delay Mod_Delay (541)
  - m1 delay MultiTap (581)
  - m1 delay Reverse (621)
  - m1 delay Tape_Echo (661)
  - m1 delay UltraTap (701)
  - m1 delay Vintage_Delay (741)
  - m1 dist Aggravate (781)
  - m1 dist CrushStation (821)
  - m1 dist PitchFuzz (861)
  - m1 dist Sculpt (901)
  - m1 dist WeedWacker (941)
- Right sidebar: Effect Type / Algorithm picker at x ~747..1011.
  Types: Delay, Distortion, Harmonizer*, Modulation, Reverb, Utility, Looper,
  Multi, Synth. Algorithm list for type Delay: Band Delay, Bouquet Delay,
  CrushStation, Diatonic, DualVerb, DynaVerb, Even-Vibe, Flanger, Hall,
  Harpeggiator, Head Space, Instant Flanger, Looper, MicroPitch, ModEchoVerb,
  MultiTap, Octaver, PitchFlex, ...
- Bottom tabs (y~981..): reference bar on right side has
  ParamMatrix/Parameters, Routing/Inserts, Control Assignments — the top-level
  tab `Preset Library` is at (x~841, y~997). The `x` close icon at (980,?).
- `User Presets` (x~220, y~242) / `Favorites` (y~221) are toggle views of the
  same preset list.

## The export flow (verified working)

1. Ensure the preset library view is showing and filter shows the rows.
2. Click the **3-dots** icon on a row's left edge, roughly screen
   `(312, rowY)`. Verified: row `m1 delay Band_Delay` (window y 341) ->
   screen y ~ . For window y 301 row the dots respond around screen y ~ (that
   opened popup title `m1 delay Band_Delay` at screen (372,413)).
3. A **JUCE popup top-level window** opens (title `H90 Control`, ~192 wide).
   Geometry examples:
   - 192x154 at screen `L312, T247` (smaller menu, e.g. on `Planetariuml`)
   - 192x196 at screen `L312, T302` (menu with more items)
   - Menu items (popup coords, window-relative inside popup):
     - `<preset name>` (title row)
     - Copy
     - **Export...** (y ~99..111)
     - Import...
     - (sometimes) Delete from Library
   - The exact Export y varies by popup height. Always OCR the popup window to
     find the item list; Export is near the middle-bottom.
   - Verified click for 192x196 popup: screen `(372, 413)` (= popup L312+60,
     T302 + 111).
4. A **Save Preset** dialog opens (JUCE's own file chooser, rendered INSIDE the
   main window; not an OS HWND — appears as descendants of main window).
   - Filename **Edit**: screen `(137,400)` 630x17 (UIA control), value
     readable/writable via `get_value()`/`set_text()` with pywinauto.
   - File-name **ComboBox** cosmetic at screen `(134,397)` 653x23.
   - Buttons (screen):
     - Save (Сохранить): `(576,465)` 99x26 — **click center `(626,478)`**
     - Cancel (Отмена): `(687,465)` 88x26
   - The file list shows the current directory; the default directory seen is
     `C:\server\fx\input`.
   - **ESC does NOT close this dialog.** Use the Cancel button.
   - Type the filename (no extension needed; `.preset90` is auto-appended —
     the Save dialog is "Save Preset", format .preset90).
5. On Save the file appears immediately in the target directory.

## What was actually exported & verified

- `C:\server\fx\input\m1delay_band.preset90` (3220 bytes) = **m1 delay
  Band_Delay**:
  - base64 JSON blob at offset 1456 (0x5B0), length ~~1200~~ (find end at
    first `"` after start). e.g. start marker `"base64":"`.
  - Decoded JSON:
    ```
    algorithm_name: "Band Delay"
    preset_name:    "Band Delay"
    product_id:     "com.eventide.h9.banddelay"
    version: "3"
    bypa: true, bypa_normal: 0.6334381699562073
    dlya: 13.0, dlya_denormalized_pretaper: 168.5185241699219
    dmix: 50.44, delay params, fbka/fbkb: 46.0, ftyp: 1, killdry: 0
    mdpt 8.2399, mmix 46.88, mspd 0.25, olvl 0, repeat 0, reso 6.78,
    slow_mode false, tmpv 120, tsyn true
    x_switch mmix, y_switch fbka, z_switch fbkb
    expression_pedal 0, in1/out1_sens 1, in2/out2_sens 0
    preset_mix 0.6334381699562073, bypt_normal 0, routing_type 0
    ```
- File structure (3220 B):
  - header ~176 B
  - **10 knob records** `tjknobs-knob1..knob10` @ 176, stride 64 (48-byte
    record bodies; knob index bytes at the very start of the string, e.g. knob1
    rec begins `42 fe ff ff`).
  - alg params: `alg-killdry-obj`, `alg-hotknob-obj`, `alg-tempo-mode-obj`,
    `alg-tails-obj`, `alg-bypass-obj`, `alg-out-gain-obj`, `alg-in-gain-obj`.
  - **base64 JSON blob** at ~1456.
  - tail: 3 GUIDs + preset library name + GUID:
    `7ea818ee-e87f-487e-896a-eacc8178f059`,
    `83138962-1a54-40b4-ad86-704d9cde6c35`,
    name length-prefixed `m1 delay Band_Delay` (len 19), 
    `5fd71017-8a23-3fd5-4606-b7420e11923d`.
- Knob-record comparison vs `midi-map delay.preset90` (2064 B, had CCs
  mapped): knob1/3/6/7/8/9 records IDENTICAL; knob2 & knob5 differ only in
  float bytes [40..42] (m1 has taper float 0.52 / 0.06, midimap has 0.0/0.0 -
  wait, diff shows m1=66 a1 05 (≈), midimap=00 00 00 80); knob4 differs at
  record bytes [0..1] (02 fe vs c2 fd — pointer-ish). **=> No CC-number data
  is stored in the .preset90 knob records.** CC assignment lives elsewhere
  (app-side MIDI page config), so the exporter does NOT capture CCs.

## Prior export samples (from earlier sessions)

- `midi-map delay.preset90` (2064 B) — Band Delay / "GUITARS IN SPACE"
- `midi-map-dist.preset90` (2212 B)
- `midi-map-harm.preset90` (2760 B)
- `midi-map-harm-plus.preset90` (3608 B)

## Library naming / list sources

- `back/h90/library_saved.json` holds 82 entries: 71 m1 (plain algorithm
  names) + 10 m2 (`"<name> m2"`), plus the autogenerated Head Space entry
  (JSON count: 71 m1 unique). The in-app library names for m1 presets are
  `m1 delay Band_Delay` style (search filter `m1` reveals them).
- `back/h90/knob-map.json`, `api_cache.json`, `midi_cc_state.json` exist for
  CC mapping bookkeeping.

## m1 export campaign - COMPLETE (2026-09-15)

- Goal: get every in-app m1 preset (prefix `m1 `) into
  `C:\server\fx\input\lib\` as a `.preset90` file.
- `C:\Users\Thoma\AppData\Local\Temp\opencode\run_m1_export.py` drives it:
  - `ensure_library_view()`: ESC; click Preset Library tab (930,1018); click
    User Presets (371,256); scroll to top x20.
  - `scan_rows()` fine-scans every 5px from y260..1020, clusters rows >=30px
    apart, returns (y, family, name); row 3-dots clicked at (312, row_y+46).
  - popup detect: JUCE window 100<w<250, 80<h<250, left>200; Export... at
    popup.left+60, popup.top+114.
  - Save dialog: filename edit (137,849,786,866) prefilled with the library
    name; Save (Сохранить) button at (645,927) in the auto-navigated folder
    (recent ship: dialog opened directly in C:\server\fx\input\lib).
  - `normalize()` converts only a LEADING `ml ` -> `m1 ` (OCR reads 1 as l);
    FAM regex covers multi|utility; clean_parts maps utility->util,
    mufti/mu/ti->multi; wheel scroll = -1 to avoid skipping rows.
- RESULT: lib\ holds 73 m1 *.preset90 files covering all 71 unique m1 library
  names (0 missing). +2 files are legitimately distinct harm/harmp presets
  that share a base name (Quadravox/Quadravox+; VocalShift/VocalShiftMIDI).
- Notable: last export (Head Space) saved DIRECTLY into lib\ (the Save dialog
  arrived already inside C:\server\fx\input\lib). Filter reset with "Clear
  All" (975,297) restored the full m1 list.
- Head Space itself was authored via the Parameters-tab pipeline
  (load_effect.py + map_delay_effects.py + save_to_library.py), saved as
  `m1 delay Head_Space`, then exported; ~3552 B.
- NOT started: m2 (slot B) export sweep - deferred pending user go-ahead.
- 2026-09-16 (m2 fast slider, UltraTap only): with RangeValue the CC slider is
  a real UIA pattern on the JUCE Slider element (min 0 max 127); assignment
  collapsed from ~15s to ~4.8s/knob (SetValue + close + verify). Slower arrow
  loop and mouse-drag remain as fallbacks. 12 UltraTap knobs -> CC 50..61,
  all verified, saved as library preset 'm2 delay UltraTap'; m2 file written
  to the app's own preset library (NOT input/lib; lib holds only m1 exports).
  m2 export sweep (m2 -> .preset90 into input/lib) still NOT started.

- 2026-09-16 correction: knob discovery rule error fixed. UltraTap algorithm
  'Mix' (knob at y355) was wrongly skipped and the slot General block (In Gain,
  Out Gain, Bypass, Tails, Tempo Mode, HotKnob, Kill Dry) was never collected.
  The bottom program footer is now excluded POSITIONALLY (labels y>=860), not
  by name, and each knob is scrolled fully visible before its CC assignment
  (ensure_knob_visible). UltraTap m2 re-mapped: 20 CCs 50..69 (13 alg + 7
  General), re-saved as 'm2 delay UltraTap'.

- 2026-09-16 identity-verified assignment: the m2 runs now validate that the
  MIDI popup opened for a knob actually names that knob (popup_knob_name),
  because stale rects after JUCE auto-scroll could open the program footer's
  popup. The General block's last knob (Kill Dry) previously set the footer's
  'Mix' to CC 69 while Kill Dry stayed Off. Fixed by stricter
  ensure_knob_visible (knob clear of footer) + wrong-knob popup detection +
  retry. UltraTap m2 re-run: 20 knobs CC 50..69, footer untouched, preset
  re-saved.
