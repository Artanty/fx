# Decisions — Programmatic H90 control from the web app

## Workflow (session convention)

- **Session start:** read this file (and `H90-IMPORT-NOTES.md` for H90 work)
  first and keep it in mind for the whole session.
- **Before every task:** append a `## Plan — <date> <task>` entry at the bottom
  of this file (goal + how it will be verified). Then do the work.
- **After every task:** append a `## Progress — <date> <task>` entry (what was
  done, artifacts, results, next steps). Update `H90-IMPORT-NOTES.md` too where
  it tracks H90 protocol work.

Status: **in progress**. The read/download path is fully decoded (plain zlib
FlatBuffers) and the import **write** path is now decoded too — it is zlib
**DEFLATE with a preset dictionary**, NOT encryption. The custom inflate decoder
(`server/h90_dict_recover.py`) is built and validated byte-for-byte against
zlib. The only remaining unknown is the exact dictionary (built at runtime from
pedal data). See "Resume here".

## Current state — 2026-08-13 session end (resume point)

**Where we are:** the write request = DEFLATE stream whose output is the pedal's
**current program** (VECHOLONG) serialization **patched with the imported
preset's values** (TWO-WAY for req1, MURKY for req2). req1's output decodes to a
ValueTree wrapper + base64 JSON; **every literal b64 run decodes to the
`.preset90` file's JSON byte-for-byte** (e.g. `987.4534912109375,
"dlya_denormalized_pretaper":350.0,...`), confirming the imported values equal
the file's values. The ONLY unknowns left are the **72 dict-copied bytes** in
req1's output (21 in req2, all sourced from req1's 72), which are VECHOLONG's
values — never transmitted, 2 adler32 equations for 72 unknowns → not solvable
offline from existing captures.

**What was confirmed this session:**
- Write-variant structure: `out[211:976]` = 637 b64 chars + **128 non-b64 bytes**
  (117 `\x00`, 4×`0x3f`, 2×`0x0d`, 2×`0x80`, `0x2d`, `0x14`, `0x10`). 72 = deflate
  dict-copies (VECHOLONG); 56 = literal marker bytes. The b64 runs decode to the
  file JSON at per-run phases (stream is NOT phase-continuous; pedal reassembles
  chunks — marker semantics unknown).
- 72 dict-copies → **69 distinct window offsets 31004–32730**
  (`req1_dict_constraints.json`).
- req2's dict = req1's output (window offsets 31916–32764 ↔ `req1_out[124:973]`);
  148/169 req2 refs resolve from known req1 bytes.
- Full output layout documented in `H90-IMPORT-NOTES.md` (08-13 section):
  `[0:32]` TRPC wrapper, `[32:192]` ValueTree structure, `tjknobs-knob4\x00\x00\x00xdl`
  at 192-210, b64 stream 211-871, second `tjknobs-knob4` block at 872-890, more
  b64, `"}\n` at ~946, trailer at 951-976.

**Decision pending (user paused; will continue later):** how to obtain the 72
VECHOLONG bytes. Options: (1) Mac lldb dict recapture — dump the 32768-byte
deflate window at send time (`server/h90-captures/h90_dict_capture.py`, primary);
(2) static RE of the app binary for the `zdict` construction (angr/capstone);
(3) build a literal-only write from the file JSON and test on the pedal whether
it accepts a marker-free stream. Artifacts:
`server/h90-recon/decode_status.json`, `H90-IMPORT-NOTES.md` 08-13 section.

## 2026-08-05 (late) update — write path DECODED: DEFLATE + preset dictionary

**The import write payload is NOT encrypted.** It is standard zlib DEFLATE (real
`78 9c` header, FDICT bit unset) whose early symbols are length-distance matches
into a **preset dictionary** standard zlib doesn't provide. Details in
`H90-IMPORT-NOTES.md` (top section). Summary:

- `h90_import2_req.bin` unpacks to `78 9c` + 438 B; standard `zlib.decompressobj(15)`
  errors `invalid distance too far back`, but `zlib.decompressobj(-15, zdict=32K zeros)`
  decodes it to a **793 B** message (`/tmp/write2_out.bin`). Verified the same
  raw-deflate path decodes the known-good read payload byte-identically.
