# MC3 Backup Analysis

Analysis of the Morningstar MC3 backup file:

```
input/Morningstar_MC3_All_Banks_Backup_20260731_181909.json
```

## Overview

This is a **Morningstar MC3** (3-button MIDI controller) **full backup** (all banks).

| Field | Value |
|---|---|
| `schemaVersion` | 1 |
| `dumpType` | `allBanks` |
| `deviceModel` | 5 |
| `downloadDate` | `2026-07-31T15:19:09.080Z` |
| `hash` | -877752635 (Morningstar internal checksum) |

## File Structure

Top-level keys: `schemaVersion`, `dumpType`, `deviceModel`, `downloadDate`, `hash`, `description`, `data`.

### `data` structure

- **`bankArray`** — 30 banks (numbers 0–29, all present, no dupes/missing). Each bank contains:
  - `bankName`, `bankClearToggle`, `bankMsgArray` (16 per bank → 480 total)
  - `presetArray` (6 per bank → 180 total)
  - `expPresetArray` (1 per bank → 30 total)
- **`controller_settings`** — subsections and item counts:
  - `omniports` — 1
  - `resistor_ladder_aux` — 8
  - `controller_settings` (general configs) — dict
  - `waveform_engines` — 4
  - `sequencer_engines` — 2
  - `scroll_counters` — 16
  - `midi_channels` — 16
  - `bank_arrangement` — 30 (inactive: `isActive: false`, `numBanksActive: 0`)
  - `midi_events` — 16
  - `midi_clock_slots` — 16 (all 500 BPM)

### General configs

```json
{
  "dualLock": false,
  "midiClockPersist": false,
  "lcdAlign": true,
  "midiThru": true,
  "ignoreMidiClock": false,
  "crossMidiThru": true,
  "savePresetToggle": false,
  "midiChannel": 15,
  "switchSensitivity": 2,
  "bankChangeDelayTime": 0,
  "bankChangeDisplayTime": 100,
  "longPressTime": 12,
  "loadLastBankOnStartup": true,
  "numMidiCable": 1,
  "midiSendDelay": 0,
  "midiClockOutputPorts": 4
}
```

## Bank List

| Bank | Name | Presets | Exp |
|---|---|---|---|
| 0 | pedals actions | BASS on, GUIT on, c4 on, + SYNTH, uw on, stereo | EXPRN |
| 1 | nety test | 30NetySolo, c104Nolly, 34 tebe, EMPTY, EMPTY, EMPTY | EXPRN |
| 2 | tebe146 | vs b, v2 s+b, chorus, EMPTY, EMPTY, EMPTY | EXPRN |
| 3 | batman | BASS, POLICE, B+G, EMPTY, EMPTY, EMPTY | EXPRN |
| 4 | naputi | vs1 s, vs2 s, Main, EMPTY, EMPTY, EMPTY | EXPRN |
| 5 | YANAU new | b, Gtr+Bass, chorus, EMPTY 4, EMPTY 5, EMPTY 6 | EXPRN |
| 6 | WILIS | VERSE, bridge, CHORUS, EMPTY, EMPTY, EMPTY | EXPRN |
| 7 | YANAU | b, Gtr+Bass, chorus, EMPTY, EMPTY, EMPTY | EXPRN |
| 8 | pila | Bass, Chorus, Main, EMPTY, EMPTY, EMPTY | EXPRN |
| 9 | init | bass only, guit only, EDM bridge, CH 3 | EXPRN |
| 10 | i | BASS, GUITAR, B+G, + SYNTH, FX, EMPTY | EXPRN |
| 11 | lycantrope | snth v1, CH, MP, CH2, EDM bridge, CH 3 | EXPRN |
| 12 | undead | bridge in, CH, intro, solo in, FAT br/ch, < | EXPRN |
| 13 | carni | VERSE, pre ch 1, intro, bridge, CHORUS 3, g only | EXPRN |
| 14 | fault | Sysex, CH, Eng PC %E0, EMPTY, EMPTY, EMPTY | EXPRN |
| 15 | stranger | main, bass+drive, bass | EXPRN |
| 16 | holes | LEAD %E7, CH, FZ %F8 | EXPRN |
| 17 | kino | LEAD %E7, CH, FZ %F8 | EXPRN |
| 18 | try chord | seq on, cl, raw note, CH2, EDM bridge, CH 3 | EXPRN |
| 19 | victim | bass+drive, in verse 1 | EXPRN |
| 20 | lycantrope | snth, CH, MP, CH2, EDM bridge, CH 3 | EXPRN |
| 21 | C4 SYNTH | FZ %F8, ARP %F9, LEAD %E7, FUZZ %F8, LEAD %F7, _ARP %F9 | EXPRN |
| 22 | loopy session | bass on, guit on, synth on, EMPTY, EMPTY, EMPTY | EXPRN |
| 23 | !test | uw pr 71, ash cc1, uw 1, c4 tap tem, EMPTY, EMPTY | EXPRN |
| 24 | *(empty)* | EMPTY, EMPTY, EMPTY, EMPTY, EMPTY, EMPTY | EXPRN |
| 25 | admiral | s-sf m-m, m-fx, m-fx m-m, EMPTY, EMPTY, EMPTY | EXPRN |
| 26 | c4 arp | clock tap, regen, B-A-D, notes off, steps: 4, steps: 2 | EXPRN |
| 27 | KORG EFFECTS | delay-117, delay-119, delay-121, delay-123, delay-125, delay-127 | EXPRN |
| 28 | C4 effects | Q-tron, spaceship, Wooow, tron-sitar, moog, C#4 pad | EXPRN |
| 29 | try disaster | off g&b | EXPRN |

