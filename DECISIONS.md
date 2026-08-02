# Decisions — Programmatic H90 control from the web app

Status: **paused (work in progress)**. Protocol is partially reverse-engineered;
the custom encryption is the remaining blocker. See "Resume here" below.

## Goal

Allow changing effects (presets / algorithms) on an Eventide H90 from the Angular app.

## Context / constraints

- The pedal speaks MIDI (WiFi MIDI or BLE). The browser cannot reach it directly,
  so a helper process must own the MIDI connection.
- The Express server (`server/server.js`) has no USB/BT path to the pedal
  and currently exposes only read-only GET endpoints.
- The DB already stores each patch's `algorithm` and `preset_name`.
- There is a working direct-MIDI send path today: `server/h90-send.js` sends a
  Program Change (MIDI CC#0/PC) to the H90 over WiFi MIDI to select a preset slot.
  What is missing is sending the *preset content itself* (import a new program
  from a `.pgm90` / `.preset90` file) without the desktop app.

## Decision 1 — Transport: WiFi MIDI (+ BLE for protocol RE)

- **Control** the H90 over **WiFi MIDI** via a local Node helper (`midi`/`easymidi`)
  that owns the connection; the browser talks to the Express server on :3000.
- **Protocol reverse-engineering** was done over **Bluetooth** by proxying the
  desktop app's BLE connection (see `server/h90_proxy.swift`). The SysEx message
  format is the same over WiFi MIDI and BLE (MIDI SysEx either way).
- USB and browser-native Web MIDI are out of scope for now.

## Decision 2 — Send-preset approach: reverse-engineer the app's import protocol (blocked)

Chosen approach (over "capture-and-replay"): derive the wire format so the web
app can generate/send an arbitrary preset without the desktop app.

Status: **partially solved, blocked on the encryption.** Everything below is
what we know as of 2026-08-02.

---

## H90 import protocol — reverse-engineering notes

### How it was captured

The desktop app `H90 Control` (PID was 32364) talks to the H90 over BLE. A
Swift MITM proxy (`server/h90_proxy.swift`, compiled to `server/h90_proxy`)
reassembled BLE fragments into complete SysEx messages and logged both
directions. A preset import into a pedal slot was captured twice:

- Import #1 — `VECHOLONG` (`.pgm90`) into a slot:
  - `server/h90-captures/h90_import_req.bin`      (768 B, 3x256 BLE chunks)
  - `server/h90-captures/h90_import_resp_big.bin` (4999 B)
  - `server/h90-captures/h90_import_resp.bin`     (110 B ack)
- Import #2 — a second preset into a slot:
  - `server/h90-captures/h90_import2_req.bin`     (512 B, 2x256 BLE chunks)
  - `server/h90-captures/h90_import2_resp.bin`    (5535 B)
- Full session stream: `server/h90-captures/h90_proxy_session.log`
  (import #1 TX at lines ~2193-2195, import #2 TX at ~2281-2282).
- Reassembled full messages: `server/h90-captures/h90_virtual_rx.log`

> Note: imports into the *library* (not a pedal slot) produce no BLE traffic;
> only imports into a pedal slot do.

### Wire format (SOLVED)

SysEx framing, all payload bytes < 0x80 (MIDI-safe):

- `F0 1C 77 00 03 <id> <00> <subid> 78 38 <yy> <payload> F7` — bulk/segmented data (type 03)
- `F0 1C 77 00 01 <id> <00> <subid> ... F7` — control/ack messages (type 01)
- Response message IDs differ from request IDs; ack = `F0 1C 77 01 <id> ...`
- **The payload is 7-bit bit-packed data** (exact 8/7 size ratio; every value in
  0x00-0x7F; only ~128 distinct values, which is why it looked "encrypted" at first).
  Unpacking: MSB-first, take 7 bits per output byte.

So the chain is: `plaintext → encrypt → 8-bit bytes → 7-bit pack → SysEx`.

- The 11-byte request header is constant across imports:
  `F0 1C 77 00 03 5E 00 4F 78 38 16` (payload diverges immediately after).
- `.pgm90` files are NOT sent verbatim: a 3024 B `.pgm90` becomes a ~757 B wire
  payload, i.e. a compact serialization of the preset (trpc flatbuffer model),
  not the file.

### The blocker (UNSOLVED): custom encryption

- After 7-bit unpacking, the data has near-max entropy (~7.9 bits/byte) — it is
  genuinely encrypted, then packed.
- Plaintext is a **flatbuffer** of `trpc::models::ExportedProgram` /
  `ExportedPreset` (confirmed by exported template symbols in the app binary,
  e.g. `flatbuffers::data<Offset<trpc::models::ExportedProgram>>`).
- The cipher is **custom**: no AES / SHA-256 / MD5 / RC4 / ChaCha / X-TEA /
  Blowfish constants anywhere in the binary; no zlib/lzma (decompression tests on
  both raw and unpacked data at many offsets all failed).
- Binary: `/Applications/Eventide/H90 Control.app/Contents/MacOS/H90 Control`
  (arm64 slice: 6.2 MB; **stripped**, 742 symbols, no dSYM). Strings reveal
  `H90Device::sendSegmentedPayload(SegmentedPayloadType, uint, uint, ...)` and
  `{ "encryptionType": 4, ...` (the latter is exported-file JSON, not the wire).
- Only Security.framework is linked (no CommonCrypto / OpenSSL symbol hits).

### Static RE progress

- Disassembly dumped to `/tmp/h90_disas.txt` (arm64, ~1.16M lines).
- Located the import/install thread function around `0x1002f131c`
  (strings: "Import already in progress", "Importing algorithm...",
  "Error sending segment ", source path `.../ImportAlgorithmToCurrentProgramThread.cpp`).
  Segment size constant 2048; integer-to-ASCII progress-string builder inside.
- `otool` section `offset` fields are **decimal** (a gotcha: `5531060` is decimal,
  not hex). __TEXT maps file offset → VA directly (`VA = 0x100000000 + file_off`).
- **lldb cannot attach** to the running app (SIP/entitlement denies `task_for_pid`),
  so no live inspection without restarting the app under the debugger.

### Resume here (next steps)

1. **Extract the cipher/key (most reliable): relaunch the app under lldb.**
   - Quit the running app; launch under `lldb -o "process launch"`, break on
     `-[CBPeripheral writeData:forCharacteristic:type:]` (and the older
     `writeValue:forCharacteristic:type:`), then have the user trigger one import.
   - Dump the plaintext (flatbuffer) + ciphertext from the stack/args; the
     packed buffer is what gets written, the pre-packing buffer is one frame up.
   - With known plaintext+ciphertext, determine if the cipher is a fixed-position
     keystream XOR (then `key = P ^ C` and we can encrypt arbitrary presets), or
     a block/nonce-based cipher (much harder).
2. **Alternative: keep static RE** of the packing/encryption loop in the
   disassembly (hunt for the 7-bit packer, then trace its input buffer).
3. **Fallback: capture-and-replay** — for any preset to be sendable, import it
   once via the desktop app and store the request bytes; the web app replays them.

## Implementation (once the cipher is solved)

- `server/server.js`: add `POST /api/h90/preset` accepting `{ presetFile/presetName, algorithm }`,
  reads the `.pgm90`, builds the flatbuffer, encrypts, 7-bit packs, sends via `midi`.
- Angular detail page: "Send to H90" button → `POST /api/h90/preset`.
- Update `README.md` and this file with the final codec.

## Open questions

- Exact SysEx semantics of `78 38 <yy>` (magic marker vs. version/type byte) and
  the `00 4F` / `00 13` sub-fields in the 03 header.
- Whether the cipher is deterministic per message (fixed keystream) — decides
  feasibility of generating arbitrary presets without the desktop app.
- WiFi MIDI vs BLE: does the desktop app accept the identical SysEx over WiFi MIDI?

## Key files

- `server/h90-captures/*.bin` — captured import requests/responses
- `server/h90_proxy.swift` — BLE MITM proxy (source) and `server/h90_proxy` (built)
- `server/capture-proxy-long.js` / `server/capture-h90-long.js` — BLE capture helpers
- `server/h90-send.js` — working WiFi-MIDI Program Change sender
- `patchstorage/pgm90/*.pgm90`, `patchstorage/preset90/*.preset90` — preset files
  to compare against wire payloads
