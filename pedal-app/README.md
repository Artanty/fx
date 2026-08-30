# pedal-app — Source Audio L.A. Lady inspector + preset write/upload

Reverse-engineering tool for the **Source Audio L.A. Lady** overdrive pedal
(USB HID, `VID 0x29a4` / `PID 0x0300`), built as a small CommonJS Node/Express
app plus a web UI. It is a "Neuro-like" replacement: read every preset slot,
EEPROM and MIDI map, export `.pre` / `.osbf` presets, and — once the write path
is solved — push presets into a slot from the web UI.

> Status: **Phase 1 (read/export) works.** **Phase 2 (write/import) is blocked**
> on a working flash-erase command. See `docs/la-lady-write-plan.md` and
> `TODO.md`.

## Quickstart

```sh
npm install          # express + node-hid
npm start            # web UI on http://localhost:3111
npm run live         # CLI live-slot reader
```

The pedal must be connected over USB and appear as `Source Audio One Series`
at `VID 0x29a4` / `PID 0x0300` (interface 2 / usage page `0xffa0`). Run
`node script` — any write/erase path first verifies the device identity via
`requireLalady()` and refuses to talk to anything else.

## Phase 1 — Read (working)

- Lists the 6 on-board preset slot pages, the active slot, firmware/config,
  the 256-byte EEPROM (incl. the MIDI map region), hardware bypass and MIDI
  channel.
- Reads presets live over HID and **offline from a `.osbf` backup**
  (`input/2026-07-31_labackup.osbf`).
- Exports presets to **`.pre`** (Source Audio Neuro XML format) both live
  (`/api/export`) and from the backup (`/api/export-ref`), byte-identical in
  style to the official app.

## Phase 2 — Write/import (working)

`POST /api/write` and `POST /api/activate` now work end-to-end using the
**ACTIVE_** commit protocol discovered from live Neuro captures + the
MichaelMCE/TeensyC4Synth library:

- `ACTIVE_STORE` (0x76) stages the 53-byte preset body into the working preset
  in 32-byte blocks (`[0x76, lastFlag, offset, len, ...data]`).
- `ACTIVE_WRITE` (0x6e) commits the working preset + name to a slot
  (`[0x6e, idx, 1, name(32)]`) — this is the erase+program primitive Neuro uses.
- `ACTIVE_SET` (0x77) selects the active preset (`[0x77, idx, 0]`).

The old `FLASH_WRITE`-based path (blocked on a nonexistent erase) is superseded.
`PRESET_ERASE` (0x38) was verified inert on the L.A. Lady's on-board 0x3c000
region across all tested forms; ACTIVE_WRITE needs no separate erase.

Validated on hardware 2026-08-30: slot 0x3f000 re-write (byte-identical
read-back, no collateral change) and slot 0x3c000 heal from backup
(`scripts/validateActiveWrite.js`, `scripts/healSlot3c000.js`).

## Architecture

```
pedal-app/
├── server.js                Express server + REST endpoints (incl. stubbed write/activate)
├── src/
│   ├── sourceAudioHid.js    USB-HID transport, CMD/RESP table, buildReport,
│   │                        findLalady / requireLalady (device-identity guard)
│   ├── sourceAudio.js       SourceAudioProtocol: flashRead, flashWrite (clear-only),
│   │                        readRegion/writeRegion, erasePreset (inert 0x38),
│   │                        writePreset, setActivePreset
│   ├── laLadyModel.js       slot-page layout, activeSlotPage, MIDI-map decode
│   ├── neuroMap.js          encodeBinary53/decodeBinary53: 53-byte block <-> named params
│   ├── prePreset.js         .pre (Neuro XML) parse/build
│   ├── osbf.js              .osbf backup/restore parse
│   ├── preAnalyze.js        byte-position analysis
│   └── live.js              CLI live-slot reader (npm run live)
├── scripts/                 diagnostics / recovery CLIs (see below)
├── web/index.html           single-page inspector UI
├── runtime-actions/         captured device backups (generated)
└── docs/la-lady-write-plan.md   the resume/handoff plan for the write path
```

`node-hid` provides the transport (`SourceAudioHid.send/receive`); the rest is
plain CommonJS.
`src/prePreset.js` also builds presets for **two more Source Audio One Series
pedals** (L.A. Lady = product id `244`), sharing the same HID framing.

## API endpoints

| Method | Path | Purpose |
| ------ | ---- | ------- |
| GET | `/api/device` | whether the L.A. Lady is present |
| GET | `/api/status` | config + active page/slot |
| GET | `/api/presets` | 6 slots (name, page, hex, decoded rows) |
| GET | `/api/eeprom` | EEPROM hex + MIDI map |
| GET | `/api/osbf` | backup preset/selector index |
| GET | `/api/all` | everything above in one call |
| GET | `/api/export?slot=0x03c000` | live slot → `.pre` download |
| GET | `/api/export-ref?id=UP0` | offline backup slot → `.pre` (`UP0..`, `US0..`) |
| POST | `/api/write` | write preset to a slot (ACTIVE_STORE + ACTIVE_WRITE) |
| POST | `/api/activate` | select a slot as active (ACTIVE_SET 0x77) |

## Safety workflow

Every write/erase operation goes through `requireLalady()`; a wrong device is
refused. Follow this around any probe:

```sh
node scripts/backupFull.js       # full read-only backup -> runtime-actions/lalady-backup-*.json
# ... run your probe ...
node scripts/checkScratch.js     # diff live slots vs last backup; confirm no collateral damage
```

### `scripts/` summary

- `backupFull.js` — read-only full-device backup (6 slots + EEPROM → JSON).
- `checkScratch.js [backup.json]` — diff live slots vs a backup (integrity).
- `decodeCapture.js` — decode captured host→device HID reports (plain hex or
  `tshark -T fields` output) into command names/fields.
- `probeEraseArgs.js` / `probeEraseMap.js` — historical `0x38` argument probes
  (result: all inert — reference only, do not blindly re-run).
- `probeWriteBehavior.js` — **unsafe** `0xFF` write test that corrupted
  slot `0x03c000`; **do not run**.
- `validateMap.js` — regression check of `neuroMap` encode/decode round-trip.

## Known corruption (recoverable)

Slot `0x03c000` ("goodtone fixed m") was corrupted by an early unsafe `0xFF`
write (58 bytes differ from backup). The other 5 slots and the EEPROM are
intact. It is recoverable via the **Neuro app**, or from the backup JSON once
Phase 2 erase works.

## Notes

- Keep the commit-message prefix convention (`[pedal-app]`) documented in the
  repo `AGENTS.md`.
- This project is the pedal-app subproject of the `fx` monorepo; it is
  independent from the H90 protocol work tracked in `DECISIONS.md` / `H90-IMPORT-NOTES.md`.