## MIDI Channel Mapping

`controller_settings.data.midi_channels` — 16 slots (1-indexed MIDI channels).

| Slot | Name | MIDI ch | sendToPort (bitmask) | remap |
|---|---|---|---|---|
| 0 | hub | 1 | 2047 → all ports (0–10) | 0 |
| 1 | C4 | 2 | 2047 → all | 6 |
| 2 | AshLa | 3 | 2047 → all | 0 |
| 3 | UW bass | 4 | 2047 → all | 0 |
| 4 | Korg delete | 5 | 2047 → all | 0 |
| 5 | sxLab | 6 | 4 → port 2 only | 2 |
| 6 | *(empty)* | 7 | 2047 → all | 0 |
| 7 | *(empty)* | 8 | 2047 → all | 0 |
| 8 | *(empty)* | 9 | 2047 → all | 0 |
| 9 | *(empty)* | 10 | 2047 → all | 0 |
| 10 | h90 | 11 | 2047 → all | 0 |
| 11 | Zoia | 12 | 1148 → ports 2,3,4,5,6,10 | 0 |
| 12 | *(empty)* | 13 | 2047 → all | 0 |
| 13 | Polymoon | 14 | 2047 → all | 0 |
| 14 | Admiral | 15 | 2047 → all | 0 |
| 15 | Korg | 16 | 2047 → all | 0 |

Notes:
- `sendToPort` is a port bitmask; default `2047` = every port (0–10). Exceptions: **sxLab** (port 2 only), **Zoia** (ports 2,3,4,5,6,10 — excludes 0,1,7,8,9).
- C4 (`remap: 6`) and sxLab (`remap: 2`) use remap tables; all others `0`.
- No channel-offset, no engage/bypass params enabled; all `dataAttributes` are zeros.
- Empty-name slots (6–9, 12) appear unused but still hold a channel assignment.

## C4 & UW Backups

Companion backups for the two Source Audio pedals controlled by the MC3 (MIDI channels "C4" and "UW bass"):

```
input/c4backup.osbf
input/uwbackup.osbf
```

### Identification

| File | `PRODUCT_ID` | Device | Preset records |
|---|---|---|---|
| `c4backup.osbf` | 249 | Source Audio C4 Synth | 126 (slots 0–127) |
| `uwbackup.osbf` | 251 | Source Audio UltraWave Bass | 66 (slots 0–81) |

### File format

