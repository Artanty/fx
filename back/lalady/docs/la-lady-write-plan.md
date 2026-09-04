# L.A. Lady — Phase 2 write/upload plan & capture handoff

> Scope: reverse-engineering how to **write/upload presets** to the Source Audio
> L.A. Lady pedal (HID, USB `VID 0x29a4` / `PID 0x0300`), continuing the
> read-only inspector in `pedal-app/`. This doc is the resume point for a fresh
> session (next one runs on **Windows** in a VM with USB passthrough).

## Goal
Implement `POST /api/write` (erase slot → write preset body → verify) and
`POST /api/activate` so the web UI can push presets to a slot. Phase 1 (read)
already works.

## What is CONFIRMED (empirically, over a real USB link)
- **Reads work.** `FLASH_READ` (0x36) with the address in report bytes 1–3
  returns the preset data at `0x03c000 + slot*0x1000`. `readSlotRaw`,
  `getEEPROM`, `getHardwareConfig` all function.
- **Slot layout** (`src/laLadyModel.js`): 6 slot pages
  `[0x03c000, 0x03d000, 0x03e000, 0x03f000, 0x040000, 0x041000]`.
  Header = bytes `0x00..0x1f`; data block = `0x20..0x54` (53 B);
  name = `0x55..0x74` (32 B). `activeSlotPage(idx)=0x03c000+(3+idx)*0x1000`.
- **`FLASH_WRITE` (0x35) is clear-only** — it clears bits (1→0) and does
  **not** auto-erase. A write onto existing data therefore only lands correctly
  if the target was first erased to `0xFF`. (Verified: a `0xFF` write changed
  bits, it did not leave the cell unchanged and did not turn it all-`0xFF`.)
- **`PRESET_ERASE` (0x38) is INERT for preset slots.** Tested 83 argument
  forms (idx 0–7, idx+1, `0,idx`, `idx,0`, `AA,idx`, `idx,AA`, `01,idx`,
  3-byte address BE, `0,addr`, `addr,AA`, 2-byte sector, no-arg, `0xff`,
  `0x00`) over a confirmed USB link. Every variant ACKed with `0x37`
  (`ERASE_ACK`) but **none** cleared any of the 6 slots (checked for all-`0xFF`
  or all-`0x00`). So `0x38` is not the preset-erase mechanism.
- **Device-identity guard added** in `src/sourceAudioHid.js`:
  `findLalady()` no longer falls back to `list[0]`; `requireLalady()` throws
  unless the device matches `VID 0x29a4` (+ `PID 0x0300` or
  `usagePage 0xffa0`/`interface 2`). All write/erase scripts must use it.

## Current status — RESOLVED 2026-08-30

The save path was reverse-engineered from live **Neuro captures** plus the
MichaelMCE/TeensyC4Synth library (`sa_c4.c`/`sa_c4.h`), and validated on
hardware. The write primitive is the **ACTIVE_** family, not a raw erase:

- **ACTIVE_STORE (0x76)** stages the working preset body in 32-byte blocks:
  `[0x76, lastFlag, offset, payloadLen, ...data]`. L.A. Lady body is 53 bytes →
  block0 `[0x76, 0, 0x00, 0x20, <32B>]`, block1 `[0x76, 1, 0x20, 0x15, <21B>]`.
- **ACTIVE_WRITE (0x6e)** commits the working preset + name to a slot:
  `[0x6e, presetIdx, 1, name(32), 0, 0, 0]`. This is the **erase+program**
  primitive Neuro uses; no separate erase is required.
- **ACTIVE_SET (0x77)** selects the active preset: `[0x77, presetIdx, 0]`.
- `presetIdx = (page - 0x03c000)/0x1000` (slots 0..5; ACTIVE_WRITE verified).

> **CORRIGENDUM (2026-09-01, live HID probe):** the ACTIVE_SET/ACTIVE_WRITE
> argument IS the physical slot index `0..5` (`0x03c000 + idx*0x1000`). The old
> note "idx 3 → 0x3f000" was a misread seeded by the config report: its byte 4
> ("activePreset") reports `0` for physical 0–2 and `1` for physical 3–5, so the
> `activeSlotPage()` `+3` formula only agreed with reality at physical slot 3.
> To know the *exact* active slot, match the LIVE control table against the six
> stored slot bodies (`server.js` `resolveActiveSlot`) — do **not** derive it
> from the config byte.
- A 500 ms settle is required after each ACTIVE_* command.

Implemented in `src/sourceAudio.js`. `erasePreset(idx)` stays as
`[0x38, idx|0x80, 0, 0]` for C4-style targets but is **inert on the L.A. Lady**
(verified — ACTIVE_WRITE supersedes it).

