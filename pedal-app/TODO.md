# pedal-app TODO — L.A. Lady preset import (Phase 2)

Status of the write/upload path. Phase 1 (read/export) is done. Phase 2 (write)
is now UNBLOCKED — ACTIVE_STORE + ACTIVE_WRITE commit verified on hardware.

Hardware: Source Audio L.A. Lady (`VID 0x29a4` / `PID 0x0300`) over USB HID.

## The (former) blocker — RESOLVED 2026-08-30

`FLASH_WRITE` (0x35) is clear-only and `PRESET_ERASE` (0x38) is inert on the
L.A. Lady. The real save primitive (from MichaelMCE/TeensyC4Synth + live Neuro
captures) is the ACTIVE_* family:

- **ACTIVE_STORE (0x76)** stages the working preset body: `[0x76, lastFlag,
  offset, payloadLen, ...data]`, 32-byte blocks. L.A. Lady body = 53 bytes →
  2 blocks (offset 0 / 32, lengths 0x20 / 0x15).
- **ACTIVE_WRITE (0x6e)** commits the working preset + name to a slot:
  `[0x6e, presetIdx, 1, name(32), 0,0,0]`. This is the erase+program primitive.
  `presetIdx = (page - 0x3c000)/0x1000` (slots 0..5, confirmed: idx 3 → 0x3f000).
- **ACTIVE_SET (0x77)**: `[0x77, presetIdx, 0]`, selects the active preset.

## Tasks

### 1. Capture Neuro save traffic — DONE
- [x] Source Audio Neuro desktop captured on USBPcap1 (`--devices 1`).
- [x] Decoded: Neuro save = 2x ACTIVE_STORE (53-byte body in 2 blocks) + 1x
      ACTIVE_WRITE (name + commit). See `DECISIONS.md` progress entries.
- [x] Artifacts: `runtime-actions/neuro-save-*.pcap`, decode via
      `scripts/decode_usbpcap.py` (direction = `p[m-2]`, marker `26 00 00 00`).

### 2. Implement the discovered protocol — DONE
- [x] `writePreset` in `src/sourceAudio.js` rewritten to ACTIVE_STORE×2 +
      ACTIVE_WRITE (replaces the broken FLASH_WRITE path).
- [x] `erasePreset(idx)` rewritten to `[0x38, idx|0x80, 0, 0]` (library-exact).
      NOTE: verified inert on the L.A. Lady's 0x3c000 region — ACTIVE_WRITE
      is the supported clear+write; erasePreset kept for C4-style targets.
- [x] `setActivePreset(idx)` uses `[0x77, idx, 0]` with 500 ms settle.
- [x] Delays: 500 ms after each ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET (required).

### 3. Re-validate `flashWrite` payload framing — SUPERSEDED
- [x] No longer needed: writes go through ACTIVE_STORE/ACTIVE_WRITE. `flashWrite`
      (0x35) remains only for the read-back infrastructure (FLASH_WRITE rows).

### 4. Verify `writePreset` end-to-end on a slot — DONE
- [x] `scripts/validateActiveWrite.js`: re-wrote slot 0x3f000 (name→"zval992200"),
      read-back byte-identical (85B), no collateral corruption. PASS.
- [x] `scripts/healSlot3c000.js` proves the destructive-write + recovery path.

### 5. Verify the HTTP + web-UI path — implemented, untested on device
- [x] `POST /api/write` passes the raw slot index `(page-0x3c000)/0x1000`.
- [ ] Run a live HTTP test: `POST /api/write` + `POST /api/activate` against the
      running server (user runs `server.js` themselves; verify via web UI).

### 6. Heal corrupted slot `0x03c000` — DONE
- [x] Restored "goodtone fixed mids" byte-for-byte from the first backup
      (`lalady-backup-1787936146287.json`), header rebuilt identically
      (`ee373500b61201..`). No collateral change.

### 7. Document the solved protocol
- [ ] Record the real save sequence in `docs/la-lady-write-plan.md`
      (replace the "Current blocker" section).
- [ ] Update `README.md` `/api/write` line ("blocked on erase" is obsolete).

## Recurring safety steps

- [x] `node scripts/backupFull.js` before probes; `checkScratch.js` after.
- [ ] **Never** run `scripts/probeWriteBehavior.js` (the unsafe `0xFF` test).