Custom text format (`.osbf`), NOT Morningstar's JSON. `START_DATA` blocks separated by `END`:

- `BACKUP_INFO` — `PRODUCT_ID` (249 = C4 Synth, 251 = UltraWave Bass)
- `USER_EEPROM` — 256-byte global config, hex-encoded (exactly 512 hex chars each)
- `USER_PRESET` — `LOCATION`, `SIZE`, `NAME`, hex payload

Preset payload length is always `SIZE + 32` — the `SIZE` field (C4: 128, UW: 236) excludes a fixed 32-byte trailing name field. Consistent across all records.

### EEPROM content

- **C4**: 116 non-FF bytes, incl. a 112-byte table at offsets 0x80–0xEF (looks like a note/CC mapping table).
- **UW**: 14 non-FF bytes (mostly defaults).

### C4 preset list (loc | name)

| Loc | Name | Loc | Name | Loc | Name |
|---|---|---|---|---|---|
| 0 | 1 | 43 | Reese Bass4ss | 86 | HC Moog 1 |
| 1 | Taurus | 44 | EDM Swell 24s | 87 | Moog Taurus (Winter NAMM 2019) |
| 2 | EDM Swell | 46 | stt-m-Moog Bass NOWSCT 2 | 88 | Synth Bass |
| 3 | Poly Pitch Swell | 47 | stt-bass-HC Moog 1 | 89 | PHAT LEAD |
| 4 | Funk Dragon | 48 | gated fuzz-mid | 90 | Analog Lead-bass supp |
| 5 | volume off | 49 | JW Oct Fuzz with Friends | 91 | PHAT LEAD hi |
| 6 | EDM Swell test seq | 50 | Two Fazed Meat-Fuzz | 92 | C# Pad |
| 7 | BAD Shimmer Cello | 51 | gated fuzz | 93 | try sawSine support |
| 8 | Syncello | 52 | Up Fuzz | 94 | try-beg-JW 5th Saw Sub Pad (G) |
| 9 | NONAME | 53 | JW Velcro Octave Fuzz | 95 | Microsynth |
| 10 | Foolin | 54 | Tower of Fuzz | 96 | tebe-1/2v - Da Funk |
| 11 | go42 | 55 | fuzz - Bad Behaviour -me4tu | 97 | napu-vs2_synth_vs1 |
| 12 | go5 | 56 | Machine Octaves | 98 | organic |
| 13 | go4 | 57 | trem - Fuzz DFilter | 99 | Organic min |
| 14 | go3 | 58 | try fuzz support | 100 | trem - Welcome To Paradise |
| 15 | go2 | 59 | circle2 | 101 | Crystalization |
| 16 | go | 60 | napu-vs2_synth | 102 | Whoow2 |
| 17 | Royal Blood lyc | 61 | wilis - Mono Dirty Filter | 103 | Whoow2tryChord |
| 18 | Pianic | 62 | -----clean-----LEADS-----next--- | 104 | Whoow2chor |
| 19 | Funk Dragon+ | 63 | Tower of Fuzz | 106 | wet dist |
| 20 | Synthian try 2 | 64 | Spectrum - Gated Phaser | 107 | -----clean----ARPS-----next----- |
| 21 | Synthian+ | 65 | EDM Swell 2 | 108 | Rhythmic Bass Octave Arpeggiator |
| 22 | Organic Rock+ | 66 | gta try - dual saw lead - vol ad | 109 | FarMysth -hop |
| 23 | Funk Dragon+CL | 67 | Future Nostalgia | 110 | Carnival - aimed |
| 24 | Funk Dragon+CL2 | 68 | Synthian | 111 | nety try - TOX MinorFlutes |
| 25 | space-frog | 69 | Organic Rock | 112 | Mr Happy -back-harm |
| 26 | Funk Dragon+harm | 70 | nety try - NoAI Synth Bass "Neon | 113 | SEQ - Saga |
| 27 | Moog Taurus winter 1up | 71 | EDM Swell | 114 | arp-Knights |
| 28 | Funk Dragon 1up 3peak | 72 | Technicolour -hop | 115 | arp-Queen+2 |
| 29 | Moog Bass Synth - Jim 1up | 73 | Synth Feedback intel try | 116 | trem - Welcome To Paradise |
| 30 | cello | 74 | Pretty Lady 2-harm | 117 | trem - tw.POLYDRIVE |
| 31 | strings 4 h90 | 75 | JW 5th Saw Sub Pad (G)-harm | 118 | space sequencer 2 enter |
| 32 | str base | 76 | Reese Bass | 119 | space seq enter |
| 33 | JW Saw Sine Lead 01 | 77 | Phat lead light | 120 | 9na-chorus On ACid |
| 34 | Carni - aimed | 78 | Synth Feedback intel | 121 | naputi-intro |
| 35 | carni-tof | 79 | Whoow | 122 | Technicolour LYC |
| 36 | Tower of Fuzz | 80 | PHAT LEAD 2 | 123 | Whoow+metr |
| 37 | clean dist4s | 81 | lycantrope wibe | 124 | ch2+freeze-src |
| 38 | Organic Rock4s | 82 | Blarinet | 125 | ch2+smooth drone |
| 39 | ------synth--BODY---next--- | 83 | Boogie On | 126 | ch2+seq-chord |
| 40 | Microsynth-carni | 84 | 24K MOOG | 127 | clean |
| 41 | Simple Bit Crusher | 85 | Moog Bass Synth - Jim 1 | | |
| 42 | Reese Bass | | | | |

