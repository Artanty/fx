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

## Current blocker
We do not have a working **erase** command. `0x38` doesn't erase, and
`FLASH_WRITE` can't set bits. Without an erase we cannot write or restore
anything. The real save sequence is almost certainly a higher-level command
(`ACTIVE_STORE` 0x76 / `ACTIVE_WRITE` 0x6e / `CONFIG_SET` 0x6f / `CTRL_SET`
0x70) that the firmware uses to erase+program internally. Blindly probing those
is risky (can't restore without an erase), so we are **capturing the Neuro
app's real HID traffic during a save** instead.

## Corruption to be aware of (recoverable)
- Slot `0x03c000` ("goodtone fixed m") was corrupted by an early unsafe
  `0xFF`-write test — 58 bytes differ from backup. **The other 5 slots and the
  EEPROM are intact** (verified with `scripts/checkScratch.js`).
- User confirmed "goodtone fixed m" is **recoverable via the Neuro app**, so it
  is not a blocker. Once we have the real erase/write, we can also heal it from
  the backup JSON.

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

## What I will do with the capture
1. Parse the OUT / SET_REPORT payloads; identify the save command(s) and their
   argument structure (likely `ACTIVE_SET` 0x77 to select, then an
   `ACTIVE_WRITE` 0x6e / `FLASH_WRITE` 0x35 stream, then `ACTIVE_STORE` 0x76 to
   commit — which should internally erase+program).
2. Implement the discovered erase/commit in `erasePreset` and the write in
   `writePreset` (`src/sourceAudio.js`), preserving the slot header
   (`0x00..0x1f`) like the current code attempts.
3. Heal slot `0x03c000` from the backup using the new erase.
4. Validate `POST /api/write` and `POST /api/activate` end-to-end on a user
   slot (e.g. `0x03f000`), using `checkScratch.js` to confirm no collateral
   corruption.

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

## Open risks
- If the capture shows the save uses a command we can't safely replay (e.g. a
  locked/unlock preamble), we may still need a second capture or careful
  probing.
- After finding the real erase, re-validate `flashWrite` address framing
  (the `0xFF` test's odd `14c4…` result suggests the data offset or row size
  in `flashWrite` may need revisiting — reads work, so address encoding is
  fine, but the written payload offset should be re-confirmed once we can erase
  and rewrite a slot cleanly).