## Heal + validation (done)

- `scripts/validateActiveWrite.js`: re-wrote slot 0x3f000 → read-back
  byte-identical (85 B), no collateral change. PASS.
- `scripts/healSlot3c000.js`: restored the corrupted slot 0x03c000
  ("goodtone fixed mids") byte-for-byte from the first backup, header rebuilt
  identically (`ee373500b61201..`), no collateral change.
- Fresh full backup after heal: `runtime-actions/lalady-backup-1788109370489.json`.

## Backups (read-only, safe)
- Full device backup: `runtime-actions/lalady-backup-1787936146287.json`
  (all 6 slot pages + 256 B EEPROM, hex). Regenerate any time with
  `node scripts/backupFull.js` (uses `requireLalady`).
- `checkScratch.js` diffs live slots against the latest backup — run it after
  any probe to detect corruption.

## Scripts available (`pedal-app/scripts/`)
- `backupFull.js` — full read-only backup → `runtime-actions/lalady-backup-*.json`.
- `checkScratch.js [backup.json]` — diff live slots vs backup (integrity check).
- `probeEraseArgs.js` — probes `0x38` arg forms; restores from backup if it
  ever erases. Already run → all inert. Keep as a reference, do not re-run
  blindly.
- `probeWriteBehavior.js` — the unsafe `0xFF` test that corrupted slot 0; do
  **not** run again.

## Capture plan (to be done on WINDOWS VM)
Neuro desktop is Windows/macOS only, so the capture runs in a **Windows VM**
with the pedal's USB passed through, captured by **USBPcap + Wireshark**.

1. Windows VM, pass the L.A. Lady USB (VID `0x29a4` / PID `0x0300`) through.
2. Install Source Audio **Neuro**, **USBPcap**, **Wireshark** in the VM.
3. Launch **USBPcapCMD**, select **only** the L.A. Lady device.
4. Start capture; in Neuro, do **one** save of a preset to a **known slot**
   (note the slot index + preset name). Stop capture → `capture.pcapng`.
5. Extract host→device reports:
   ```
   tshark -r capture.pcapng -T fields -e usb.endpoint_address.direction -e usb.setup.bRequestType -e usb.setup.bRequest -e usb.capdata
   ```
   Paste the output (direction `0` = host→device, or
   `bRequestType 0x21`/`bRequest 0x09` = SET_REPORT are the commands). If the
   chat can't take the paste, share `capture.pcapng` directly.

## What was done with the capture
1. Parsed the OUT / SET_REPORT payloads on the save → identified ACTIVE_STORE +
   ACTIVE_WRITE as the commit sequence (`scripts/decode_usbpcap.py`; direction
   = `p[m-2]`, marker `26 00 00 00`).
2. Implemented the discovered commit in `writePreset` and `setActivePreset`
   (`src/sourceAudio.js`), preserving the slot header (`0x00..0x1f`).
3. Healed slot `0x03c000` from the backup using the new write (`healSlot3c000.js`).
4. Validated `POST /api/write` and `POST /api/activate` end-to-end on slot
   `0x03f000` (`validateActiveWrite.js`), using `checkScratch.js` to confirm no
   collateral corruption.

## Key files
- `src/sourceAudioHid.js` — `CMD`/`RESP` table, `buildReport`, `findLalady`,
  `requireLalady`, `SourceAudioHid` (USB HID open/send/receive).
- `src/sourceAudio.js` — `SourceAudioProtocol`: `flashRead`, `flashWrite`
  (clear-only), `readRegion`/`writeRegion`, `erasePreset` (currently 0x38,
  inert), `buildSlotBody`, `writePreset`, `setActivePreset`.
- `src/laLadyModel.js` — slot layout constants, `SLOT_PAGES`, `activeSlotPage`.
- `src/neuroMap.js` — `encodeBinary53`/`decodeBinary53` (53-byte block ↔
  named params) for verifying decoded preset bytes.
- `src/osbf.js` — `.osbf` parser (backup/restore format reference).
- `server.js` — express server; `/api/write` (body `{slot?, idx?, preText? |
  params?}`) and `/api/activate` already stubbed.
- `web/index.html` — per-slot Write/Activate UI.

## Open risks (residual)
- The ACTIVE_* commit is validated on the L.A. Lady's 6 on-board slots
  (0x3c000..0x41000). Its behavior on the 0x080000 C4 preset bank is untested
  but not relevant here.
- `POST /api/write`/`/api/activate` HTTP endpoints are implemented and
  unit-verified via the scripts, but a final device round-trip through the web
  UI has not been run by the user (they run `server.js` themselves).