Empty slots: 45, 105. The three "…---next---" presets (39, 62, 107) are category markers: **synth/BODY**, **clean/LEADS**, **clean/ARPS**.

### UW preset list (loc | name)

| Loc | Name | Loc | Name | Loc | Name |
|---|---|---|---|---|---|
| 0 | DUALBAND COMPRESSOR | 25 | Royal Flood-ish | 52 | [BEEP BLIP] |
| 1 | TRUE DUAL COMP | 26 | Clean w/Comp | 53 | [BEEP BLIP]2 |
| 2 | end comp | 27 | Bright Harmonics bb | 54 | Roswell Fuzz |
| 3 | off | 28 | Microtubes X | 55 | Octave Lead |
| 6 | Synth Bloom | 29 | Clean hard compressor | 56 | Two-Band Octave Fuzz |
| 7 | Da Fungk | 30 | Bx1_Bx2_V.4 | 57 | Figure 88my |
| 8 | Swellng Up | 31 | TRUE DUAL COMP | 58 | Filter Fantasmo 2my |
| 9 | Megalon | 32 | DUALBAND COMPRESSOR | 59 | [BEEP BLIP]2wChord |
| 10 | Seven Dust - R.J. Ronquillo | 33 | Furiosa -no-trem | 65 | Classic Overdrive saved |
| 11 | Lets GRV T-night | 34 | my c4 Comp | 66 | Earth Invader saved |
| 12 | Furiosa -trem | 35 | restore comp | 69 | end comp |
| 13 | oblivion | 36 | Modern Drive/Comp | 71 | flea single |
| 14 | Bowman | 37 | DUAL COMP // Factory 5 | 72 | flea dual |
| 15 | Acid Lizard on a Moped | 38 | Clean hard compressor | 76 | King of Dethrone g |
| 16 | Wooly Riffs | 39 | Clear Distortion 2 | 77 | Green Pi g |
| 17 | Tesla Coil Pulse 4 | 40 | Hartke bass attack | 78 | Muffy the Rat Slayer g |
| 18 | Dogman bb | 41 | Clean w/Comp2 | 79 | Doom and Gloom g |
| 19 | Filter Fantasmo 2 | 42 | Bright Harmonics bb | 80 | Excellent fuzz g |
| 20 | 2B Bass Drive | 43 | cleanDaPitch | 81 | Excellent fuzz2 g |
| 21 | Royal Flood | 44 | cleanDaPitch | | |
| 22 | Clear Distortion 2 | 45 | cleanDaPitch3 | | |
| 23 | Eerie Bells | 49 | Clean dual | | |
| 24 | Da Fungk | 50 | OscillatingSynth | | |
| | | 51 | Synthy Bass | | |