- The 793 B = a 32-byte wrapper + an embedded preset serialization that is
  byte-identical to `MURKY-BUCKUET-LEAD-642f25f984e72.preset90` for the first
  196 bytes (same `Tap2DelayDivision-obj`, same two UUIDs, same preset name).
- Dictionary footprint: 19 matches reference it; 169 output bytes depend on it;
  144 distinct dict window offsets span the last 848 B of the 32K window
  (31916–32764); the referenced bytes look like a preset serialization (vtable
  offsets, u32 lengths, `LFOShape-obj` / `PitchJumpInterval-obj` strings).
- The object-name strings are **absent from the app binary** (arm64 + x86_64) but
  present in read responses ⇒ the dictionary is built at runtime from pedal data
  (likely the current program's serialization; import #2's dict ≈ the then-current
  `VECHOLONG` program). The app embeds JUCE's zlib (v1.2.3), whose
  `GZIPCompressorOutputStream` supports a dictionary argument.
- **Blocker status changed:** not "recover a cipher" — instead "capture the exact
  dictionary", then the encoder is a normal `deflate` with that dictionary.

## 2026-08-05 update — read path solved; write path decoded (was: confirmed encrypted)

Big progress. Re-examining the clean captures with the verified LSB-first 7-bit
unpack (`h90_decode.unpack_7bit`) overturned two earlier conclusions:

- **READ path (pedal → app) is NOT encrypted.** Every large message in the clean
  Aug-2 capture `server/h90-captures/h90_virtual_rx.log` unpacks to a valid zlib
  stream that inflates to a **plain FlatBuffers** payload (root uoffset = 12,
  prefix `0c 00 00 00 08 00 0c 00 07 00 08 00`). All 18 messages extracted to
  `/tmp/h90_fb/<header>.bin` (e.g. `03050066.bin` = 149,868 B library dump with
  real preset names `OilDrum` / `Indigo Fog` / `Resotap`, and JUCE param objects
  like `switch6-obj`, `Sw 6: %s`). Small messages (≤ ~100 B body) are raw
  FlatBuffers with no zlib. We can now read the pedal's full state/library.
