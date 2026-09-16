# Assigning MIDI CC to controls via the External Mapping popup

How to bind any loaded program control to a MIDI CC number through the H90
Control app, fully UI-driven (no SysEx). Verified 2026-09-14/15 on the Band
Delay preset (Preset A slot 08, unsaved INIT Program, app auto-updated,
window ~1010x1129px, PID auto-detected).

Scope completed in two steps:
- **Step 1**: 10 Band Delay effect knobs -> CC 0..9
- **Step 2**: Slot-A General block (7 knobs) -> CC 10..16

## Result (16 assignable controls; Kill Dry is cc 16, HotKnob is cc 15)

| type    | effect     | control name | cc | values           |
|---------|------------|--------------|----|------------------|
| numeric | Band Delay | Wet Mix      | 0  | 0..100           |
| enum    | Band Delay | Delay Mix    | 1  | A10+B10 (enum)   |
| enum    | Band Delay | Delay A      | 2  | 1/4 (enum)       |
| enum    | Band Delay | Delay B      | 3  | 1/4 (enum)       |
| numeric | Band Delay | Feedback A   | 4  | 0..110           |
| numeric | Band Delay | Feedback B   | 5  | 0..110           |
| numeric | Band Delay | Mod Depth    | 6  | 0..10            |
| numeric | Band Delay | Mod Speed    | 7  | 0..5.01 Hz       |
| numeric | Band Delay | Resonance    | 8  | 0..10            |
| enum    | Band Delay | Filter Type  | 9  | Band Pass (enum) |
| numeric | General    | In Gain      | 10 | -60..+12 dB      |
| numeric | General    | Out Gain     | 11 | -60..+12 dB      |
| enum    | General    | Bypass       | 12 | toggle (on/off)  |
| enum    | General    | Tails        | 13 | toggle (on/off)  |
| enum    | General    | Tempo Mode   | 14 | Free/Sync        |
| numeric | General    | HotKnob      | 15 | 0..100           |
| enum    | General    | Kill Dry     | 16 | toggle (on/off)  |

Enum option names came from the manual (p132-133: Delay Mix, Delay A/B, Filter
Type are select lists); numeric ranges from knob-map.json.

## H90 editor anatomy (critical to avoid wrong assignments)

The main edit area is two side-by-side `Algorithm Parameters` panels plus a
bottom strip:

```
<--- LEFT panel -------------><--- RIGHT panel ------------->
Preset A (Slot A)             Preset B (Slot B)
  effect block                  (Thru / empty here)
    Wet Mix  Delay Mix  Delay A     In Gain  Out Gain  Bypass
    Delay B  ...         ...
    ...     Filter Type
  General block (same panel,     (do NOT touch for slot-A work)
    reached by scrolling down)
    In Gain Out Gain Bypass
    Tails  Tempo Mode HotKnob
    Kill Dry
<--- BOTTOM full-width block --------------------------------->
Mix, In Gain, Out Gain, HotKnob, Kill Dry, Tails + PARAMETER EDIT MODE
```

- **LEFT panel = Slot A, RIGHT panel = Slot B.** For slot-A work, interact only
  with the left panel; the right panel is a different slot.
- **The Slot-A General block lives INSIDE the left panel**, below the effect
  knobs. The panel is **scrollable** - scroll it down to reveal the General rows
  (mouse wheel inside the panel; the rows sit at y501/627/771 at the scrolled
  position). This is the "General" block to assign CC to.
- **The bottom full-width block** (below both panels, straddles Slot A + Slot B)
  is program-global and must NOT be confused with slot-A General. We assigned it
  CC 10..15 by mistake once and reverted it to Off.

## How the mapping popup works (UIA observations)

- Opening it: click the control's value Edit, or the label below it - one of the
  two reveals a `rangeButton` (a small square). Clicking that rangeButton opens
  the **External Mapping** dialog.
- The dialog is a **second top-level "H90 Control" window** (~460x300). While it
  is open the main window's UIA tree collapses to ~6 chrome elements.
- Inside: `Control Source` combo row = three buttons `<` / current value / `>`.
  The value cycles `Off, Preset HotKnob, Program HotKnob, MIDI CC, Exp Pedal,
  Aux Switch`. The arrows do **NOT wrap**: `>` from Aux Switch and `<` from Off
  are dead ends. Reach MIDI CC from Off with 3 clicks of `>`.
- Selecting MIDI CC reveals the instance row on the same line: `<` / `CC# N` / `>`.
  Default is `CC# 0`; step with the arrows.
- Clicking the source value text itself opens the JUCE dropdown (UIA tree
  collapses entirely) - avoid it, use the arrows only. `Esc` closes the dropdown.
- `closeButton` (top-right of the dialog) closes it.
- The dialog closes if the app loses focus (e.g. when a Python script run ends),
  so each open->set->close->verify cycle must run inside a single script run.

## Per-control interaction rules (which click reveals the rangeButton)