Empty slots: 4, 5, 46–48, 60–64, 67, 68, 70, 73–75, 82+. The "… g" suffix names (76–81) are guitar-experiment variants.

### Cross-reference with the MC3 backup

- MC3 bank 23 "!test" → `uw pr 71` = UW loc 71 **"flea single"**, `uw 1` = UW loc 1 **"TRUE DUAL COMP"**
- MC3 channel "C4" (ch2) and "UW bass" (ch4) = these two pedals
- C4 presets Whoow / C# Pad / moog match MC3 bank 28 "C4 effects"; bank 26 "c4 arp" targets the C4's arpeggiator

### Integrity notes

- Both files complete and well-formed: EEPROM hex length exactly 256 bytes, every preset record `SIZE + 32`, header `NAME` matches the 32-byte trailer name.
- Duplicate names in different slots (e.g. UW "Da Fungk" 7 & 24, "DUALBAND COMPRESSOR" 0 & 32) are different param tweaks, not errors.
- **Only quirk**: C4 loc 9 "NONAME" — its trailer field holds raw binary instead of a name (factory/scratch slot, harmless).

## L.A. Lady Backup

```
input/2026-07-31_labackup.osbf
```

### Identification

| File | `PRODUCT_ID` | Device | Preset records |
|---|---|---|---|
| `2026-07-31_labackup.osbf` | 244 | Source Audio L.A. Lady Overdrive (One Series) | 3 USER_PRESET + 3 USER_PRESET_SELECTOR |

Same `.osbf` format as the C4/UW backups: `BACKUP_INFO`, `USER_EEPROM`, `USER_PRESET` / `USER_PRESET_SELECTOR` records, plus a human-readable `Preset Name List` footer.

### EEPROM content

256-byte `USER_EEPROM` with only 20 non-FF bytes (mostly defaults): global settings at offsets 0x00/0x02/0x05/0x10 and a small block around 0x1A.

### Preset records

All records `SIZE=53`, actual payload `53 + 32` (fixed 32-byte trailing name field). Every header `NAME` matches its trailer.

| Type | Loc | Name |
|---|---|---|
| USER_PRESET | 0 | diman based bass |
| USER_PRESET | 1 | oct2+octFuzz |
| USER_PRESET | 2 | Heavy - Darkglassy v5 (low end) |
| USER_PRESET_SELECTOR | 0 | goodtone fixed mids |
| USER_PRESET_SELECTOR | 1 | Heavy - Darkglassy v5 (low end) |
| USER_PRESET_SELECTOR | 2 | Sleepy silver FUZZ |

`USER_PRESET` records are the 3 stored preset slots; `USER_PRESET_SELECTOR` records are the 3 toggle-switch positions currently loaded. Note the preset "Heavy - Darkglassy v5 (low end)" occupies both storage slot 2 and selector slot 1 (identical data).

### MC3 cross-reference (inferred)

Likely the pedal on MC3 MIDI channel slot 2 **"AshLa"** (ch 3), targeted by bank 23 "!test" preset **"ash cc1"** (CC1 message). Not confirmed.

## Validation Notes

All structural checks passed:
- JSON parses cleanly; all 30 banks present, unique, in order.
- Preset `bankNum` ↔ owning bank all match; no cross-reference errors.
- Message slot counts within limits (≤16 per preset/bank message).

Minor observations (not errors):
- Bank 24 has an empty name with 6 empty presets (likely a leftover scratch bank).
- Bank name "lycantrope" duplicated at banks 11 and 20.
- `hash` cannot be independently re-verified (Morningstar's internal checksum; not standard hash).
- `bank_arrangement` is `isActive: false` (default bank-order mode); its listing has bank 24 placed out of order (between 18 and 19).
- Some banks use only 2–4 of 6 preset slots — normal, empties are valid.
- All 16 `midi_clock_slots` are 500 BPM (likely default/unused).