- **WRITE path (app → pedal) is DEFLATE + preset dictionary — NOT encryption.**
  The import request (`03 5E 00 4F`, one message per import: 768 B for import #1,
  512 B for import #2) unpacks to a real zlib header `78 9c` + deflate data that
  references a missing preset dictionary. Decoded with `decompressobj(-15, zdict=…)`.
  (Earlier "high-entropy / fake marker / not zlib" conclusions were wrong — the
  dict was the only missing piece.)
- Replay rejection (2026-08-04) is now coherent: reads are stateless plaintext;
  writes are compressed against a runtime dictionary, so a replayed write (built
  against the pedal's then-current program) is rejected when that program differs.

**Correction to the 2026-08-04 note below:** "the custom encryption is the
remaining blocker" was wrong — reads are solved and writes are dictionary-deflate.

## 2026-08-04 update — replay is dead; cipher RE is required

Empirically proven today (see `server/h90-relay-notes.md`):

- The pedal's BLE-MIDI session can get corrupted (garbage CoreMIDI names, no MIDI
  endpoints, app shows no connections). Fixed by power-cycling the H90 + toggling
  macOS Bluetooth. CoreMIDI then exposes `XC-05987 Bluetooth` again.
- **The pedal rejects ALL replay/modified/retried import requests**, on every
  transport and configuration tested:
  - via CoreMIDI (BLE and USB), with and without the desktop app connected;
  - original captured bytes, message-ID byte flips, double-send retry.
- Plaintext **type-01 poll/read requests replay fine** standalone (the pedal
  answers with a fresh state response). So reads are stateless; the encrypted
  type-03 **write** path is stateful/validated (per-message counter/nonce inside
  the ciphertext, or a connection-bound write key) and is transport-independent.
- The H90 over **USB** presents as CoreMIDI endpoint `H90 Pedal` (stable,
  no BLE flakiness) plus a mass-storage interface (class 8) that does **not**
  mount as a volume. USB does NOT bypass the encryption: same protocol-level
  rejection.
- The "live-session replay" idea (replay a captured import while the desktop app
  holds the connection) was also tested: **rejected**.
- Raw-BLE (CoreBluetooth) framing of SysEx also produced no responses; CoreMIDI
  does the correct BLE-MIDI framing, so **CoreMIDI remains the transport** for
  any future sender.

Conclusion: **capture-and-replay cannot ship.** Sending preset content without
the desktop app requires recovering the cipher (or a keystream) from the binary
via a dynamic lldb trace. Only PC/CC (Program Change, already implemented) and
plaintext reads work standalone today.

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

- `F0 1C 77 00 <f4> <f5> <f6> <f7> <body> F7` — all messages (type 03 = data, type 01 = control/ack)
- Header bytes are two 14-bit fields, high/low split:
  `msgid = (f4 << 7) | f5`, `type = (f6 << 7) | f7` (0x02 = device error, 0x34 = success).
  Response message IDs differ from request IDs.
- **The body is 7-bit bit-packed data** (8 packed bytes → 7 raw bytes). Verified
  scheme is **LSB-first** (`h90_decode.unpack_7bit`; round-trip verified). The
  earlier "MSB-first" note below was wrong.
- **Read path** (pedal → app): unpack → zlib deflate → **plain FlatBuffers** root uoffset 12.
- **Write path** (app → pedal): unpack → real zlib header `78 9c` → **raw DEFLATE
  referencing a preset dictionary** (standard zlib rejects it; needs `zdict=`).

So the chains are:
- Read: `pedal state → zlib → 8-bit bytes → 7-bit pack → SysEx`
- Write: `preset → (compact serialization) → raw-deflate w/ dictionary → 8-bit bytes → 7-bit pack → SysEx`

- The import request header is constant: `F0 1C 77 00 03 5E 00 4F 78 38 16`
  (payload diverges immediately after; `78 38 16` unpacks to the `78 9c` header).
- `.pgm90` files are NOT sent verbatim: a 3024 B `.pgm90` becomes a ~757 B wire
  payload, i.e. a compact serialization of the preset (trpc flatbuffer model),
  not the file.

### The blocker (WRITE path only): the exact dictionary (NOT a cipher)

- The write payload is standard DEFLATE (real `78 9c` header, FDICT bit unset).
  Standard `zlib` fails with `invalid distance too far back`; `zlib.decompressobj
  (-15, zdict=…)` decodes both imports. The unknown is the **dictionary** the app
  and pedal both build at runtime.
- 19 length-distance matches reference the dict; 169 output bytes depend on it;
  144 distinct dict window offsets span the last 848 B of the 32K window
  (31916–32764). The referenced bytes look like a preset serialization (vtable
  offsets, u32 lengths, `LFOShape-obj` / `PitchJumpInterval-obj` / `Lte-obj`).
- The object-name strings are **absent from the app binary** (arm64 + x86_64) but
  present in read responses ⇒ the dictionary is built from **pedal data** (likely
  the current program's serialization; import #2's dict ≈ the then-current
  `VECHOLONG` program, whose `.preset90` file we hold).
- The app embeds **JUCE's zlib (v1.2.3)** ("1.2.3", "deflateEnd failed (ignored)")
  — JUCE's `GZIPCompressorOutputStream` takes a dictionary argument, consistent
  with a runtime-built dict string.
- Pedal firmware is local (`~/Library/Eventide/H90 Control/Firmware/h90-1.11.4.os`,
  34.9 MB): contains zlib refs, no plaintext object names (likely compressed).
- Binary: `/Applications/Eventide/H90 Control.app/Contents/MacOS/H90 Control`
  (arm64 slice: 6.2 MB; **stripped**, 742 symbols, no dSYM).

### Static RE progress

- Disassembly dumped to `/tmp/h90_disas.txt` (arm64, ~1.16M lines).
- Candidate import/install thread function around `0x1002f131c`
  (strings: "Import already in progress", "Importing algorithm...",
  "Error sending segment ", source path `.../ImportAlgorithmToCurrentProgramThread.cpp`).
  Segment size constant 2048; integer-to-ASCII progress-string builder inside.
  Note: that exact breakpoint got 0 hits in the lldb sessions — likely the wrong
  call-site for the captured (newer) app. No "encryptor" to find — the write path
  is DEFLATE; the relevant call is the dict construction / deflate call.
- `otool` section `offset` fields are **decimal** (a gotcha: `5531060` is decimal,
  not hex). __TEXT maps file offset → VA directly (`VA = 0x100000000 + file_off`).
- **lldb attach works on the debug copy** (`~/h90-re/H90 Control.app`, re-signed
  with `get-task-allow`): attached to the live PID and ran `memory find`
  successfully. Heap `memory find` for `LFOShape-obj` over 0x10d900000–0x500000000
  returned nothing (dict/ValueTree not resident, or in a different range).

### Resume here (next steps)

Read path solved; write path = DEFLATE + dictionary (decoded), the **dictionary**
is the only unknown. Primary route is a live capture; one attempt (2026-08-05,
~19:15–19:20 MSK) was armed but paused before any import fired — the app sends
NO MIDI while idle, so the import click is required to trigger the send
breakpoints. Ready-to-reuse helper + arm command are documented in
`H90-IMPORT-NOTES.md` under "LIVE dict-capture attempt".

1. **Capture the dictionary (primary).** The debug app (`~/h90-re/H90 Control.app`,
   v1.9.5, re-signed with `get-task-allow`) runs live against the pedal through
   the proxy. lldb-attach, trigger an import, and at the `MIDISendEventList` send
   breakpoint (breakpoint 1, symbol857+704) dump the compressor's `z_stream`
   dictionary, or `memory find` the heap for the dict blob at send time. Favoured
   hypothesis to test offline first: dict = the current program's serialization
   (import #2 ≈ `VECHOLONG-64027c252ee6e.preset90`).
2. **Verify:** decompress `req1.raw`/`req2.raw` with the captured dict; full
   plaintext must be valid and the pedal must accept a re-import.
3. **Read-side schema recovery (feeds the encoder).** Recursively parse
   `/tmp/h90_fb/*.bin` (the decoded read FlatBuffers) to map
   ExportedProgram/ExportedPreset tables, vectors, strings → build the plaintext
   encoder and align `.h90` backup JSON / `.pgm90` files against it.
4. **Implement** once solved: `POST /api/h90/preset` builds the compact
   serialization → raw-deflates with the dictionary → 7-bit packs → sends via
   CoreMIDI (`H90 Pedal` USB endpoint or `XC-05987 Bluetooth`).

## Implementation (once the dictionary is solved)

- `server/server.js`: add `POST /api/h90/preset` accepting `{ presetFile/presetName, algorithm }`,
  reads the `.pgm90`, builds the flatbuffer, raw-deflates with the dictionary,
  7-bit packs, sends via `midi`.
- Angular detail page: "Send to H90" button → `POST /api/h90/preset`.
- Update `README.md` and this file with the final codec.

## Open questions

- **The exact dictionary.** Built at runtime from pedal data (current program?),
  same layout as the `.preset90` ValueTree serialization but a compact/wire
  variant — the decoded request diverges from the `.preset90` format beyond byte
  196. Not present as plaintext in the app binary or the local firmware.
- Both imports decode with `eof=False` (0 unconsumed, no skip offset works) — the
  deflate stream ends without a final block. Truncated capture or non-final flush?
- The `00 4F` / `00 13` / `00 52` sub-fields in the 03 header (msgid high byte).
- WiFi MIDI vs BLE: does the desktop app accept the identical SysEx over WiFi MIDI?

## Key files

- `server/h90_dict_recover.py` — validated raw-DEFLATE inflater with LZ77 match
  tracking + per-byte dict-source attribution (validated byte-for-byte vs zlib;
  see `H90-IMPORT-NOTES.md` "2026-08-07" section)
- `server/test_h90_dict_recover.py` + `server/tests/*.json` — regression suite
  (fixed/dict corpora + seeded random crosschecks vs zlib)
- `server/h90-captures/*.bin` — captured import requests/responses
- `server/h90-captures/h90_virtual_rx.log` — **clean** Aug-2 read capture (all
  messages decode to plain zlib FlatBuffers); extracted to `/tmp/h90_fb/*.bin`
- `server/h90-captures/h90_proxy_usb.log` — **corrupt** Aug-5 BLE capture: the
  proxy logs `prefix(len)` of the 256-byte inline MIDIPacket buffer, over-reading
  heap for packets > 256 B; do not use for payload bytes
- `server/h90_proxy.swift` — BLE MITM proxy (source, has the over-read logging bug)
- `server/h90_decode.py` — verified `unpack_7bit` / `pack_7bit` / FlatBuffer walker
- `server/capture-proxy-long.js` / `server/capture-h90-long.js` — BLE capture helpers
- `server/h90-send.js` — working WiFi-MIDI Program Change sender
- `patchstorage/pgm90/*.pgm90`, `patchstorage/preset90/*.preset90` — preset files
  to compare against wire payloads
- `/tmp/h90_fb/req1.raw` (664 B) / `req2.raw` (440 B) — the unpacked write payloads
  after the `78 9c` header (sources: `h90_import_req.bin`, `h90_import2_req.bin`)
- `/tmp/write2_out.bin` — decoded request #2 (793 B, zdict=zeros) = 32 B wrapper +
  embedded preset serialization (first 196 B match the MURKY `.preset90` file)
- `server/h90-captures/req1_dict_constraints.json` /
  `req2_dict_constraints.json` — regenerated with the validated decoder: direct
  dict window-offset→byte constraints (req2: 144, offsets 31916–32764)
  for scoring candidate dictionaries
- `/tmp/deflate_dec.py` — custom inflate (validated byte-identical vs zlib on the
  35,604 B read payload; used for the dict-footprint analysis)
- `server/h90-captures/h90_dict_capture.py` — lldb Python helper for the live dict
  capture (MIDI-send breakpoint commands, heap scan, 64 KB dict save); arm command
  and results in `H90-IMPORT-NOTES.md` ("LIVE dict-capture attempt")
- `~/h90-re/H90 Control.app` — debug copy (v1.9.5, re-signed with `get-task-allow`;
  lldb-attachable, running live against the pedal through `server/h90_proxy`)
- `~/Library/Eventide/H90 Control/Firmware/h90-1.11.4.os` — local pedal firmware
  (34.9 MB; has zlib, no plaintext object names)

## Plan — 2026-08-13 angr static analysis of the Windows H90 Control.exe

Goal: use **angr** (source checkout `input/angr-master`, Python 3.12) to
statically locate the write-path zlib **dictionary construction** in the
Windows x64 `H90 Control.exe` (v1.9.13, the same JUCE build family as the
capture-era macOS 1.9.5), then score any recovered candidate dict offline with
`server/h90_dict_recover.py` against `req2_dict_constraints.json` (144
constraints) / `req1_dict_constraints.json` (69). The live lldb capture stays
the primary route; this is the offline static route (DECISIONS "Resume here"
step 4, H90-IMPORT-NOTES "2026-08-12").

Steps:
1. Install Rust (winget `Rustlang.Rustup`, `stable-msvc`) — MSVC 14.29 present.
2. Patch `input/angr-master/pyproject.toml`: `pyvex==9.3.3.dev0` (not on PyPI)
   → `pyvex>=9.3.2` (released win_amd64 wheel). Build via
   `pip install ./input/angr-master` under `vcvars64.bat`. Fallback: PyPI wheel.
3. User installs `input/H90Control-1.9.13-windows-x64-installer.exe`.
4. New `server/h90_angr.py`: load exe → locate/decompile the documented TRPC
   `sendMessage` fn `0x14013b610` (sanity vs rizin notes) → FLIRT-match
   zlib (`deflate`, `deflateSetDictionary`) → xref callers → decompile →
   backward-slice the `zdict` argument → recover dict construction.
5. Verify: `deflate_track(req, zdict=cand)` vs the constraint JSONs; if clean,
   `zlib.decompressobj(-15, zdict=cand)` gives full req1/req2 plaintext matching
   the TWO-WAY / MURKY `.preset90` heads.

Deliverable: `server/h90_angr.py` + Progress entry + H90-IMPORT-NOTES section.