- Numeric edits (Wet Mix, ..., Filter Type, In Gain, Out Gain): **label click**.
- Toggle rows (Bypass, Tails, Tempo Mode) and the lower General rows (HotKnob,
  Kill Dry): **value-area click**; label-click does nothing there. HotKnob and
  Kill Dry only become visible after scrolling the left panel down.

## Repeatable procedure per knob

1. Ensure the correct panel is scrolled so the knob's value Edit is visible
   (effect knobs at scroll-top; General rows after scrolling the LEFT panel
   down one notch). Prefer writing the script to capture live rects - they go
   stale after an app restart because the window size/scale changes.
2. Click the label center; if no `rangeButton` appears, click the value-edit
   center instead. Wait ~1s.
3. Click that `rangeButton`; wait ~1s; the External Mapping dialog appears.
4. Read the visible source value. If `Off..Program HotKnob`: click `>` until
   `MIDI CC`. If `Exp Pedal/Aux Switch`: click `<` until `MIDI CC`.
5. Read the instance `CC# N`; click `>`/`<` of the instance row until `N == target`.
6. Click `closeButton`. Verify by reopening the dialog and re-reading both rows.

## Script

`back/h90/assign_cc.py` automates all 17 controls (CC 0..16) and self-verifies
each by reopening the dialog. It skips controls already verified in
`midi_cc_state.json` (persists assignments so re-runs only touch what changed).
Prereqs: `pip install pywinauto psutil`, the H90 Control app running with the
target program loaded, and the main window not minimized.

`midi_cc_state.json` is the source of truth for what is assigned+verified.

Hard requirements baked into the script (why it failed before):
- PID is auto-detected by process name `H90 Control.exe` (was hardcoded).
- The dialog is detected by `width() < 800` (the main window is now ~1010px so a
  `width() < 1200` heuristic is broken).
- Clicks are sent to live element-rect centers via `pywinauto.mouse.click`,
  never `click_input()` (unreliable on JUCE popup buttons) and never hardcoded
  coordinates (scale changes after restart).
- Knob rects (`KNOBS` in main) are for the current layout; re-capture them from a
  fresh UI dump (see `uia_driver.py`) if the window size/scale changes.

## Tests

`back/h90/test_assign_cc.py` (unittest, run `python -m unittest test_assign_cc -v`):

- `test_state_entries_are_sequential` - the state file contains exactly the 17
  controls, CC numbers are exactly `0..16` in order, control order/effect
  grouping matches (Band Delay x10 then General x7), all entries verified.
- `test_live_app_ccs_match_state` - re-opens every knob's External Mapping popup
  in the live app (scrolls the left panel between the 10 effect knobs and the 7
  General rows) and asserts `Control Source = MIDI CC` and `CC# N` matches the
  state file. Skips if the app is not running.

Run the live test right after assigning; it is the actual in-app confirmation.

## Persistence caveat

The mapping lives only in the loaded (unsaved) program; a program reload, preset
change or app restart reverts `Control Source` to `Off`. No SysEx/param-write
protocol is known (not in either printed manual), so persisting requires saving
the user program inside the app.

## Save to Library (persists the mappings)

Discovered 2026-09-15 (learning run only; the save itself was NOT executed):

1. Click the **three-dots menu** next to the active effect: Slot-A header
   `menuButton` at (297,194,321,218), center (309,206). This opens a `~260x285`
   popup window with menu items (heights ~31px): `Band Delay Documentation`,
   `Copy`, then `Export...`, `Import...`, `Import H9 '.tide' Preset...`,
   `Import H9 '.h9z' Preset...`, then `Save to Library` at (309,456,569,487).
   The empty 42px gap between `Copy` and `Export...` suggests one more
   separator/entry slot.
2. Click **Save to Library** (center 439,471). This opens a **modal "Enter a
   Preset Name" dialog** inside the main window (no separate window): title text
   at (280,500,744,572), empty name `Edit` at (288,572,736,600).
3. Type the desired preset name into the `Edit`, then click **OK** at
   (404,624,504,652). `Cancel` (520,624,620,652) aborts without saving.

No save is performed until OK is confirmed; the mapping dialog and name prompt
close on focus loss, so the whole open-menu -> Save to Library -> type name ->
OK cycle must run inside a single script run.

### Library naming rule

Library names follow this scheme so midi-mapped presets are recognizable:

```
<slot> ' ' <type-slug> ' ' <effect-name>
```

- **slot**: `m1` | `m2` (`m` = `midi`); Slot A -> `m1`, Slot B -> `m2`.
- **type slug**: one of `delay`, `dist`, `harm`, `mod` (max 5 letters).
- **effect name**: display name with every space replaced by `_`
  (e.g. `Band Delay` -> `Band_Delay`).
- Max length 24, capped at 23; if the assembled name overflows, slice the
  effect-name tail until it fits.

Example (current Band Delay in Slot A): `m1 delay Band_Delay` (19 chars).

### Save script

`back/h90/save_to_library.py` runs the three-dots -> Save to Library -> type
name -> OK cycle in one pass (see the flow above).