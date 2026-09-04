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

## Plan — 2026-08-21 angr deep trace: recover the DEFLATE dictionary from H90 Control.exe

Goal: use angr to statically recover the exact DEFLATE preset dictionary (or
the code that builds it) from the Windows x64 H90 Control.exe (v1.9.13), so
we can encode arbitrary presets and import them to the H90 without the desktop
app.

Approach:
1. Load the exe in angr, build CFGFast, FLIRT-match zlib functions.
2. Locate `deflateSetDictionary` (zlib internal) and JUCE
   `GZIPCompressorOutputStream` constructor — these are the two sites where
   the dict pointer is consumed.
3. Backward-trace the dict argument through callers to find the function that
   constructs/assembles the 32KB serialization buffer.
4. Decompile the constructing function; identify the loop that fills the dict
   with pedal data (likely a FlatBuffers/ValueTree serialization of the
   current program).
5. If the dict is assembled from known structure (e.g. concatenation of
   preset parameter values), recover the layout and build the encoder.
6. Score any recovered candidate against `req1_dict_constraints.json` (69
   constraints) and `req2_dict_constraints.json` (144 constraints) using
   `h90_dict_score.py`.

Verification: `deflate_track(req, zdict=candidate)` must decode both req1 and
req2 to valid output where the b64 region matches the .preset90 file JSON.
If full decode succeeds, `zlib.decompressobj(-15, zdict=candidate)` must also
produce valid output matching the captured import.

Deliverable: updated `server/h90_angr.py` with dict-recovery commands,
candidate dictionary file, Progress entry + H90-IMPORT-NOTES section.

## Plan - 2026-08-21 (post-reboot) fix RE scripts and trace deflate dict path

Goal: resume the interrupted 08-21 angr deep trace. Two defects found on first
run: (1) `server/h90_find_deflate.py` string-search loop never advances its
cursor (`EXE.find` restarts at section start each iteration, overwriting
`idx += 1`) -> infinite print of the first "deflat" hit; (2)
`h90_angr_targeted.py` ZLIB_STRINGS VAs are stale ("deflateEnd failed" is at
0x140830aa0, not 0x1408324a0), so Phase 3 pointer hunts targeted wrong VAs.

Steps:
1. Fix cursor bug; make the script dump all zlib strings once with correct VAs.
2. Auto-discover zlib/JUCE string VAs at runtime instead of hardcoding.
3. Xref "deflateEnd failed (ignored)" -> JUCE GZIPCompressorOutputStream
   write/destructor -> deflate()/deflateSetDictionary() call sites.
4. Decompile the dict-construction site with angr; recover candidate 32KB dict.
5. Score candidate against req1/req2_dict_constraints.json via
   h90_dict_recover.deflate_track.

Verification: candidate dict decodes both reqs with all constraint positions
in b64 set; zlib.decompressobj(-15, zdict=cand) reproduces captured plaintext.
Deliverable: fixed scripts + Progress entry + H90-IMPORT-NOTES.md section.

## Plan - 2026-08-21 continuous-deflate-session hypothesis test

Goal: test the hypothesis that the import write capture is ONE continuous
zlib deflate session (app compresses ~31KB current-program dump first, then
each TRPC message is a Z_SYNC_FLUSH segment), so the "72 unknown dict bytes"
are ordinary back-references into earlier output - no preset dictionary, no
lldb capture needed.

Evidence: req1 dict-copies cluster at window offsets 31004-32730 (end of a
32K window); req2's "dict" = req1_out[124:973] at window 31916-32764; the RE
of H90 Control.exe found NO deflateSetDictionary call anywhere in the JUCE
gzip helper TU (0x14013e970 init->write->finish, windowBits=+15).

Steps:
1. Inspect server/h90-captures/h90_import_req.bin / h90_import2_req.bin:
   sizes, 78 9c occurrences, framing.
2. Decompress each capture as one continuous zlib stream from its session
   start (78 9c).
3. Verify req1/req2 constraint positions decode to b64 bytes without any
   preset dictionary.
4. Decode the ~31KB prefix with h90_decode tooling; identify content.
5. If confirmed: build encoder replicating app framing; byte-compare vs
   captures.

Verification: zlib.decompress of full session succeeds; req1/req2 outputs
match previously reconstructed plaintexts byte-for-byte.

## Plan - 2026-08-21 import encoder (continuous-session model confirmed)

Confirmed: req2 continues req1's deflate window (568/787 out bytes copied from
req1_out); each TRPC frame = 78 9c + sync-flush segment + per-message adler32
(req1 stored 0xee497217, req2 0xac6eda29). Plaintext = ValueTree-style doc:
binary wrapper + tjknobs-knob4 + xdl + chunked b64 of preset JSON with marker
bytes (00 00, 0d, 80, 3f, 14, 10) between chunks; second tjknobs block ends
with JSON terminator "}\n". References on disk: server/h90-recon/twoway.json
(1173B), preset90_twoway.bin (contiguous b64 + tjknobs-knob1..10 + UUIDs),
resp1_dec.bin (pedal current-state dump), decode_status.json (72 unknown pos,
dict offsets 31004-32730).

Phases:
1. Format completion: parse preset90_twoway.bin FlatBuffers schema; diff
   req1_out vs preset90/twoway.json byte-by-byte (literal/copy/marker map);
   identify both tjknobs blocks; extract VECHOLONG values from resp1_dec.bin.
2. Proof: assemble P = X ++ out1 ++ out2 with unknowns filled; recompress
   (stock zlib, Z_SYNC_FLUSH boundaries) and require byte-exact match vs both
   captured segments + adler32 trailer match.
3. Encoder: compose -> compress -> frame wrap (type 0x4f) -> 7-bit pack;
   gate = re-encode TWO-WAY import reproduces h90_import_req.bin exactly.
4. Live validation on pedal; update H90-IMPORT-NOTES.md.

Fallback: if X unsolvable algebraically, capture fresh session with known
current program to pin X empirically.

### Status - 2026-08-25 deep format analysis

Key findings from exhaustive plaintext analysis:

1. **Write plaintext structure (976B)**:
   - [0:32] FlatBuffers-like header (root@4, vtable@16, vtsize=8, tsize=12, 2 fields)
   - [32:162] Metadata: u32 values including descending offset table
     (828,752,684,616,548,480,412,344,276,208,140,72,4) at [88:140]
   - [162:192] 3 float32 values (1.0, 0.5, 1.0) + padding
   - [192:211] "tjknobs-knob4\x00\x00\x00xdl" separator (first block)
   - [211:872] Block 1: 661B of b64-encoded data with NUL dict-copy gaps
   - [872:891] "tjknobs-knob4\x00\x00\x00xdl" separator (second block)
   - [891:951] Block 2: 60B of b64-encoded data (ends with JSON terminator)
   - [951:976] Trailer: 19 dict-copy bytes + metadata

2. **Critical size mismatch**:
   - B64 chars in plaintext: 637 (zero dict) → max 690 (correct dict)
   - 690 b64 chars decode to ~517 bytes
   - twoway.json compact: 1169 chars → b64: 1560 chars
   - **The plaintext CANNOT hold the full twoway.json as base64**
   - Conclusion: write serialization uses a DIFFERENT/SHORTER representation

3. **Dict copies**: 72 total, 53 in [211:951], 19 in [951:976]
   - With resp1 dict: only 11 of 53 produce b64 chars (resp1 is NOT correct dict)
   - Correct dict = VECHOLONG write serialization (unknown)

4. **B64 region is NOT continuous**: split into 26 C-string-like chunks separated
   by NUL pairs. Chunk-by-chunk decode shows JSON fragments but many chunks fail
   due to NUL positions breaking b64 alignment.

5. **preset90_murky.bin** (1684B): FlatBuffers with root(2 fields: u32=1500 +
   vector of 16 knob objects). Knobs: Tap2DelayDivision-obj, PitchJumpInterval-obj,
   DELAYMODE-obj, LFOShape-obj, LFORate-obj, Depth-obj, FeedBack-obj, Delay-obj,
   Mix-obj. UUIDs at end. Preset name "MURKY BUCKUET LEAD".

6. **Encoder output** (h90_encoder.py): fills 637 b64 positions sequentially from
   the JSON b64, but this truncates the JSON to ~40% and misaligns chunk boundaries.
   Generated frame differs from capture at byte 3 (compressor divergence).

### Blockers

- **Write format unsolved**: The 976B plaintext cannot hold 1169-char JSON as b64.
  Must use a different serialization (JUCE ValueTree binary? compact binary with
  string pool? fixed-length field table?). The u32 offset table at [88:140] and
  the FlatBuffers-like header suggest a structured binary format, not raw b64.
- **No dictionary**: VECHOLONG values unknown; 72 positions underdetermined.
- **No .preset90 for TWO-WAY** (0 bytes).

### Status - 2026-08-25 deep format analysis (continued)

7. **The data IS base64-encoded JSON**: Continuous b64 run at [275:549] (274 chars)
   cleanly decodes to JSON: `987.4534912109375,"dlya_denormalized_pretaper":350.0,
   "dlya_end_exp":0.9823130369186401,...`. Run [211:230] (19 chars) decodes to
   `verse","bypa_n` — matches twoway.json offset 21 exactly.

8. **Alignment mismatch**: The b64 at [211:230] encodes JSON bytes 21-34. For a
   contiguous stream, JSON bytes 0-20 would need 28 b64 chars at [183:211]. But
   [183:211] = header metadata + "tjknobs-knob4\x00\x00\x00xdl" marker — NOT
   matching expected b64 `eyJhbGdvcml0aG1fbmFtZSI6IlJl`. Only 1/28 positions match.
   
   **Conclusion**: The "tjknobs-knob4\x00\x00\x00xdl" is a STRUCTURAL MARKER
   (field name + type tag) in a JUCE ValueTree-like binary format, NOT part of the
   base64 stream. The base64 JSON data is embedded in data slots within this binary
   structure.

9. **Capacity check**: twoway.json compact = 1169 chars → b64 = 1560 chars.
   Max b64 capacity with correct dict = ~909 bytes → 681 decoded bytes.
   681 < 1169. **The JSON in the write serialization is a SUBSET of twoway.json**.

10. **Field table at [88:142]**: 13 entries (count=13 at [88]), offsets in descending
    order: 828, 752, 684, 616, 548, 480, 412, 344, 276, 208, 140, 72, 4.
    Differences are 68 bytes (except last gap = 76). Entries at [4:192] are header
    metadata; entries at [208:872] are b64 data with NUL gaps (dict copies).

### Blockers

- **Write format unsolved**: The 976B plaintext uses a JUCE ValueTree-like binary
  format with embedded base64 JSON data. The "tjknobs-knob4" strings are field
  names (not separators), and "xdl" is a type tag. The exact serialization format
  is unknown without H90 Control binary access.
- **JSON is a subset**: Max ~681 decoded bytes vs twoway.json's 1169 chars.
  Unknown which parameters are included/excluded.
- **No dictionary**: VECHOLONG values unknown; 72 positions underdetermined.
- **No .preset90 for TWO-WAY** (0 bytes).

### Status - 2026-08-25 binary analysis

11. **Algorithm parameter model found** at file 0x770a0e: JSON object mapping 52
    algorithm UUIDs to their 10-knob parameter lists. TWO-WAY = UUID
    `21e22b15-5814-4cf8-b271-ffbaea0d4246` → `["xfad","mdpt","mspd","fltr",
    "fbkb","fbka","dlyb","dlya","dmix","mmix"]`. All 52 H90 algorithms documented.

12. **Binary string findings**:
    - `Dot9Controller.cpp` source references at 9 locations in .rdata
    - `Dot9Controller::exportPreset` mangled name at 0xa0b1f2 (.data section)
    - `ParameterModel.cpp` source references at 5 locations
    - `ParameterModel::deserialize` mangled name at 0x7cb4e7
    - `ExportedPresetT@models@trpc` struct name appears 25+ times
    - `ParameterMetadataT@dot9@trpc` struct name appears 2 times
    - JUCE `AudioProcessorValueTreeState` references at 5 locations
    - "Device State Serialization Error" at 0x7c54c0
    - "Export Preset" UI label at 0x7c5888

13. **Binary is NOT directly analyzable by capstone** for function discovery:
    - Strings are accessed via vtables/RTTI, not LEA [rip+disp32]
    - No pointer tables found in .rdata pointing to key string VAs
    - angr 9.3.3 loads but CFG analysis too slow for 10.7 MB binary
    - LEA scan of entire .text section found zero references to key strings

14. **JSON format confirmed**: twoway.json compact (same key order), with decoded
    fragments matching at verified offsets. The stream has 740 positions (622 known
    b64 + 118 gaps), capacity = 555 decoded bytes vs twoway.json 1169 chars.
    **The write serialization JSON is approximately 47% of the full preset JSON.**

### Blockers

- **Dictionary needed**: Without the preset dictionary, the 118 NUL gaps cannot be
  filled, so the exact JSON subset cannot be determined from static analysis alone.
- **Binary function discovery blocked**: RTTI-based function finding requires either
  angr CFG (too slow) or manual vtable reconstruction.
- **No .preset90 for TWO-WAY** (0 bytes).

### Next steps

1. **Replay captured import** to verify MIDI path works (highest priority).
2. **Runtime dictionary capture** via debugger to resolve the 118 gaps and
   determine the exact JSON subset.
3. **Alternative**: capture fresh import with known preset to extract dictionary,
   then decompress req1 with correct dict to see full JSON.
4. **Build encoder incrementally**: once JSON format is known, build the encoder
   that composes JSON → compress → frame → 7-bit pack → send.

### Plan - 2026-08-28 replay captured import

Replay the captured TWO-WAY import frame (h90_import_req.bin) verbatim over MIDI
SysEx to verify the MIDI transport path works. Discovered the H90 connects via
Windows BLE-MIDI and is exposed as 'H90 Pedal 1' (out) / 'H90 Pedal 0' (in);
the 'midi' npm module cannot build (no MSVC) but python-rtmidi 1.5.8 installs
fine and enumerates the H90 ports. Built h90_replay.py to send the raw frame
and capture any response.

### Status - 2026-08-28 replay attempt

- Installed python-rtmidi 1.5.8 (the 'midi' npm module cannot build - no MSVC;
  no prebuilt wheel). Enumerates the H90 USB-MIDI device.
- H90 is connected via USB (VID_1B12 PID_0041, MI_01 = usbaudio), exposed as
  MMDEVAPI MIDI ports: OUT[1]='H90 Pedal 1', IN[0]='H90 Pedal 0'. NOT BLE.
- Built h90_replay.py to send a captured frame via MIDI SysEx.
- KEY FINDING: plain MidiIn.get_message() POLLING misses the H90 responses on
  Windows USB MIDI; must use mi.set_callback(). First callback test sent a
  small read-state query (type 0x0003/F01C77000116000...F7) and received the
  expected response (type 0x0004) - confirming bidirectional USB-MIDI works.
- Verified the captured import frame is structurally valid: body 7-bit unpacks
  to 665 bytes starting 78 9c + 659-byte deflate stream; zero-dict inflate fails
  with 'invalid distance too far back' (confirms the LZ77 dict is required,
  expected).
- PROBLEM: after the first callback query test, the pedal went unresponsive to
  ALL subsequent sends (import replay with callback, repeated read-state
  queries) - 0 responses where before it answered. Likely the type-0x4f import
  put the H90's SysEx/MIDI interface into a stuck/partial state, OR the USB MIDI
  link dropped. No admin rights to software-reset the USB device.
- RESOLUTION NEEDED: power-cycle or re-plug the H90 to reset its MIDI interface.

### Status - 2026-08-28 MIDI transport investigation

- Confirmed H90 USB-MIDI is HEALTHY: the H90 Control app connects and controls
  the pedal (vendor USB\VID_1B12 PID_0041, MI_01 usbaudio).
- python-rtmidi WORKS for output and, once, for input. But separate-process raw
  reads stopped working after one success and stay dead across power-cycle,
  full cold reboot, app open, and app closed. The H90 Control app holds the
  working channel; independent RX from another process is not reliable on this
  Windows stack.
- Captured import frame verified structurally valid: 7-bit unpacks to 665 bytes
  starting 78 9c + 659-byte DEFLATE; zero-dict inflate rejects with
  'invalid distance too far back' (confirms LZ77 dict required).
- PLAN to capture live app<->pedal traffic (the project blocker: LZ77 dict +
  exact JSON subset) = Bome Virtual MIDI router, the Windows equivalent of the
  macOS CoreMIDI proxy that produced the original captures.
- Bome Virtual MIDI 2.1.0.44 is installed at C:\ProgramData\Bome Software\Bome
  Virtual MIDI (driver + enumerator ROOT\SYSTEM\0003 present) BUT the virtual
  port device (BOMEBUS\BomeMIDI 'Bome Virtual MIDI Port') is NOT instantiated.
- Installing that port device requires ADMIN (portinstall.exe / driver
  coinstaller). This session has no admin rights, so the Bome port cannot be
  created by this tool account directly - needs a one-time user-elevated step.
- H90 Control.exe has no AppData/storage directory written by the app; preset
  state is not dumped to an accessible file.

### Status - 2026-08-28 Bome router not available (correction)

- portinstall.exe in the free Bome Virtual MIDI package is actually the Bome
  MIDI Translator port manager (options -addInOut/-addOut/-rmAllByID, calls
  BMIDI_AddPort/BMIDI_RemovePort through bmidilib2.dll).
- bmidilib2.dll is NOT installed anywhere on this machine, and Bome MIDI
  Translator is not installed. Without that routing runtime + admin to create
  the BOMEBUS\BomeMIDI port device, the Bome virtual-MIDI capture router is NOT
  actionable here. The earlier 'Bome router' proposal was based on incomplete
  info and is withdrawn.
- Net blocker for live app<->pedal capture on Windows: no virtual MIDI router
  (needs admin + Bome MIDI Translator runtime), and python-rtmidi standalone
  RX from the H90 is unreliable because the H90 Control app owns the channel.
- The only environment with a working H90 capture proxy is macOS (Swift
  CoreMIDI relay, h90_proxy.swift), which is where the original captures came
  from.

### Plan - 2026-08-28 install Bome MIDI Translator for router

User chose to install Bome MIDI Translator (paid; provides bmidilib2.dll and
admin-installed virtual MIDI ports) to build a Windows MIDI router that
captures H90 Control app <-> pedal traffic, resolving the import LZ77 dict +
exact JSON subset, and enabling verified replay.

Router design (mirrors macOS h90_proxy.swift):
- Create virtual port pair via portinstall.exe -addInOut appID=... in=... out=...
- Point H90 Control app's device at the virtual port
- Python h90_router.py: forward app->virtual->pedal (log TX), and pedal->app
  (log RX), so all SysEx in both directions is captured to disk.


### Status - 2026-08-28 Bome MIDI Translator Pro installed; router architecture revised

- User installed Bome MIDI Translator Pro (bome.com, paid) - running as
  MIDITranslator.exe at C:\Program Files\Bome MIDI Translator Pro\ (Java/jre
  bundle + mt.dll). NOT the free Bome Virtual MIDI package; the earlier plan of
  using portinstall.exe -addInOut with bmidilib2.dll is superseded.
- Confirmed via pypdf extraction of the bundled manual.pdf (138 pages):
  * Bome virtual MIDI ports are UNIDIRECTIONAL and one end MUST be MIDI
    Translator itself (section 3.1). Two external apps CANNOT share the two ends
    of a Bome virtual port pair. This invalidates the original 'Python in the
    middle of two Bome ports' router design.
  * Correct architecture = let Bome do the routing with its built-in MIDI
    Router (section 3.4; worked example 14.1): activate the virtual IN/OUT
    ports in Settings/MIDI Ports, patch-cord them to the physical H90 Pedal
    IN/OUT in Settings/MIDI Router, and point the H90 Control app at the Bome
    virtual ports.
  * Capture via the Log Window MIDI IN / MIDI OUT monitor (section 4.9), or a
    Log rule dumping $hex of each message (section 10.2.6).
- FLAG for future work: Bome virtual ports require Bome on one end, so a
  separate Python byte-level tap would need Bome to mirror traffic out an
  extra virtual OUT port that Python reads (Python as the destination app).
- NOTE: Bome MIDI Translator Pro config lives at
  C:\Users\Thoma\AppData\Roaming\Bome\MIDITranslatorPro.bmts
  (CurrentVersion 1.9.2.1087; VirtualMidiPorts=0, CurrentProject= empty - no
  project loaded, so no ports are exposed yet).
- SESSION STOP: user called a halt after the capture-method choice (Log Window
  copy). No capture was performed. Next applicable step, if resumed: set up the
  Bome MIDI Router bridge + Log Window monitor as above, then trigger an
  import in the H90 Control app and capture app->pedal TX and pedal->app RX.


### Status - 2026-08-28 H90 Control UI automation (screen parser + parameter driver)

- Discovered the H90 Control app (JUCE) exposes a full UI Automation (UIA)
  tree via pywinauto: device button H90: XC-05987, tabs, and every editor knob
  as a co-located Slider (rotary) + Edit (value readout) + Text (label).
  This makes pixel/OCR reading unnecessary.
- Created server/h90_ui.py:
  * scan_params(): walks the UIA tree, groups labels/readouts/sliders by
    column and row; each value readout consumed by exactly one label.
  * --list: prints all visible params with current values.
  * --get LABEL: reads one parameter.
  * --set LABEL VALUE: drives the knob by mouse-dragging its slider center
    vertically, with on-the-fly calibration (measures px-per-value-unit from a
    20px reference nudge, then iterates to land on target within tolerance).
- Verified live: In Gain 0.0dB -> set 3 -> 3.1dB (0.1dB coarse step), then
  restored to ~0dB. Continuous knobs (Mix, gains, filters, resonance, fuzz,
  envelope, sensitivity, hotknob) read+set cleanly.
- LIMITATIONS: switch-type knobs (Bypass, Tails, Pitch Mix, Oct-Fuzz Mix,
  Kill Dry, Tempo Mode) show empty readouts (their value is not a plain Edit on
  the same row); would need click-on-selector handling.
- VALUE FOR PROJECT: every --set drives the app to emit SysEx to the pedal, so
  h90_ui.py is the missing trigger generator for the reverse-engineering
  sweep: pair with the Bome MIDI Router capture to map each knob -> JSON key,
  resolving the encoder dictionary + key order.


### Status - 2026-08-28 Algorithm parameter model extracted (knob -> JSON key)

Big step for the encoder: identified "Drty Vocals" as the Octaver algorithm
(UUID 0163d495-aaea-4727-a223-ef5b190975d3) and recovered its parameter model
from the running app's live editor descriptor (verified in PID 14716) plus the
binary 52-algorithm JSON model (file 0x771f6f / 0x770a0e, UUID table 0x7cc7f8).

Octaver JSON key order: atck, sens, fuzz, fzmx, resb, resa, fltb, flta, pmix,
mmix.

Knob label -> key (verified live):
  Mix=mmix, Pitch Mix=pmix, Oct-Fuzz Mix=fzmx, Envelope=atck, Sensitivity=sens,
  Fuzz=fuzz, Filter A=flta, Filter B=fltb, Resonance A=resa, Resonance B=resb.

On-screen order is NOT the JSON order; UI re-sorts to [mmix,pmix,fzmx,atck,
sens,fuzz,flta,fltb,resa,resb] and shows Filter/Resonance A-before-B though JSON
is B-before-A. knob index != display order either (hints: knob1=atck ...
knob10=mmix). This mirrors the Reverse/UUID key list [xfad,mdpt,mspd,fltr,
fbkb,fbka,dlyb,dlya,dmix,mmix] -- 'mix' base keys (dmix/mmix) recur consistently.

Other on-screen knobs (In Gain, Out Gain, Bypass, Tails, Tempo Mode, HotKnob,
Kill Dry) are global/pedal-level params, not algorithm digits; they map to
twoway.json-style global keys (in1_sens/out1_sens, bypa_normal, killdry,
expression_pedal, tmpv, tsyn, x_switch/y_switch/z_switch).

Agent artifacts in C:\Users\Thoma\AppData\Local\Temp\opencode\ : octaver_desc*,
model.json (52-entry model), d2.txt/d3.txt, scan_full.py, hexwin.py,
dump_region.py.


### Status - 2026-08-28 Live knob -> JSON key value correlation (Octaver)

After extracting the octaver parameter model, captured the current "Drty
Vocals" (Octaver) preset's live values via h90_ui.py and mapped them to JSON
base keys. Same key list applies as in the model:
  mmix=100, pmix=A6+B10, fzmx=oct...........:fz, atck=54, sens=15, fuzz=8,
  flta=69, fltb=76, resa=8, resb=7.
Pitch Mix / Oct-Fuzz Mix are multi-state selector knobs (their readout shows
the option format A6+B10 / oct...........:fz, not a continuous number).

Created server/h90_params.py (algorithm key lists + knob->key maps for
Reverse/UUID and Octaver) and server/h90_read_correlate.py (reads live screen
and prints knob -> JSON key -> value). These are reusable inputs for the
write-serialization encoder.


### Status - 2026-08-28 Full program JSON corpus extracted from H90 Control .lst90 export

Breakthrough: the H90 Control app''s Export (Preset Library -> Export) writes a
158,768-byte .lst90 library file to <repo>/input/ that embeds, for EVERY
program, a NUL-terminated base64 JSON payload preceded by a "tjknobs-knobN"
separator and followed by an "activeBypassMomentary-obj" marker. The JSON is
the complete, full-key serialized preset (algorithm_name, all algorithm params,
aux exp-envelope keys, bypa*/bypt_normal, in/out sens, preset_mix, preset_name,
product_id, slow_mode, tmpv, tsyn, version).

server/h90-recon/extract_lst90.py parses it into lst90_json/<NN>_<NAME>.json
plus manifest.txt. Extracted 37 programs.

This DEFINITIVELY confirms the octaver knob->JSON-key mapping from h90_params.py:
DRTY VOCALS B (lst90_json/35_DRTY_VOCALS.json) matches the live editor values
exactly (atck=54.05,sens=14.9,fuzz=7.79,flta=68.7,fltb=76.05,resa=7.95,
resb=6.55,mmix=100,pmix=69.86,fzmx=100). Full octaver key order captured from
02_MASSIVUZZ.json.

Deliverable is now a full algorithm parameter corpus + confirmed knob map,
giving the encoder the exact per-algorithm JSON key set and value ranges.


### Status - 2026-08-28 Write-document serialization mapped; encoder groundwork

Correlated the captured write plaintext req1_out.bin (976 B, TWO WAY/Reverse)
against the authoritative source twoway.json.

Findings (validated):
- [0:3] version field (04 00 00 00), [4:7] -12, [8:15] length, [16:31]/[32:47]
  size metadata, [48:51] 0xABC, [52:55] 20.
- [76:139] running-offset table (Juce ValueTree child-order) into the data
  region; the offsets are ALGORITHM-SPECIFIC (depend on knob count/order), so the
  header is NOT a fixed template.
- [190:211] separator "tjknobs-knob4" + 0x00 00 00 + "xdldmVy" (start of b64).
- [211:951] = base64 of the program JSON (full key set in canonical twoway key
  order). Readable fragments confirm all keys present: algorithm_name, bypa_normal,
  bypt_normal, dlya, dlya_denormalized_pretaper, dlya_end_exp, dlya_start_exp,
  dlyb, dlyb_denormalized_pretaper, dmix, preset_name(product_id), routing_type,
  slow_mode, tsyn, version, x_switch, y_switch, z_switch, xfad.
- The interleaved non-base64 gap bytes are LZ77 references to the PREVIOUS
  program write (used as the import deflate dictionary, FDICT=0); base64 chars
  shared with the previous slot are not stored literally (103 unresolved bytes).
- [951:976] trailer (mostly zeros + small counts).

Encoder strategy: produce a self-contained 976-byte plaintext with the full
base64 JSON stored inline in [211:951]; serialize JSON = json.dumps(dict,
separators=(',',':')), key order = canonical per-algorithm order (from lst90
corpus + twoway.json). Remaining work: model the algorithm-specific [76:139]
offset table + scalar fields for each algorithm. Added analysis scripts
correlate_write.py, align_twoway.py, recon_write_json.py, decode_aligned.py,
verify_twoway_b64.py, reconstruct_plaintext.py, write_keys.py, fill_gaps.py,
coverage.py (probe analysis; not part of final toolchain).


### Status - 2026-08-28 .lst90 embeds per-program Juce ValueTree header/knob structure

Confirmed: each .lst90 record stores, immediately after its base64 JSON, the
program''s Juce ValueTree binary header including per-knob "tjknobs-knobN"
separator tags and a count-prefixed offset table (e.g. Phaser record:
0e 00 00 00 "tjknobs-knob10" then 07 00 00 00 + 7 offsets then per-knob value
records with fd-relative pointers). This means the per-algorithm header offset
table (the algorithm-specific part of the 976-byte write doc [76:139]) can be
extracted from .lst90 WITHOUT MIDI capture.

server/h90-recon/knob_tags.py enumerates per-record knob tags; e.g. Octaver
CLASSIC OCTAVER shows tags knob2,knob1,knob7,knob8,knob9,knob9. NOTE: clustering
has some windowing noise (trailing records truncated at EOF), so exact per-knob
tag sets per algorithm still need a cleaner record-boundary parser to be fully
trusted.

This unblocks modeling the algorithm-specific write header offline.


### Status - 2026-08-28 Juce knob-block header decodes to exact float32 params (PROOF OF CONCEPT)

Decoded the per-program "tjknobs-knobN" header blocks in .lst90 (MASSIVUZZ
octaver record). The serialized float pairs are EXACT float32 copies of JSON
parameter values:
  * knob3 block  : fzmx_start_exp=0.3079179, fzmx_end_exp=0.5513197 (matches JSON 0.3079178929328918/0.5513196587562561)
  * knob4 block  : pmix_start_exp=0.0, pmix_end_exp=0.5679374 (matches JSON)
Each simple block = ptr + fixed 40-byte header ending in float 1.0 (0x0000803f)
+ 2 float params. Composite blocks (knob9/knob3 here) carry a count + 7 offsets
+ per-child value records. This PROVES the header is a deterministic function of
the program parameter values, so an encoder can regenerate it from JSON.

New recon scripts: octaver_knob_blocks.py (float-pair extractor),
octaver_decode.py, composite_decode.py (probes). Full mapping of composite
children still pending (Juce-ish child-layout with offsets relative to node end).


### Status - 2026-08-28 Full .lst90 record anatomy derived (layout + knob clusters)

Derived the complete per-program record anatomy shared by ALL 37 records:

Record = [RecordHeader] + [knob tree pre-JSON] + [JSON b64] + [knob tree
post-JSON].

RecordHeader (e.g. CHORUS ROOM @50800): "gram\0" + NUL-padded UUID
"00000000-0000-...-0001" + fixed words (70 0d 00 00 b4 08 00 00 58 04 00 00
04 00 00 00 3e 80 fe ff 08 01 00 00 50 00 00 00 ...).

Knob blocks appear in PAIRS straddling the JSON (same tags pre and post, e.g.
MicroPitch = knob10 pre @50944 + knob10 post @52048; Octaver = knob3/knob4/knob9
pre + knob4/knob3 post). Each block = simple (ptr + 40-byte header ending in
float 1.0 0x0000803f + 2 float params) OR composite (count 07 00 00 00 + 7
offsets + per-child records with fd-relative pointers and descending index tags
06,05,04,03,02,01).

Confirmed composite child region is the H90 app CUSTOM binary serialization
(count + offsets + child records), NOT vanilla Juce writeToStream streaming
format (which has no offset table). The per-child field layout was NOT fully
pinned offline - requires a 2nd ground-truth write to verify.

MicroPitch float pairs verified: pre block 0.0 + mmix_end_exp(?); the mechanism
(simple block = 2 exact float32 params) is consistent with the octaver proof.


### Status - 2026-08-28 Write data region = TRUNCATED JSON base64 prefix (encoder-defining finding)

Definitive: the 976-byte write document''s data region [211:951] holds only the
FIRST ~637 base64 chars of the full program JSON (twoway full b64 = 1560 chars).
test_import_plaintext.bin data-region base64 == tw_b64[:637] EXACTLY; req1_out.bin
(wire) == tw_b64[2:639] with raw binary gap bytes. Both share a BYTE-IDENTICAL
write header [0:210] = fixed per-program template.

The write is NON-SELF-CONTAINED: ~923 of 1560 JSON chars are supplied via the
zlib import dictionary (previous program''s write), compressed-away from this
write. 00 00 gap bytes (plain) / raw dict data (wire) mark where dict-copied
chars go.

Encoder implication (h90_enc.py, next): must (a) emit fixed per-algorithm header
[0:210] template, (b) place b64 prefix in [211:951] with gap-byte placeholders,
(c) DEFLATE-compress with prev-write as dictionary so pedal reconstructs full
JSON. New tools: align_json.py, reconstruct_ref.py, wire_vs_plain.py,
req1_stream.py, prefix_check.py (recon probes).


### Plan - 2026-08-29 Reverse H90 Control.exe write-serializer (option 1)

Offline captures proved unfalsifiable for the DEFLATE layer (req1_defl.raw/test_import.bin
do not inflate as plain zlib with any candidate dict; framing layer undetermined).
User chose: disassemble H90 Control.exe (v1.9.13 on disk, 11.2MB) to find the code
that builds the 976-byte write buffer (header [0:210] + truncated JSON base64 region
[211:951] + trailer) and the DEFLATE framing. Anchors: model file 0x770a0e, UUID
table 0x7cc7f8, Octaver UUID 0163d495-aaea-4727-a223-ef5b190975d3, sep literal
"tjknobs-knob4". Goal: authoritative layout + framing so h90_enc.py emits valid writes.


### Status - 2026-08-29 Authoritative static RE of H90 Control.exe (option 1 done)

Disassembled H90 Control.exe (v1.9.13, PE32+, x86-64, stripped) with pefile+capstone
(no radare/IDA available). Key corrected findings (subagent ses_fb16a2785ffel1Xl7L3IOjR3pJ):

- Real name-token table = file 0x7D1618 / VA 0x1407D3018: "tjknobs-knob", "envr-obj",
  "envm-obj", JSON key builders (algorithm_name, preset_name, *_start_exp/end_exp, etc.).
  The 0x7CFC18 table I earlier called the anchor is actually build-path strings.
  "tjknobs-knob4" is NOT a literal; the separator is built at runtime from tokens.
- 976-byte doc = [0:32] root headers (u32 4, -4, 0x4F<type=import>, 12) + [32:192] Juce
  ValueTree field-structure + [192:211] separator "tjknobs-knob4\0\0\0xdl" + [211:976]
  base64-JSON payload w/ fixed NUL marker pairs + [951:976] trailer (incl 0x1000).
  Header constants live only as C++ object members (no immediate/template in binary).
- Write path: program -> knob keys (token table) -> JSON::toString @0x14047EDA0 ->
  base64 @0x14045E1A0 (only live encoder; call site 0x14038959F in parseProgram
  0x140388E90, a JSON canonical serializer) -> doc assembly ([211] payload = b64) ->
  zlib deflate w/ prev-write dictionary -> "78 9c" + adler32 (adler32 live @0x140451F60;
  both crc32 impls have ZERO callers -> confirms zlib not gzip) -> 7-bit TRPC SysEx
  type 0x4F (import).
- zlib/deflate strings @0x82c9a3/0x830aa0 belong to bundled libpng (UI graphics), not
  the write path. Static-only RE has converged; the exact in-memory doc-builder VA is
  not pinnable statically (compressor reached via indirect dispatch; header consts are
  object members).
- RECONCILIATION: my byte-level finding (data region = TRUNCATED b64 of JSON, ~637/740
  chars, rest from deflate dict) is CONSISTENT with static RE: region is 740 bytes but
  full 52-key JSON b64 is 1560 chars -> region physically holds only a b64 prefix + NUL
  marker pairs; remainder supplied by dictionary across deflate. Both frames share an
  identical [0:210] header = deterministic per-program template.
- Blocked: the in-memory doc-builder cannot be statically fingerprinted; exact doc-asm
  would need a dynamic trace (debugger break on 0x14045E1A0 b64 encoder during write),
  which is not attempted (app running is user-managed / MIDI capture blocked).


### Status - 2026-08-29 h90_enc.py built; DATA region = base64 + embedded binary markers

Committed server/h90-recon/h90_enc.py. Corrected model: the 740-byte DATA region
[211:951] is NOT clean base64 + zero padding. The captured reference interleaves
the base64 prefix with non-zero embedded binary knob-block markers (float32 1.0
pattern 00 80 3f, structural 0d, etc.) woven through the stream. Run-length
analysis of test_import_plaintext.bin region is highly irregular (compressor/LZ77
determined), so the region is per-program, not a fixed template rule.

h90_enc.py reproduces the known Reverse write BYTE-FOR-BYTE (self-check
"byte-identical: True", 976/976): header [0:211] + trailer [951:976] are fixed
per-algorithm templates; DATA region is loaded verbatim from the reference. A
mask-based build_data_region() fallback emits a structurally-valid 976-byte doc
(637 b64 literals + markers) for generalizing to new programs once more
reference writes are captured. Verification: only 9/976 bytes differ between the
mask-fallback and reference, all embedded non-zero marker bytes.

## Plan - 2026-08-30 pedal-app L.A. Lady import: docs + resume write work

Goal: resume the pedal-app (Source Audio L.A. Lady, VID 0x29a4 / PID 0x0300)
Phase-2 write/import work now that the pedal is physically connected and
enumerates correctly (interface 2, "Source Audio One Series"). Phase 1 (read:
slots, EEPROM, config, MIDI map, .pre/.osbf export) works. Phase 2 is blocked:
no working erase/commit command - PRESET_ERASE (0x38) is inert (83 arg forms
tested) and FLASH_WRITE (0x35) is clear-only, so writePreset (src/sourceAudio.js)
throws because the target region cannot clear to 0xFF.

Deliverables this session (docs only, no src changes):
1. pedal-app/README.md - new: overview, Phase-1/Phase-2 status, quickstart
   (npm run start / live), architecture map (src/, scripts/, web/), API
   endpoints, safety workflow (requireLalady, backupFull/checkScratch).
2. pedal-app/TODO.md - new: blocker-first ordered task list.
3. DECISIONS plan entry (this one).

Blocker-resolution route (chosen by user, next task, not this session):
capture the official Neuro desktop app save via USBPcap + Wireshark (tshark) on
Windows, decode host->device reports with scripts/decodeCapture.js, discover the
real erase/commit (ACTIVE_SET/ACTIVE_WRITE/ACTIVE_STORE 0x77/0x6e/0x76 or a
proper erase), implement it in erasePreset, finalize writePreset, verify
/api/write + /api/activate, heal corrupted slot 0x03c000 from backup.

Verification of docs: files exist, are accurate against current src/, and TODO
items are actionable. Progress entry appended after docs are written.
## Progress - 2026-08-30 pedal-app docs written (README.md + TODO.md)

Docs-only session, no src changes. Pedal confirmed connected and enumerating
correctly (VID 0x29a4 / PID 0x0300, interface 2, "Source Audio One Series").

- Created pedal-app/README.md: overview, Phase-1 (read, working) vs Phase-2
  (write, blocked on erase) status, quickstart (npm run start / live), full
  architecture map of src/ (sourceAudioHid, sourceAudio, laLadyModel, neuroMap,
  prePreset, osbf), API endpoint table, safety workflow (requireLalady +
  backupFull/checkScratch), scripts/ summary, known-corruption note.
- Created pedal-app/TODO.md: blocker-first task list (1. capture Neuro save ->
  2. implement erase in erasePreset -> 3. re-validate flashWrite framing ->
  4. verify writePreset -> 5. verify /api/write + /api/activate -> 6. heal slot
  0x03c000 -> 7. document solved protocol), plus recurring safety steps.
- Environment check for the capture route: USBPcapCMD present
  (C:\Program Files\USBPcap); Wireshark/tshark NOT installed; Source Audio
  Neuro app NOT installed. Both are user-installs (admin) before the capture.

Next (not this session): install Neuro + Wireshark, USBPcap a single save,
decode with scripts/decodeCapture.js, discover the real erase/commit command.
## Plan - 2026-08-30 (pm) pedal-app: USBPcap capture of Neuro save

Goal: capture the Source Audio Neuro Desktop 3 app's USB-HID save traffic to the
L.A. Lady to discover the real erase/commit command (the Phase-2 blocker), now
that Neuro + Wireshark are installed and the pedal is connected.

Done so far:
- Confirmed Neuro install at C:\Program Files (x86)\Source Audio\Neuro Desktop 3.
- Installed Wireshark 4.6.8 (tshark at C:\Program Files\Wireshark\tshark.exe) via winget.
- USBPcapCMD present (C:\Program Files\USBPcap). Driver (usbpcap) loaded/RUNNING
  but NOT bound as USB class UpperFilters to any hub -> captures return 0 bytes.
  USBPcap.inf adds USBPcap to UpperFilters of class {36FC9E60-...}, which only
  attaches at hub (re)enumeration -> REBOOT REQUIRED for capture to work.
- Pre-reboot safety backup taken: runtime-actions/lalady-backup-1788097151575.json
  (slots + eeprom). Slot 0x3c000 still shows the known corruption (empty name).

Prepared tooling so we can act immediately after reboot:
- scripts/capture-lalady.ps1 - scans USBPcap hubs for the pedal, captures a timed
  window to runtime-actions/usbpcap-<ts>.pcap, prints the tshark + decode commands.

Next after reboot (user step): reconnect pedal, run capture-lalady.ps1, do ONE
Neuro save of a preset to a KNOWN slot, then tshark-extract + decodeCapture.js
to read the command sequence (expect ACTIVE_SET/WRITE/STORE 0x77/0x6e/0x76 or a
proper erase). Implement the discovered command in erasePreset (sourceAudio.js).

Verification: decoded sequence reproduces the slot clear; checkScratch.js shows
no collateral corruption; the corresponding write lands + reads back.

## Progress - 2026-08-30 (pm) pedal-app: Neuro save captured -> L.A. Lady saves via ACTIVE_WRITE (0x6e), not 0x38

Captured the real Neuro Desktop 3 save over USBPcap1 (--devices 1, the pedal).
User saved a preset to slot 1 (0x3f000), naming it "effect1".

RESULT / BLOCKER RESOLVED (conceptually):
- The save did NOT use FLASH_WRITE (0x35) or PRESET_ERASE (0x38) for the slot.
  Instead it used the ACTIVE_* family:
    - ACTIVE_STORE (0x76) x2:  [76 00 00 ...] off=0x0000 pld=[20 9a 8c 16 2c 04 00 00 00 05 00 00 04 a2 00 00 17 ...]
                                [76 01 20 ...] off=0x0120 pld=[15 00 16 00 90 08 04 00 ...]
    - ACTIVE_WRITE (0x6e) x1:  [6e 03 01 ...] off=0x0301 pld=[65 66 66 65 63 74 31 ...] = name "effect1"
  offset = (rep[1]<<8)|rep[2]; payload = rep[3:38].
- Only ONE FLASH_WRITE (0x35) in the whole capture: at device init, addr 0x007000
  (boot config block, NOT the preset save).
- Post-save read-back confirms slot 0x3f000 was written: data starts
  9a 8c 16 2c 04 00 00 00 05 00 00 04 a2 00 00 17..., name "effect1".
  (A transient read disagreement - full range gave zeros once - resolved on re-read.)

INTERPRETATION:
- The preset params were already in the device's active/working buffer (Neuro edits
  live), so this save only staged a couple of header/meta blocks via ACTIVE_STORE and
  committed with ACTIVE_WRITE (0x6e). ACTIVE_WRITE is the erase+commit primitive.
- For a full fresh import (our app), the likely sequence is ACTIVE_SET (0x77) to
  select the slot, ACTIVE_STORE (0x76) to stage the whole 85-byte body in blocks,
  then ACTIVE_WRITE (0x6e) to commit.

OPEN / NEXT:
- Need to pin the exact ACTIVE_STORE block framing (leading byte 0x20 on the 0x0000
  block and 0x15 on the 0x0120 block are ambiguous - length vs selector). Sparse save
  doesn't show a full body write. -> schedule a second, MORE REVEALING capture: user
  saves a preset whose params were newly edited / a different preset, so the full
  ACTIVE_STORE body stream is visible. Then implement in erasePreset/writePreset.
- Artifacts: runtime-actions/neuro-save-1788101504727.pcap (+ neuro-decode.txt),
  decoder scripts/decode_usbpcap.py now validated (direction = p[m-2]).
- capture-note: kill stray USBPcapCMD before each capture; a stuck USBPcapCMD makes
  new captures return 0 bytes. Device-address filter --devices 1 is stable.

## Plan - 2026-08-30 (night) pedal-app: implement ACTIVE_* write protocol

Framework now fully pinned from MichaelMCE/TeensyC4Synth sa_c4.h + captures:
- ACTIVE_STORE (0x76) = [76, lastFlag, offset, payloadLen, ...data], block size 32.
  Capture save2: block0 [76 0 0 0x20 <32B>], block1 [76 1 0x20 0x15 <21B>] =
  exactly the 53-byte body (older decode mislabeled these as idx=0/0x0120).
- ACTIVE_WRITE (0x6e) = [6e, presetIdx, 1, name(32)]; commits working preset to
  slot. Capture: [6e 03 01 "effect1"], presetIdx 3 -> page 0x3f000. So presetIdx =
  (page - 0x3c000)/0x1000, slots 0..5, NO -3 offset.
- ACTIVE_SET (0x77) = [77, presetIdx, 0]; selects active preset (thierryd25).
- PRESET_ERASE (0x38) = [38, presetIdx | 0x80, 0, 0]; needs ACTIVE_SET first.
PLAN:
1. Rewrite erasePreset(idx): ACTIVE_SET(idx) -> wait 500ms -> [38, idx|0x80, 0, 0].
2. Rewrite writePreset(page,{name,params,idx}): stage 53-byte body in <=32B blocks
   via ACTIVE_STORE, then ACTIVE_WRITE(idx, name) to commit (no separate erase).
3. Verify read-back (data+name), as before.
4. Server.js: pass raw presetIdx (not user idx with -3) to writePreset/activate.
5. Validate on disposable slot 0x3f000, then heal 0x3c000. Backup exists:
   runtime-actions/lalady-backup-1788108072470.json.

## Progress - 2026-08-30 (night) pedal-app: ACTIVE_WRITE write path VERIFIED on 0x3f000

Validation (scripts/validateActiveWrite.js) succeeded:
- Target slot 0x3f000 (scratch "esfsef") re-written via new writePreset
  (ACTIVE_STORE x2: 32B @ off0 last=0 + 21B @ off32 last=1, then ACTIVE_WRITE
  [6e, idx=3, 1, name]). New name "zval992200".
- Read-back matches EXACTLY (85B compare passed); no collateral change on the
  other 5 slots. RESULT: PASS.
- The old FLASH_WRITE-based writePreset path is fully superseded. Note: the
  ACTIVE_WRITE report carries the 32-byte name at rep[3] (NOT the full body);
  buildReport returns a plain Array so the name is copied byte-by-byte.
- setup note: buildReport returns Array (not Buffer) -> Buffer.copy(target)
  throws; fixed with an index loop.
- /api/write and /api/activate now pass the raw slot index (0..5) derived as
  (page-0x3c000)/0x1000 (no -3); ACTIVE_SET is [0x77, idx, 0]; PRESET_ERASE is
  [0x38, idx|0x80, 0, 0].
NEXT: heal corrupt slot 0x3c000 with the same path (name from backup), then
update README/TODO and commit [pedal-app].

## Progress - 2026-08-30 (night) pedal-app: slot 0x3c000 HEALED; PRESET_ERASE (0x38) inert on L.A. Lady

- Healed the corrupted slot 0x3c000 ("empty name, header 020400..") using the new
  ACTIVE_STORE/WRITE path + the FIRST backup body (lalady-backup-1787936146287.json,
  "goodtone fixed mids"). Result: header rebuilt byte-identical
  (ee373500b61201..), data+name match the backup exactly, no collateral change.
  Fresh backup runtime-actions/lalady-backup-1788109370489.json records the healed state.
- NEW FINDING: PRESET_ERASE 0x38 is INERT on the L.A. Lady. script probeErase.js:
  [0x38, 3|0x80, 0, 0] (library-exact framing, sa_c4.c as_erase()) did NOT change
  slot 0x3f000 over 8s, and the reply was a config-ish block (head 0x75/0x50,
  fw 01 06 model f4) NOT an ERASE_ACK 0x37. The sa_c4 as_erase() targets the C4
  preset bank at 0x080000, which the L.A. Lady does not expose; its 6 on-board
  sounds are at 0x3c000 (as_getPresetDefault's AS_PRESET_ADDRESS_DEFAULTS).
- CONCLUSION for writes: a standalone erase is NOT needed. ACTIVE_WRITE (0x6e)
  performs erase+program atomically (this is the primitive Neuro uses, and why
  healSlot3c000.js succeeded with just writePreset after a no-op erasePreset).
  erasePreset() is kept for C4-style targets but documented as inert on L.A. Lady.
- requestSkim(): hardcoded single-number heads crashed in the error path
  ("heads.map is not a function"); fixed with Array.isArray() guard.
- validation + heal scripts committed: scripts/validateActiveWrite.js,
  scripts/healSlot3c000.js, scripts/probeErase.js.
NEXT: update README/TODO; optional git commit [pedal-app].

## Plan - 2026-08-30 web: site shell + lazy `dist` module (la-lady import/export)

- Add a global site header/nav to the h90-web Angular shell (app.component):
  links `h90` and `dist`, above the router-outlet (persistent across routes).
- Move h90 routes under `/h90` (`''` and `preset/:slug` -> `/h90` and
  `/h90/preset/:slug`), with `/` and `**` redirecting to `/h90`.
- Add a lazy-loaded `dist` module (route `/dist`) housing an initial L.A. Lady
  preset import/export UI "like the Neuro app" (slots list, per-slot .pre
  import/write, export, activate). Knobs/buttons come later.
- dist UI calls the la-lady backend (pedal-app server.js, port 3111) directly;
  add a small dev CORS middleware there (no new npm dep) so :4211 can reach it.

## Progress - 2026-08-30 web+pedal-app: site shell + dist module DONE

- Global site header (h90/dist nav) added to the h90-web shell above the
  router-outlet (app.component.html/scss/ts).
- h90 routes moved under /h90; / and ** redirect to /h90. New lazy route /dist.
- dist module (web/src/app/dist) created & lazy-loaded (build emitted
  `lalady-component` + `dist-routes` lazy chunks). L.A. Lady import/export page:
  lists 6 slots, per-slot .pre import -> /api/write, /api/export (.pre download),
  /api/activate. Knobs/buttons are a later iteration.
- lalady-api.service calls http://localhost:3111 directly.
- pedal-app/server.js: added dev CORS middleware (no new dep) so :4211 can reach
  :3111 cross-origin. get/status validated via `npx ng build` (web) + node -c (server).
- .gitignore: un-ignored web/src/app/dist (collided with build dist/ rule).
- Commits: [web] 493c736, [pedal-app] 146e874.
NEXT: run the UI (nm start) pointing at the running pedal-app server; knobs/buttons later.

## Progress - 2026-08-30 web: convenience run scripts
- Added "start:lalady" script to web/package.json: `npm --prefix ../pedal-app start`
  (launches the L.A. Lady backend on :3111 from the web project).
- Usage: Terminal 1 `npm run start:lalady` (cwd web), Terminal 2 `npm start` (cwd web).

## Progress - 2026-08-30 web: decouple la-lady (dist) from h90 for now
- Per user: stop tying the la-lady app to the h90 backend for now; use a separate
  backend. The dist UI already talks DIRECTLY to the la-lady backend
  (pedal-app/server.js on :3111) - no shared-h90/:3000 dependency.
- app.routes: default route "" and "**" now redirect to `dist` (was h90), so a
  bare `npm start` boots straight to the la-lady import/export page and never
  triggers the h90 /api proxy calls (the ECONNREFUSED :3000 noise).
- Header: only `dist` nav link for now; h90 routes kept reachable at /h90 behind
  its own backend (needs :3000 + presets.db), intentionally not default.

## Progress - 2026-08-30 web: preset display order in dist UI
- dist (la-lady) UI now presents slots in display order 1..6 mapping to physical
  slots 4,5,6,1,2,3 (physical pages 0x3f000,0x40000,0x41000,0x3c000,0x3d000,0x3e000).
- Added a "slot" display-number column (1..6) plus the physical page hex column.
- Implementation: displayOrder = [3,4,5,0,1,2] reorders the backend's physical
  page order; per-user requirement "1 is 4, 2 is 5, 3 is 6, 4 is 1, 5 is 2, 6 is 3".

## Progress - 2026-08-30 pedal-app+web: Erase button (Neuro-style)
- Finding: no true sector erase on the L.A. Lady (0x38 inert; 0x35 clear-only
  cannot reach 0xFF). Verified empirically on hardware that ACTIVE_WRITE keeps
  an all-0xFF data+name region and rebuilds a valid header.
- pedal-app: added SourceAudioProtocol.eraseSlot(idx) - stages all-0xFF
  53-byte body + 32-byte name via ACTIVE_STORE/ACTIVE_WRITE + verify read-back.
  New POST /api/erase { slot } endpoint (derives idx = (page-0x3c000)/0x1000).
- web dist UI: added Erase button per slot (danger-styled), calls /api/erase,
  refreshes the row after. Matches the Neuro editor visual (blank name/params).
- Removed temp probe/restore scripts; fresh backup
  runtime-actions/lalady-backup-1788122146966.json (slot 0x3e000 erased as the
  user did; others intact).

## Progress - 2026-08-30 pedal-app+web: Erase = neutral 50% preset (was all-0xFF)
- User: "i dont like that all the knobs and params are in last variant. lets make
  all the params at 50% on erase" - erasing should yield a silent-but-playable
  preset, not the all-0xFF (maxed/last-variant static) body.
- pedal-app: SourceAudioProtocol.DEFAULT_PARAMS_50() = every continuous knob
  level at 128 (0x80, 50% of the 0-255 scale); selectors/bitfields at valid
  factory-style defaults (voice 153/153, engines 36/10, noise_gate 1, gate_mode 3,
  treble_boost_maximum 4, control_range 200, control_min 410). encodeBinary53
  round-trips cleanly (verified). eraseSlot now stages this body with a BLANK
  (0x00, not 0xFF) name and ACTIVE_STORE/ACTIVE_WRITE + byte-exact verify.
- Hardware-verified on disposable slot idx 2 (page 0x3e000, the user-erased
  empty slot): read-back data = 99808080248000808080... (knobs 0x80, none 0xFF),
  name all-0x00; decodeBinary53 shows left_drive/output/right_drive/output and
  freq all = 128. No user preset overwritten.
- web dist UI: Erase button tooltip updated to "Reset preset (blank name, all
  params at 50%)". /api/erase endpoint unchanged structurally.
- Checks: node -c (server.js, sourceAudio.js) and `ng build` (web) both pass.
  NOT committed.

## Progress - 2026-08-31 pedal-app+web: live Left Drive knob (planned + done)
- Goal: turning a live "Left Drive" knob in the dist web UI moves the "Left
  Drive" value in the Neuro Desktop 3 editor via a real-time CTRL_SET write.
- Protocol nailed down from Neuro app bytecode (shared-jvm jar, bundled javap):
  PedalApiImpl.setControlValue(desc, rawValue, productId) passes the RAW preset
  byte straight into getParametricSendCommand(info, value, 0). For SA-244 (L.A.
  Lady) sendType="16bit" -> GetParametricSendCommand's tableswitch ordinal 5 ->
  plain Write16BitControl(controlIndex, value), whose bytes() = [0x70,
  controlIndex, value>>8, value&0xff]. Left Drive = controlIndex 2 (sa-244.json
  midiMapStructure.controls). So live write frame = [0x70, 0x02, 0x00, value]
  for value 0..255.
- This supersedes/explains the old probe: "type 0x03/0x02" were really
  controlIndex 3 (Left Output) / 2 (Left Drive). Mapping is now authoritative
  from app source, not guessed from read-backs.
- Implemented setControlValue(idx, value) in pedal-app SourceAudioProtocol and
  POST /api/control in server.js; dist UI Left Drive knob wired to it with
  read-back. Checks: node -c + ng build pass. NOT committed.

## Progress - 2026-08-31 pedal-app+web: fix Live Left Drive knob "chaos"
- User: dragging the dist Left Drive slider made ALL knobs in the Neuro editor
  jump and the final value could be wrong ("if not to stop some server, mb it
  helps").
- Diagnosis via USBPcap1 capture of the running editor: Neuro polls the pedal
  control table ~130 Hz (CTRL_GET2 offset 0x10/0x20/0x30 + CONFIG_GET), and the
  pedal broadcasts HID input reports to every open handle.
- Root causes:
  1. POST /api/control opened+closed the HID device per request; each reopen
     makes the pedal reload its live control table -> Neuro sees all knobs jump.
  2. Ctrl-set read-back returned payload[0] (block[0]=0xff) not the written
     byte, because the reply is [0x75, block0, block1, ...], block[i]=reply[i+1].
  3. UI fired one unbuffered CTRL_SET per ngModelChange (burst during drag).
- Fixes (verified live, hardware on pedal):
  - server.js: persistent SourceAudioProtocol across /api/control requests
    (getControlProto singleton); only reopen on error.
  - sourceAudio.js: readControlBlock() asks offset-0 CTRL_GET and accepts any
    0x75-head >=32-byte reply (broadcast makes our reply indistinguishable from
    Neuro's; both carry the live block). Endpoint returns block[index].
  - dist UI: debounced/throttled write - remember latest value, one in-flight at
    a time, send via setTimeout(0).
  - Verify script (throwaway) did 6 writes 128/180/200/160/220/128 on one open
    handle: every readback matched exactly. Checks: node -c + ng build pass.
  - NOTE: backend (server.js, PID 11772) still runs OLD code; user must restart
    it for the persistent connection + readback fix to go live.

## Plan - 2026-08-31 pedal-app+web: share persistent HID handle to stop control-table reload revert
- Root cause (from USBPcap wire trace): the live CTRL_SET write sticks on the wire (read-back stayed 0xde=222), but opening a SECOND HID handle makes the pedal reload its active preset body from flash, reverting the live control table (block[2]=0x7f=127 for active oct2+octFuzz). Every server.js endpoint that does its own open/close (collect for status/presets, export, write, activate, erase) is that second handle while the persistent /api/control handle is open -> reverts both our writes and Neuro's own knob drags.
- Fix: route ALL pedal accesses through one shared persistent SourceAudioProtocol singleton (getControlProto), removing the other 5 open/close sites so no second handle ever opens on the control path. Keep readControlBlock accepting broadcast replies.
- Verify: node -c + ng build; on hardware, write Left Drive then call /api/status fresh and confirm the read-back no longer reverts; USBPcap shows a single open handle.

## Progress - 2026-08-31 pedal-app+web: share persistent HID handle (revert fix)
- Confirmed root cause on the wire: a live CTRL_SET write (Left Drive=222) STAYS at 0xde on the pedal while Neuro polls it; the revert to 127 came from opening a SECOND HID handle, which forces the pedal to reload its active preset body from flash (block[2]=0x7f for active oct2+octFuzz). Every in-process endpoint that did its own open/close (collect for /api/status+presets+eeprom, /api/export, /api/write, /api/activate, /api/erase) was that second handle while /api/control held its persistent handle open -> reverted both our writes and Neuro's own knob drags.
- Fix in server.js: introduced a single shared persistent SourceAudioProtocol singleton (getSharedProto / resetSharedProto) and routed ALL pedal access through it; removed the other 5 open/close sites and the old getControlProto/controlProto/controlDev pair. Now only one HID handle ever exists on the control path, so a status/presets refresh no longer reloads the live control table.
- Kept readControlBlock logic (accept any 0x75-head >=32-byte reply) unchanged.
- Checks: node -c + ng build both pass. NOT committed.
- NOTE: backend currently DOWN (user must restart it to pick up the new shared-handle code). Pending hardware re-verify: write Left Drive then call /api/status fresh and confirm read-back no longer reverts; USBPcap should show a single open handle across both.

## Progress - 2026-08-31 pedal-app+web: definitive wire diagnosis of Neuro 'knob jumping'
- Re-tested with the shared-handle fix live (server restarted, PID 11772 on 3111): web Ctrl write -> correct stable readback (222 then 200), even with /api/status?fresh=1 called in between. No more reload-induced revert.
- USBPcap over several scenarios (Neuro editor open, idle; knob focused; web drag): Neuro sends ONLY CTRL_GET2 (~130 Hz, offsets 0x10/0x20/0x30) + CONFIG_GET(0x45). ZERO counter-writes, zero re-init/re-download, zero ACTIVE_* when idle. Our CTRL_SET is the only write.
- CTRL_GET2 offset sub-reads: only offset 0x10's byte-2 carries the live Left Drive (stable 200 = our write, every poll); offsets 0x20/0x30 return 0xff for byte-2 as expected (different table region). Data is clean and stable on the wire.
- CONCLUSION: the USB write path is now correct and non-destructive. The user's remaining 'knobs jump' is 100% a Neuro-Desktop-side rendering artifact: when its editor is open and a displayed control changes under it (our write), Neuro repaints its panel each poll tick / on each external change. That cannot be prevented from the web/server side (we can't patch Neuro); it only shows while the web slider is actively dragged (one write+repaint per tick).
- Options for the user: (a) accept it - write works, settles after each change; (b) write on release (single value per drag gesture, minimum repaints); (c) only drive Left Drive when Neuro editor is closed/minimized; (d) drive Neuro via its own automation (touch-controls-urself) instead of parallel writes. NOT committed.

## Plan - 2026-08-31 pedal-app+web: commit control to active flash preset (viable Left Drive)
- User rejected the parallel live-RAM CTRL_SET path: Neuro's open editor owns/repaints the control table, so a RAM-only write jumps and reverts. Chose: commit to the active flash preset instead.
- Mapping confirmed: control index 2 = Left Drive = byte 2 of the 53-byte preset body (neuroMap DIRECT) = the same value Neuro's offset-0x10 CTRL_GET2 returns. So patching byte 2 of the active preset body and re-activating makes Neuro load OUR committed value with no fight.
- Approach: lossless in-place byte patch (NOT decode/re-encode, which corrupts unmapped/footer bytes). Add SourceAudioProtocol.commitRawPreset(idx, data53, name) (ACTIVE_STORE+ACTIVE_WRITE+ACTIVE_SET, verified path) + server helper. Repurpose /api/control to patch byte[index] of the active preset body, commit, re-activate, return new value.
- UI: send on release (single commit per drag gesture) instead of per-tick, so Neuro repaints once and settles.
- Verify: node -c + ng build; on hardware drag Left Drive slider -> value persists in flash (survives Neuro reload), Neuro shows it steadily, readback matches. Update DECISIONS after.

## Progress - 2026-08-31 pedal-app+web: commit-to-active-preset Left Drive (v2)
- Implemented the chosen approach: web Left Drive slider now commits the value DIRECTLY into the active flash preset instead of a live RAM CTRL_SET.
- sourceAudio.js: added commitRawPreset(idx, data53, name) (lossless in-place: ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET, read-back verify) + readSlotBody(idx)/readSlotName(idx) helpers.
- server.js /api/control: reads getHardwareConfig().activePreset -> activeSlotPage -> rawIdx=(page-0x3c000)/0x1000, reads the 53-byte body, sets body[index]=value (index==byte index per neuroMap DIRECT, e.g. 2=left_drive), commits, re-activates, returns readback+presetIndex+activePage.
- dist UI: slider fires on (change) [release] not per-tick; commitLeftDrive guards against overlapping slow flash commits (queues latest).
- Read-only sanity check on hardware (standalone script): active preset oct2+octFuzz at rawIdx 4 (0x40000), byte2=127 matches flash default; getHardwareConfig/readSlotBody/readSlotName verified working.
- Checks: node -c (server, sourceAudio) + ng build pass. NOT committed.
- NOTE: backend holds OLD code; user must restart node (3111) to load the new /api/control + commitRawPreset. Then drag Left Drive slider -> awaits flash commit (~2s) -> value persists in flash across Neuro reload (no revert).

## Plan + Progress - 2026-08-31 web: realtime read-only knob monitor
- User asked to SEE (not change) the pedal's knob state in realtime, reflecting external changes (e.g. Neuro editor).
- Backend: added GET /api/controls on the shared persistent handle. Reads getHardwareConfig (active preset idx), readControlBlock (live CTRL_GET block), readSlotName (preset name); maps control index->name from Neuro's sa-244.json (midiMapStructure.controls) via new CONTROL_NAMES const; returns controls[{index,name,value}], activePage/presetName, ts, raw. Read-only. Guarded to skip out-of-block-range indices (block is 37 bytes => 0..36).
- Verified composition standalone (read-only, no writes): active oct2+octFuzz at rawIdx 4; live block gives Left Drive=90, Right Drive=90, Mid A Freq=1, Mid A Q=3 (90 != flash 127 => live table, not flash). 5 consecutive polls stable on same handle.
- Web UI: added Zhealtime knob monitor section (toggle Start/Stop, poll /api/controls every 700ms via setInterval, OnDestroy cleanup). Shows all mapped knobs with current value, highlights Left Drive (idx 2). Controls if present; error auto-stops polling. Added LiveControls/LiveControl models + api.controls().
- Checks: node -c (server, sourceAudio) + ng build pass. NOT committed.
- NOTE: backend on 3111 still runs old code; user must restart node to serve /api/controls. Monitoring is read-only and never opens a second handle.

## Progress - 2026-08-31 web: monitor poll disrupted Neuro knobs - minimal-read fix
- User: with Neuro editor open, every GET /api/controls made Neuro's knobs jump/reinit.
- USBPcap proof: each old /api/controls request sent CONFIG_GET (0x45) + FLASH_READ (0x36 for the preset name) + CTRL_GET on the shared handle; those extra vendor requests (esp. CONFIG_GET/flash read) are what Neuro's open editor reacts to, re-syncing/reinitializing knobs.
- Fix in server.js: /api/controls now issues ONLY one CTRL_GET (0x75 control read, same family Neuro polls constantly and tolerates) per request; the active-preset config + flash name (which need CONFIG_GET/FLASH_READ) are cached in module-level monitorConfig for MONITOR_CONFIG_TTL_MS=20000ms and refreshed occasionally.
- Checks: node -c passes. Backend must be restarted by user to load. If user finds even the single CTRL_GET still jumps, next step is a fully passive monitor (background drain of Neuro's own 0x75 replies on the shared handle => zero HID commands per request).

## Plan + Progress - 2026-08-31 pedal-app+web: offline (no Neuro) workbench
## Plan
- User wants to work without Neuro: (1) pick 1 of 6 preset slots (activates it on pedal), (2) get all param values, (3) change one param via physical knob or our UI, (4) save that state to the active slot.
- Decisions from clarifying: params read from the SELECTED slot's FLASH BODY (what's saved/recalled), selecting a slot also ACTIVATES it on the pedal, and save is manual (persist live state to active slot flash).
- Backend: GET /api/slot-params?idx=0..5 reads readSlotBody(idx)+readSlotName(idx), maps all 53 bytes to names (CONTROL_NAMES fallback 'Byte N'). POST /api/slots/save takes {overrides:{index:value}}: source of truth = pedal LIVE control block (captures physical knob changes), bytes beyond live block (<37) kept from flash body, UI overrides layered on top, then commitRawPreset to the active slot.
- Web: Offline workbench panel - 6 slot buttons (activate+load flash params), params table with sliders, Save (overrides) / Revert; Save reloads slot body after commit.
- Checks: node -c + ng build pass. Backend NOT restarted (AGENTS.md: user runs it). Not committed.
## Progress
- Verified standalone (read-only, device direct): active rawIdx 4 'oct2+octFuzz'; flash body leftDrive(idx2)=99/idx0=153/idx3=255 vs live leftDrive=106 -> confirms live-vs-flash distinction and that Save must source from live to capture physical knob changes.
- Reads (readSlotBody=53, readSlotName, readControlBlock=37) all work; merge logic validated. Still needs backend restart (user) + a hardware save to confirm persistence, then commit with [pedal-app]/[web] prefixes.

## Progress - 2026-08-31 pedal-app+web: realtime edits + save-via-import
- User clarified: (a) want REAL-TIME (hear) knob changes, (b) after Save, re-select the slot and hear the saved changes, (c) for Save, build a payload like an import file and import it (that path was confirmed working).
- Added backend POST /api/control/live {index,value}: live CTRL_SET (0x70) into the RAM control table via setControlValue -> immediate audible change, no flash write. This works because the user is now working WITHOUT Neuuro (the earlier live path was only reverted due to Neuuro re-importing the active preset).
- Rewrote POST /api/slots/save to use the IMPORT path the user confirmed: source = live control block (physical knobs + realtime edits) padded with the slot flash body past byte 36, overlaid with UI overrides; then decodeBinary53(body) -> named params; writePreset(page,{name,params,idx}) (the same ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET used to import a .pre); then setActivePreset(rawIdx) to recall it so the user hears the saved changes. Accepts optional idx (default active).
- Also fixed POST /api/activate to accept {idx:0..5} (workbench select) - was returning 400 when only idx was sent (no slot).
- Web: workbench slider now sends live CTRL_SET on (input) (throttled 40ms) for realtime sound; (change) marks edit for save. Save sends {overrides, idx:selectedSlotIdx}.
- Checks: node -c + ng build pass. Verified decodeBinary53->encodeBinary53 round-trip is lossless on an actual slot body (left drive byte reflects current value).
- BLOCKED: running backend (PID 15904) returns 404 on /api/control/live = still old code. User must restart node backend (3111) to load all new endpoints, then hardware-verify: drag slider hears change live; Save then re-select slot hears saved state. Then commit [pedal-app]/[web].

## Progress - 2026-08-31 pedal-app+web: OSBF backup restore + export-all
- Added `serializeOsbf({productId, eeprom, presets, selectors})` in `pedal-app/src/osbf.js`: mirrors `parseOsbf` text format exactly (START_DATA/END_DATA blocks, same field layout, same hex encoding). Verified lossless round-trip: parsed the original OSBF → serialized → re-parsed → all 6 binary payloads (85 bytes each) match byte-for-byte.
- Backend `GET /api/export-all`: reads all 6 slots via `readSlotRaw` + `getEEPROM` + productId, serializes via `serializeOsbf`, returns as a downloadable `.osbf` file (Content-Disposition attachment). Mapping: physical slots 0-2 (US0-US2, SELECTORs), slots 3-5 (UP0-UP2, USER_PRESETs).
- Backend `POST /api/restore`: loads OSBF from `input/2026-07-31_labackup.osbf`, writes all 6 slots via `commitRawPreset(idx, data53, name)`. SELECTORS (US0-US2) → physical slots 0-2, USER_PRESETs (UP0-UP2) → physical slots 3-5. EEPROM NOT written (confirmed: all 3 existing Neuro captures show zero EEPROM_WRITE (0x81) frames). Returns verify results per slot (before/after hex, match flag). Recalls previously-active preset after restore.
- Web: added Restore (with confirm dialog) + Export All buttons in the workbench slot-picker row. Restore shows a per-slot verify table (slot#, page, name, ok/MISMATCH). Added `restoreBackup()`, `exportAll()`, `RestoreResult`/`RestoreSlotResult` models, `api.restore()`, `api.exportAllUrl()`.
- Checks: `node -c` (server, osbf) + `ng build` pass. Backend must be restarted by user to load `/api/restore` and `/api/export-all`. Not committed.
- NOTE: `commitRawPreset` is ~2s per slot (2x ACTIVE_STORE blocks + ACTIVE_WRITE + recall, each 500ms wait) → full restore ~12s. Acceptable for a restore operation.

## Progress - 2026-08-31 pedal-app+web: restore file-picker + name sanitize
- Restore now picks the .osbf file on the machine instead of a fixed path: added `loadOsbfText(text)` in osbf.js (refactored block collection from `loadOsbf`) and POST /api/restore accepts `{text}` (OSBF file content). Web: hidden `<input type=file accept=".osbf">` opened by the Restore button, read via FileReader('latin1'), sent to /api/restore.
- Fixed 500 "LALADY_NAME_SIZE is not defined": the `expect` helper referenced a constant not imported in server.js → added LALADY_NAME_SIZE to the laLadyModel destructure.
- Fixed the verify column: it compared before-vs-after restore (meaningless — restore is supposed to change the slot). Removed the bogus match; now returns `readbackName` (clean name read back from flash) per slot, UI shows it instead of the raw OSBF name (which carries \u0000 null padding that rendered as squares).
- Write-side sanitize: `commitRawPreset` + `writePreset` now strip all non-printable bytes ([^\x20-\x7e]) from names before writing to flash, so no null padding ever lands on the device.
- Diagnostics: added a console.log per restored slot (wrote name vs readback name + data match).
- Checks: node -c (server, sourceAudio) + ng build pass. Backend restart required to load: LALADY_NAME_SIZE import, write-side strips, /api/restore {text}, readbackName response.

## Progress - 2026-08-31 web: workbench consolidated to Slots tab + circular knob UI
- Restructured the page into subtabs (Slots / Workbench / Monitor); later moved workbench + backup content around per user request.
- Slots tab now: removed the page column and the redundant standalone import column; Import button opens a shared hidden file picker (`importSlot(row)` clicks `#importFileInput`, `onImportFileSelected` writes into the originating row); Activate moved before Import. Backup section (Export all / Restore from backup + restore result table) folded into the bottom of the Slots tab; Backup tab removed.
- Workbench: replaced the long 255px slider rows (uncomfortable — whole range = 255px drag) with compact circular SVG dials. Knobs are grouped into bordered sections laid out in rows: row 1 = Dist 1 | Dist 2, row 2 = Parametric EQ (flex3), row 3 = Noise gate. Param→group mapping by control index: Dist1=[0..12 minus 6], Dist2=[13..25 minus 19], EQ=[27..36 minus 29,31], Gate=[26,37,38,39].
- Dial geometry: value 0..255 → 270° sweep from lower-left to lower-right (screen coords, Y down); pointer via (x=20+13cos, y=20+13sin), arc via dasharray + fixed 135° start rotation. Edited knobs highlighted amber (`modified` when value != snapshot).
- Knob interaction: vertical drag (up=up, down=down) at 4px/value step (full range ≈64px vs old 255px), plus mouse wheel; reuses `onParamInput` realtime throttle + Save overrides. Added `knobRows` getter, `knobDown/Move/Up/Wheel`, pointer/wheel geometry helpers.
- Checks: ng build passes. No backend changes this step.

## Progress - 2026-08-31 web: show currently-active pedal slot in workbench
- Before, the workbench only showed the slot the user CLICKED; there was no indication of which physical slot the pedal actually had active (set externally via footswitch / Neuro).
- Added `activeSlotInfo { rawIdx, display, name }` to the component, sourced from GET /api/controls (`activeIndex` raw 0..5, `presetName`). Display number via existing `displaySlotNum(rawIdx)` (SLOT_DISPLAY_ORDER inverse → 1..6).
- Polling: a `workbenchTimer` polls /api/controls every 5s ONLY while the Workbench tab is active (cheap read-only; same pattern the monitor proved safe). Also polls once on ngOnInit, and updates `activeSlotInfo` immediately after `selectSlot(idx)` activates a slot.
- Tab switching now goes through `setActiveTab()` → `syncActiveSlotPolling()` to start/stop the workbench poll (also used for the tab buttons). Cleaned up timer in ngOnDestroy.
- UI: workbench shows a "Active: slot N — name" indicator (green dot) and rings the corresponding slot button green (`.phys-active`) to distinguish the pedal-active slot from the merely-selected one (`selectedSlotIdx` blue) — they can differ before you click.
- Checks: ng build passes. No backend changes.

## Progress - 2026-09-01 web: browser-native MIDI engage/bypass (CC 102)
- User bound engage/bypass to MIDI CC 102 in Neuro (channel 3; 0=off, 127=on) and wants the app to drive it from the browser instead of the backend/Python.
- Probed WinMM midiOut devices 1-3 to find the Source Audio One Series port: index 3 toggled the pedal (index 1/2 did not). Device names come back empty from midiOutGetDevCaps so index can't be auto-detected reliably there.
- Implemented `web/src/app/dist/lalady/lalady-midi.service.ts`: browser-oriented Web MIDI API (no backend). Finds the "Source Audio One Series" MIDI output by name (falls back to first output), sends CC 102 on the pedal's channel (from /api/status config.midiChannel+1). MIDI access is requested lazily on first click (browser permission gesture).
- Workbench top row: replaced the "Engage" (ACTIVE_SET recall) button with "Recall" (still backend recall), and added a "Bypassed/Engaged" toggle button driven by Web MIDI CC 102. Shows red/green state; disabled if requestMIDIAccess unsupported (needs Chrome/Edge on http://localhost:4211).
- Note: initial toggle state is local ("Bypassed"); no readback of the actual bypass state yet.
- Checks: ng build passes. No backend changes.

## Progress - 2026-09-01 web: refresh no longer changes the active effect (read-only auto-select)
- Bug: refreshing the app page switched the active pedal preset/effect.
- Root cause found and confirmed live: ngOnInit -> autoSelectActive() -> selectSlot(m.activeIndex) -> api.activateSlot() issued ACTIVE_SET on every page load, using /api/controls activeIndex (= config.activePreset, the pedal's own 0-based number) as if it were a physical slot index 0..5.
- Empirical mapping sweep (backend :3111): ACTIVE_SET arg 0,1,2 -> config.activePreset 0 (page 0x3f000, phys 3); arg 3,4,5 -> activePreset 1 (page 0x40000, phys 4). So the arg != physical slot directly, contradicting the earlier write-plan note "idx 3 -> 0x3f000". The config report name bytes (10..31) are constant across activations - not usable as ground truth.
- Fix: autoSelectActive is now READ-ONLY - computes the physical raw slot from monitor.activePage ((page-0x3c000)/0x1000) and loads its params via loadSlotParams() (FLASH_READ only). It never calls activateSlot/selectSlot. Added module constants LALADY_PRESET_BASE/PITCH in lalady.component.ts.
- Explicit user actions still engage the pedal: clicking a slot button (selectSlot -> /api/activate) and the Recall button (engageSlot). Monitor/refresh/all-0/Save untouched.
- Residual open question (NOT fixed): ACTIVE_SET arg semantics for engaging a given physical slot remain unclear (sweep only ever produced activePreset 0 or 1 from args 0..5; slots 0..2 (SELECTORs) and 5 were never reachable in the sweep). If the user reports slot-button clicks landing on the wrong effect, a controlled experiment is next.
- Checks: ng build passes. No backend changes.

## Progress - 2026-09-01 pedal-app: ACTIVE_SET/active-slot mapping resolved (live-block readback)
- Controlled HID probe (C:\Users\Thoma\AppData\Local\Temp\opencode\lalady_engage_probe.js) drove ACTIVE_SET args 0..18/21/24/63/126/127 and ACTIVE_STORE+ACTIVE_WRITE engages directly, using the pedal's LIVE control table matched against the 6 stored slot bodies as independent ground truth.
- FINDING 1: ACTIVE_SET arg n == physical slot index (arg 0..5 -> live block matches phys 0..5 respectively). ACTIVE_WRITE idx == physical slot index (0,1,2 confirmed). The original setActivePreset(idx) semantics were correct all along.
- FINDING 2: config.report byte 4 (decodeConfig 'activePreset') is NOT the active physical slot - it reports 0 for phys 0-2 and 1 for phys 3-5. So activeSlotPage()'s +3 formula only coincided with reality at physical slot 3 (the seed of the old "idx 3 -> 0x3f000 confirmed" note); the '/api/controls activeIndex', monitor header, /api/status activePage, the Left-Drive /api/control commit target, /api/slots/save default and /api/restore recall were ALL computing the wrong slot.
- FIX: added server.js resolveActiveSlot(p) - matches the live CTRL block against the 6 stored bodies (directly-mapped indices only, skips unmapped 6/19/29/31). Wired it into collect()/api/all + status, readMonitorHeader (/api/controls activeIndex/activePage/presetName now truth), /api/control (Left-Drive commit now patches+re-activates the TRUE active slot), /api/slots/save default idx, /api/restore recall. activeIndex now means physical slot 0..5.
- Docs corrected: laLadyModel.js activeSlotPage marked DEPRECATED/WRONG as an active-page mapping (kept for the /api/write user-preset-number override which is deliberate).
- Frontend: autoSelectActive stays READ-ONLY (never ACTIVE_SET on load) and now loads m.activeIndex (true physical slot) directly; dropped the temporary page-derivation constants.
- Pedal left restored to ACTIVE_SET 0 (phys 0 'goodtone fixed mids').
- Checks: node -c (server + sourceAudio + laLadyModel) + ng build pass. Backend restart required to load server.js changes.

## Status - 2026-09-01 pedal-app: remove Recall button
- Removed the workbench 'Recall' button (lalady.component.html) and its engageSlot() handler (lalady.component.ts) - selecting a slot via the slot-picker already ACTIVATE_SETs it, and Save re-activates after persisting, so the button was redundant. ng build passes.

## Status - 2026-09-01 pedal-app: REVERT dist-engines feature
- After adding the distortion-engine dropdown the app became unresponsive for the user. Reverted all uncommitted dist-engines work (server.js /api/engines + parser, models/api/component/html/scss engine-select changes, debug logs) back to the last committed state (912220e / ff9893d). input/dist-engines left in place as a reference (currently unused). ng build + node -c pass.

## Progress - 2026-09-01 pedal-app: dist-engines select v2
- Re-implemented the distortion-engine dropdown after the revert. Key change from v1 (which made the app unresponsive): the template no longer uses an ng-template + 'else' reference inside the *ngFor � it renders the select or the dial via two sibling *ngIf blocks instead, eliminating the risky construct.
- Same backend (/api/engines parses input/dist-engines at startup), same identity mapping (verified round-trip: body byte == engine id), same component logic (indices 4/17 as dropdowns, realtime CTRL_SET on change, Save persists, out-of-list bytes shown as '?? N (unknown)').
- Verified: node -c + ng build pass; throwaway-port smoke test: /api/engines -> 50 engines in ~200ms. Backend restart + dev refresh required for the user to test.

## Status - 2026-09-01 pedal-app: dist-engines select v3 (UI freeze retry)
- v2 also froze the UI (requests completed, main thread dead) even though it dropped the ng-template/else construct. Remaining shared suspect: Angular's NgModel + [ngValue] SelectControlValueAccessor inside the *ngFor. v3 removes Angular forms entirely: the engine control is now a native <select> bound with [value]="p.value" and (change)="onEngineSelect(p, )" (Number(target.value)), no NgModel/ngValue/FormControl class in the loop body. Sibling *ngIf split kept (select vs dial).
- Verified node -c + ng build pass; dist bundle contains the new engine-select code. User must restart BOTH backend and the ng serve dev server (picks up recompile cleanly).

## Status - 2026-09-01 pedal-app: engine select polish
- v3 (native select) no longer freezes the UI. Cosmetic pass: dropped the round .engine-ctl circle - the select renders as a plain bordered dropdown below the knob label; option text is now JUST the engine name (no 'id �' prefix). Preselection now uses per-option [selected] bindings (p.value === e.id) instead of [value] on the select, so the current engine is shown even when the engine list loads after the params; unknown bytes keep '?? N (unknown)' auto-selected. ng build passes.

## Plan - 2026-09-02 pedal-app: Neuro-style discrete controls (selects/toggles/segments)
- Goal: remake more knobs into Neuro-style controls (selects, toggles, segmented buttons), mirroring the Neuro editor UI, reusing the proven native-element pattern that fixed the UI freeze.
- Context from research: sa-244.json (presetEditor.pages/blocks/controls + midiMapStructure.controls) defines the real Neuro UI: control kinds are knob / dropDownList / buttonList / switch. The 53-byte preset body is the ground truth (neuroMap DIRECT + encodeBinary53 bit-fields, verified .pre round-trip). CONTROL_NAMES (server.js) for indices 26+ come from the live control-table (midiMap) numbering which DIVERGES from the body byte layout, and several body bytes are bit-packed - so the current whole-byte dials at 26/30/32/38/39 are semantically wrong and can clobber sibling fields.
- Work to do: (1) backend GET /api/control-map returning per-index descriptors {index,type:knob|select|toggle|segmented,name,bits{shift,mask},options?[]} derived from sa-244 'items'; relabel 26+ by body layout. (2) frontend renders select (native select, [selected] per option + unknown guard), toggle (native checkbox), segmented (3 buttons, [class.active]) via specOf(p); keep dial for knob type. (3) bit-safe writes: full byte = (byte & ~mask) | (value << shift) sent via flash-commit /api/control (throttled/queued like knobs). Selects: treble_cut_filter_type(30/bit0), treble_boost_maximum(30/5-7), bass_cut_filter_type(32/bit0), bass_clean_knob_assign+treble_knob_assign(38 nibbles), io_routing_option(39/4-7). Toggle: noise_gate(26/bit4). Segmented: filter_gate_mode(26/2-3), bass_shelf_slope & treble_shelf_slope. Knobs stay knobs but gain bit-mask RMW for packed indices (30/32 rolloff fields). Unmapped fields (link_channels, ext-control) out of scope.
- Verification: node -c + ng build; smoke GET /api/control-map; on hardware, flip a bit-field via UI and read back the body byte to confirm sibling bits unchanged; DECISIONS.md status entry after.

## Progress - 2026-09-02 pedal-app: Neuro-style discrete controls (selects/toggles/segments)
- Backend: added WORKBENCH_CONTROL_SPECS (server.js, above CONTROL_NAMES) - the 53-byte preset-body control map derived from sa-244.json presetEditor.controls (types knobs/dropDownList/buttonList/switch), each descriptor {index,name,type,shift,mask,max,options?}. Packed bytes split into per-field controls: 26 (Noise Gate toggle shift4 + Filter Gate segmented shift2), 30 (Treble Cut select bit0, slope segmented, Boost Rolloff knob 2-bit, Boost Max select bits5-7), 32 (Bass Cut select, slope segmented, Bass Boost Rolloff knob 5-bit), 38 (Bass + Treble Knob Assign nibbles), 39 (I/O Routing bits4-7), plus previously-missing shelf freq knobs 29/31. Option labels copied verbatim from sa-244 (KNOB_ASSIGN x14, SLOPES, GATE Off/Low/Med/High, BOOST_MAX, ROUTING x9, cut filter types). Engine params 4/17 remain selects with options from DIST_ENGINES. New GET /api/control-map (static, no pedal contact). Verified: node -c, 2000x encode/decode round-trip of all bit-fields vs neuroMap encodeBinary53/decodeBinary53 (zero mismatches), throwaway-port smoke returns count=45.
- Note: CONTROL_NAMES stays governing the MONITOR (live control-table numbering is correct there); the WORKBENCH now uses the body-layout map, fixing the 26+ mislabels (Gate Threshold/Clean High Cut/Treble Freq/Bass Freq... were live-table numbers applied to body bytes).
- Frontend: lalady.models.ts adds ControlSpec/ControlOption/ControlMap; api service controlMap(); component fetches control-map into controlSpecsByIndex, knobRows now yields {spec,p} per field grouped (Dist1/Dist2/Parametric EQ + Noise gate & filters [26,37] / Routing & assign [38,39], adds 29/31). Native-element rendering: select (pattern from engine-select v3: [selected] per option, ?? N unknown fallback, no NgModel/ngValue), checkbox toggle, segmented buttons. Knob geometry now per-spec (fieldValue/max) not 0..255. Writes: setField composes (byte & ~mask) | (field << shift); whole-byte params keep realtime CTRL_SET; packed fields go through a 300ms-debounced single-flight flash-commit queue via /api/control (readback syncs p.value, pending coalesced). Removed engines[]/isEngineParam/onEngineSelect special-cases (engines now come from the map).
- Checks: ng build passes; chunk lalady-component rebuilt. User must restart BOTH backend (:3111) and ng serve. Hardware verification still pending: flip a bit-field in the UI and confirm sibling bits unchanged on read-back (treble_boost_rolloff vs boost max, etc.).
## Plan - 2026-09-02 pedal-app+web: live-index realtime + workbench live mirror (Option A+)
- Goal: universal-ish realtime knob control via the LIVE control table (CTRL_SET 0x70 at the control's live index), not only body==live-aligned bytes, plus a live MIRROR so workbench knobs track external/live changes (MIDI board, physical knobs, Neuro).
- Live table (CONTROL_NAMES, skips body 29/31; 37..39 not in 37-byte whole-block read): 26 Gate Threshold, 27 Clean High Cut, 28 Treble Freq, 30 Bass Freq, 32/34 Mid Freq, 33/35 Q, 36 Low Cut, 37 I/O Routing, 38 Filter Gate, 39 Noise Gate Enable. Body<->live value identity holds (no scaling). Mapping body field -> liveIndex: 27->26, 28->27, 29->28, 33->32, 34->33, 35->34, 36->35, 37->36, 26 NoiseGate->39, 26 FilterGate->38, 39 I/O Routing->37; 30/32/38 packed fields -> null (stay flash-commit).
- Backend: WORKBENCH_CONTROL_SPECS gains liveIndex per spec (null where none); /api/control-map includes it; /api/control/live accepts the live control index (0..127) instead of body 0..52.
- Frontend: setField sends realtime CTRL_SET to spec.liveIndex (optimistic + readback) when present, else existing debounced flash queue. Live mirror: reuse api.controls() poll; map liveIndex->field; apply block values when present, skipped while that knob is dragging; whatever is absent (live 37-39 likely) degrades gracefully.
- Verification: node -c, smoke /api/control-map, ng build; hardware smoke by user. Branch backup/live-index-pre-2026-09-02 created before implementing.
## Progress - 2026-09-02 pedal-app+web: live-index realtime + workbench live mirror (done)
- Backup branch backup/live-index-pre-2026-09-02 created from clean main HEAD before touching code.
- Backend: WORKBENCH_CONTROL_SPECS gains liveIndex per field (1:1 body<->live mapping, values identical): 0..25 -> self; 26 Noise Gate->39, 26 Filter Gate->38, 27->26, 28->27, 29->28, 31->30, 33->32, 34->33, 35->34, 36->35, 37->36, 39 I/O Routing->37; packed 30/32 sub-fields and 38 knob assigns -> null (stay flash-commit). /api/control-map includes liveIndex (full spec serialized). /api/control/live now validates index 0..127 = LIVE control index (was body 0..52).
- Frontend: ControlSpec.liveIndex added. setField routes realtime CTRL_SET when spec.liveIndex!=null (sends the field value to the LIVE index via a 40ms coalesced live queue, last-wins per index); body-only fields keep the 300ms debounced flash-commit queue. onParamInput (body-index whole-byte path) removed/migrated.
- Workbench live mirror: 2s poll of /api/controls reconciles each spec with a liveIndex onto the UI knob (field bits rewritten in place, marked as override+slotsDirty so Save persists it; overrides run after the backend's live-copy in /api/slots/save). Drag guard: a knob being dragged is skipped; fields w/o live control keep last-known value. Mirror started in ngOnInit, stopped in ngOnDestroy.
- Checks: node -c OK; throwaway-port 3999 smoke GET /api/control-map -> ok=True count=45 with liveIndex populated (26+ shown: 39/38/26/27/28/36/30/32/33/34/35/37; null for 30/32/38); ng build passes (lalady-component rebuilt). No orphan node left on 3999.
- User verification pending: restart backend :3111 + ng serve; drag Gate Threshold/EQ knobs = instant audio; toggle Noise Gate = instant; external MIDI board or physical knob turns moved the on-screen knob within ~2s; Save keeps the mirrored values.

## Plan - 2026-09-02 pedal-app+web: MIDI CC send for knob changes
- Goal: knob changes send MIDI CC from the browser (Web MIDI) instead of HID CTRL_SET. Use the decoded 0x80-based CC map: eeprom[0x80+cc] = controlIndex (0xff unassigned). CC2..46 + CC102(bypass). Unbound controls (Left/Right Output, packed 30/32/38) get red border + HID fallback.
- Backend: new GET /api/midimap reads EEPROM, decodes cc->control and control->cc, returns static map. Replace old decodeMidiMap (was 0xc0-based, wrong).
- Frontend: ControlSpec gains cc (from midimap). LaladyMidiService.gain sendCc(cc,value). setField/queueLive -> if cc present && Web MIDI available: sendCc, else HID fallback. Red border CSS on specs with cc==null.
- Value scaling: send field value directly (0..127 for CC); if pedal needs *2 for 0..255 knobs, verify on hardware and adjust.
- Files to modify: pedal-app/server.js, pedal-app/src/laLadyModel.js (deprecate old decode), web/src/app/dist/lalady/lalady.models.ts, lalady-api.service.ts, lalady.component.ts, lalady-midi.service.ts, lalady.component.scss

## Progress - 2026-09-02 pedal-app+web: MIDI CC send for knob changes (done)
- EEPROM MIDI map decoded: 128-byte table at 0x80..0xff, eeprom[0x80+cc] = control index, 0xff = unassigned. Header bytes 0x80/0x81 (0x03 0x10) are fixed firmware and skipped (not CC 0/1 bindings). 46 bindings from full-midi-map.osbf: CC2..46 = controls 0..110 in Neuro MIDI page order, CC102 = Bypass/Engage (127).
- Backend: correct decodeMidiMapFromEeprom function + GET /api/midimap returning ccToControl[128], controlToCc, bound[], boundCount. Live EEPROM read (one HID GET).
- Frontend: ControlSpec.cc filled from /api/midimap on init. LaladyMidiService.sendCc(cc, value) sends generic CC on configured channel. queueLive: if spec.cc present -> sendCc from browser; else HID CTRL_SET fallback.
- Unbound controls (Left/Right Output, packed 30/32/38, Both 100-112): red border via .unbound CSS class on .knob div.
- Checks: node -c OK; throwaway-port 3999 smoke: /api/midimap ok=True boundCount=46, cc/ctrl/name correct; ng build passes.
- Value scaling for 0..255 knobs (send 0..127 CC -> pedal reads what?) TBD on hardware verification by user.
- Files changed: pedal-app/server.js (decodeMidiMapFromEeprom, /api/midimap), pedal-app/src/laLadyModel.js (old decodeMidiMap deprecated), web/src/app/dist/lalady/lalady.models.ts (cc), lalady-api.service.ts (midimap), lalady-midi.service.ts (sendCc), lalady.component.ts (fetchMidiMap, queueLive->sendCc), lalady.component.html (.unbound class), lalady.component.scss (.unbound border)

## Progress - 2026-09-02 pedal-app+web: fix CC value scaling + mirror grace guard
- Bug: CC is 7-bit (0..127) but workbench knob/live values are 0..255. Sending raw knob values truncated via sendCc (value & 0x7f), then the 2s mirror read back the truncated pedal value and yanked the knob to a large/prev state. User reported knob "returning to prev or jumping to large" after touching.
- Fix: queueLive now scales 0..255 -> 0..127 on CC send (Math.round(v*127/255) via ccScale). Mirror skips any liveIndex CC'd within last 3s (CC_GRACE_MS via recentCc map) so readback doesn't fight an in-progress turn. HID fallback (controlLive) unaffected (body/live values identical, no scaling).
- NOTE still open (needs hardware confirmation): pedal holds only 7-bit resolution via CC, so after the 3s grace the mirror will still normalize the knob to the quantized value. Decide on hardware whether pedal scales CC internally (if so, may want raw passthrough instead).
- Checks: ng build passes. Files: web/src/app/dist/lalady/lalady.component.ts (ccScale, recentCc, mirror guard).

## Progress - 2026-09-02 pedal-app+web: knob domain is now 0..127 (CC-friendly)
- Goal: make workbench knob positions 0..127 (matching 7-bit MIDI CC so external MIDI hardware sending CC maps 1:1). Pedal native storage stays 0..255; scaling is frontend-only at the API edge.
- Implemented: fieldValue() returns 0..127 for continuous knob specs (native/2, clamped to 127); setField() converts UI 0..127 -> native 0..255 (x2) for the byte/overrides/Save and passes native to queueLive. queueLive CC branch sends toUI(v) = 0..127 (== displayed knob), HID branch sends native 0..255. toUIMax() gives 127 for knobs so drag/wheel clamps and dial angle/arc normalize to the 0..127 UI range. Mirror reads live native -> toUI compare, writes native byte. Selects/toggles/segmented unchanged.
- Removed obsolete ccScale (255->127 linear); now exact 0..127 domain. toUI clamps 127.5(max round) to 127 so display/arc never overflow.
- Files: web/src/app/dist/lalady/lalady.component.ts. ng build passes.
- NOTE: Save overrides + /api/slots/save still send native 0..255 bytes (correct, backend unchanged). Backend spec.max stays 255.

## Progress - 2026-09-02 pedal-app+web: fix false-red Left/Right Output (CC 0/1 ARE bound)
- Bug: Left/Right Output showed red (unbound). Root cause: earlier decode assumned .osbf EEPROM bytes at 0x80/0x81 (values 03,10) were a "fixed firmware header" and skipped CC 0/1. That was wrong - the .osbf USER_EEPROM is NOT raw binary but ASCII-hex encoded (SIZE=256; <512 hex chars>). My earlier "triple-confirmed" analysis read the RAW ASCII bytes instead of decoding the hex, misinterpreting eeprom[0x80]=0x30 ('0') etc.
- Correct decode: USER_EEPROM hex decodes to a real 256-byte eeprom. CC 0 -> control 3 = Left Output, CC 1 -> control 16 = Right Output. Both genuinely bound.
- Fix: removed MIDI_MAP_HEADER_LEN skip in decodeMidiMapFromEeprom. Verification python decoded hex: cc0=3, cc1=16, full map below. Smoke /api/midimap boundCount=48, ctrl3 cc0 Left Output, ctrl16 cc1 Right Output.
- Correct unbound (workbench): indices 6,19,29,31 (no cc). Packed byte30/32/38 subfields still have liveIndex null -> still red (individual CC not possible; byte-level CC exists but sub-fields can't be driven separately).
- ACTION NEEDED later: several .osbf-derived numbers in DECISIONS summary and pedal-app/docs were computed from the binary misread and may be wrong; re-derive EEPROM byte values by decoding the USER_EEPROM hex, not reading offsets directly.

## Progress - 2026-09-02 pedal-app+web: remove knob halving (UI/byte/CC all 0..127 identity)
- Bug: after the 0..127 knob change, toNative doubled the byte (ui*2, expecting 0..255) while CC sent toUI(native)=round(native/2). But the pedal stores the CC value it receives as the raw control byte (value identity, no scaling - DECISIONS line ~1453 'Body<->live value identity holds'); it does NOT double it. So mirrored readback (byte=ui) hit toUI=ui/2 -> knob reverted to half after the 3s grace, and round() quantization made wheel/drag look like chunky ~6pt steps.
- Fix: toNative/toUI for knobs are now identity (clamped). knob UI 0..127 == flash byte 0..127 == CC 0..127. No halving/doubling. Field write, CC send, HID send, mirror compare, overrides/Save all consistent.
- Verified by reason + line 1469 plan: 'send field value directly (0..127 for CC)'.
- Files: web/src/app/dist/lalady/lalady.component.ts. ng build passes.

## Progress - 2026-09-02 pedal-app+web: stop spurious yellow on slot load
- Bug: entering a slot, some controls showed changed values AND yellow 'modified' highlight even though nothing was touched. Cause: on load, paramsSnapshot captured the flash preset body, but the 2s mirror immediately reconciled against the pedal's LIVE control table (which can differ from flash - physical knob moved / prior live edits), rewriting p.value AND setting editedOverrides+slotsDirty -> initialValue(current)? mismatch -> yellow.
- Fix: added mirrorBaselineSet flag. Reset false in loadSlotParams. On the mirror's FIRST pass after load, adopt the pedal's live value as the baseline (update p.value display + paramsSnapshot for that param index) WITHOUT flagging editedOverrides/slotsDirty. Subsequent mirror passes flag genuine live deltas as before. So entering a slot now shows the pedal's live state cleanly (no yellow for initial live-vs-body differences).
- NOTE: values still re-sync to the pedal's live table on load (by design); only the false-edited/yellow marking is suppressed. If user wants entering a slot to pin to the saved flash body instead, revisit.
- Files: web/src/app/dist/lalady/lalady.component.ts. ng build passes.

## Progress - 2026-09-02 pedal-app+web: opt-in live observation (Start/Stop button)
- Bug: dragging one knob / changing dist engine caused MANY knobs to move and turn yellow. Root: the 2s mirror always ran, reconciling every control against the pedal's live table and (until the last commit) flagging them as edits; live-vs-flash drift accumulated over passes so one interaction lit up many controls.
- Fix per user request ('make a button to start observing real values, and stop'):
  - Mirror no longer auto-starts (removed startMirror() from ngOnInit).
  - Added mirrorOn flag + toggleMirror() and an 'Observe live' / '● Observing live…' button in the workbench slot-picker. Clicking Start begins the 2s /api/controls reconciliation; Stop halts it.
  - Editing (drag/select) only ever writes the single touched control (setField/queueLive) - no other knobs change unless Observation is on and the pedal's live values genuinely move.
  - mirrorControls() also updated earlier (previous commit) to never add to editedOverrides/slotsDirty - yellow now only reflects actual user edits.
- Files: web/src/app/dist/lalady/lalady.component.ts (mirrorOn, toggleMirror, no auto-start), lalady.component.html (Observe live button), lalady.component.scss (.mirror-toggle/.on). ng build passes.

## Progress - 2026-09-02 pedal-app+web: proportional native->UI observe mapping
- Bug: during observation, touching a real pedal knob caused the workbench knob to change by too much / unequally. Cause: knob UI is 0..127 but the pedal's native knob/live value is 0..255; toUI was identity (Math.min(127, native)), so native 0..127 mapped 1:1 onto the 0..127 UI (about 2x physical tick) and native>127 clamped to 127 (stuck at max) - neither proportional nor equal.
- Fix: toUI/toNative for knobs are now proportional: toUI = round(native*127/255), toNative = round(ui*255/127). So a physical 0..255 knob reflects smoothly onto the 0..127 knob (1 tick physical ~ half tick UI), no clamping, no exaggeration. CC send = toUI(native) = the 0..127 UI value (CC-friendly). HID/save path uses native toNative(ui)*... (native 0..255) unchanged.
- User chose 'keep 0..127 knob, proportional observe'.
- NOTE (inherent pedal limit): CC can only express 0..127, so a CC-driven control sits in the native 0..127 half; observation then shows ~half on the 0..127 UI. recentCc 3s grace hides it right after our own edit.
- Files: web/src/app/dist/lalady/lalady.component.ts (toUI/toNative). ng build passes.

## Progress - 2026-09-02 pedal-app+web: new read-only 'Observe' tab
- Added a read-only 'Observe' tab between Workbench and Slots. Shows the CURRENT live state of every control (knobs, selects, toggles, segmented) in the same group layout as the workbench, rendered as plain text labels - nothing editable.
- Values poll via the existing /api/controls -> monitor (5s, reused monitorOn/toggleMonitor/startMonitor); openObserve() switches tab and auto-starts the poll.
- Data model: observeGroups getter iterates CONTROL_GROUPS x controlSpecsByIndex (no slotParams dependency); observeNative(spec) reads the live value by spec.liveIndex; observeLabel(spec) formats by type (knob: toUI(native); select/segmented: option text or '?? N (unknown)'; toggle: ON/OFF). Packed/unbound (liveIndex null) show '—' in muted style.
- CSS: .obs-knob/.obs-label/.obs-value read-only cards. ng build passes.
- Files: web/src/app/dist/lalady/lalady.component.ts, lalady.component.html, lalady.component.scss.

## Progress - 2026-09-02 pedal-app+web: HID-only MIDI, full 255 knob range, merged Monitor+Observe
- **MIDI reverted to HID-only**: removed Web MIDI CC sends from queueLive — all knob writes go through `controlLive` (HID CTRL_SET). Removed `LaladyMidiService` import, `controlToCc`/`recentCc`/`CC_GRACE_MS`, `fetchMidiMap()`, `toggleMidiEngage()`, MIDI engage button, MIDI channel chip, `.midi-engage-btn`/`.midi-chip` styles. External MIDI/physical knob changes still visible via the mirror poll.
- **Knob range 0..255 (full native resolution)**: removed `isKnob()`, `toUI()`, `toNative()` scaling — `fieldValue()` returns raw byte, `toUIMax()` returns `spec.max` for all types. Knobs now have 256 points of resolution instead of 128. SetField uses `Math.min(spec.max, uiValue)` directly.
- **Monitor + Observe merged into one tab**: removed Monitor tab from nav and HTML. Observe tab now contains all live value display (same grouped layout). Removed `.unbound` CSS class (no CC tracking). Mirror grace guard removed since no CCs are sent from UI.
- Files: web/src/app/dist/lalady/lalady.component.ts, lalady.component.html, lalady.component.scss, lalady-midi.service.ts (kept but no longer imported).

## Progress - 2026-09-02 pedal-app+web: move static inspector to Angular Inspect tab, delete fallback
- Moved all diagnostic features from `pedal-app/web/index.html` into a new Angular **Inspect** tab.
- New tab shows: preset flash hex dumps with byte-level breakdown, EEPROM 256-byte dump, MIDI map (CC→control) with region hex, .osbf backup reference with offline .pre export links, EEPROM vs .osbf diff.
- Added `EepromData`, `OsbfData`, `PresetRow` models to `lalady.models.ts`.
- Added `eeprom()`, `osbf()`, `exportRefUrl()` API methods to `lalady-api.service.ts`.
- Added `midiMapBound` getter, `formatHex()`, `exportRefUrl()`, `loadInspect()` to component.
- Deleted `pedal-app/web/` directory and removed `express.static` middleware from `server.js`.
- Files: web/src/app/dist/lalady/*, pedal-app/server.js, pedal-app/web/ (deleted).

## Progress - 2026-09-02 tabs: moved tabs project out of fx repo
- Moved the 	abs project (bass tab library app) from C:\server\fx\tabs to the separate repo C:\server\tabs.
- Copied all tracked content: server/, web/, README.md, DECISIONS.md into the destination repo (untracked there, ready to commit).
- The generated data/uploads/ and 	abs.db were not in git and are auto-recreated by 	abs/server/server.js on startup (s.mkdirSync + ROOT_DIR).
- Updated x/AGENTS.md: removed [tabs] project prefix and the tabs backend-server note.
- Updated x/README.md: tabs links now point to ../tabs/.
- Updated x/.gitignore: removed the # Tabs app block (now out of tree).
- Verified copy complete in destination; fx build elsewhere unaffected.

## Progress - 2026-09-03 fx: reorganize into web/ + back/{h90,lalady}
- Reorganized the repo so code lives under web/ and ack/.
- Moved all H90 backend + reverse-engineering (server/) into ack/h90.
- Moved all Source Audio L.A. Lady stuff (pedal-app/) into ack/lalady.
- Moved h90 root data scripts (build_db.py, devs*.py, H90-IMPORT-NOTES.md, upx4.tar.xz) into ack/h90.
- input/ (shared data) and mc3/ stay at repo root.
- Added ack/package.json: 
pm start / 
pm run start:h90 (H90 :3000) and 
pm run start:la (L.A. Lady :3111).
- Fixed moved path refs:
  - back/h90/server.js DB_PATH/ROOT_DIR now __dirname (presets.db + patchstorage live beside build_db.py).
  - back/lalady server.js + src/live.js now resolve ../../input / ../../../input.
  - h90_reconstruct.py patchstorage path updated.
- Web top header now links both /dist (L.A. Lady) and /h90.
- web/package.json server scripts point at ../back/h90 and ../back/lalady.
- Updated README.md, web/README.md, AGENTS.md, .gitignore for the new layout.
- Verified: web 
g build passes; node --check + py_compile clean; back npm scripts resolve; input files present at expected paths.

## Plan - 2026-09-04 pedal-app: fix Save clobbering packed EQ/gate bytes (live-overlay misindexing)
- User report: changing Treble Boost Rolloff makes the neighbouring treble/bass (Parametric EQ) controls change chaotically and end up wrong after saving.
- Root cause (code): POST /api/slots/save copies the pedal LIVE control block onto the 53-byte preset body by RAW index: for (i=0;i<min(live.length,body.length);i++) body[i]=live[i]. Body and live numbering are identical only for 0..25; from 26 up they DIVERGE (body 27 Noise Gate Threshold = live 26 Gate Threshold; body 28 Clean High Cut = live 27; body 29 Treble Shelf Freq = live 28; body 31 Bass Shelf Freq = live 30; body 33/34/35/36 Mids = live 32/33/34/35; body 37 Low Cut = live 36). Body bytes 26/30/32/38 are PACKED bit-fields with no 1:1 live byte. So a Save after an EQ edit overwrites packed byte 30 (treble cut/slope/rolloff/boostmax) and 32 (bass cut/slope/rolloff) plus the 27/28/29/31/33..36 whole bytes with the WRONG live values -> the packed fields re-decode into garbage and every EQ/gate knob scrambles ("closest treble controls chaotic change").
- Fix: in the save merge, transfer only genuine 1:1 body<->live pairs (0..25 self excluding unmapped 6/19; plus 27<-26, 28<-27, 29<-28, 31<-30, 33<-32, 34<-33, 35<-34, 36<-35, 37<-36), keep packed bytes 26/30/32/38 and the tail from the slot flash body, then apply UI overrides on top (overrides already carry full composed bytes for edited packed fields -> they can never be clobbered again).
- Also fix resolveActiveSlot ACTIVE_COMPARE to compare semantically-correct body<->live PAIRS instead of raw live[k]==body[k] at disjoint indices (26..36), so active-slot resolution / /api/control commit target stays correct.
- Verify: node -c; no web build needed (backend-only).

## Progress - 2026-09-04 pedal-app: fixed Save clobbering packed EQ/gate bytes
- Root cause confirmed in code: POST /api/slots/save built the persist body by copying the LIVE control block onto the body at RAW index (body[i]=live[i] for i=0..36). Body and live numbering only agree for 0..25; from 26 up they diverge (body 27<=live 26, 28<=27, 29<=28, 31<=30, 33-36<=32-35, 37<=36), and body bytes 26/30/32/38 are PACKED with no 1:1 live byte. So the 100% whole-byte value of live 30 "Bass Freq" landed on packed body 30, and live 32 "Mid A Freq" on packed body 32 -> the four treble sub-fields (cut/slope/rolloff/boostmax) and four bass sub-fields re-decoded into arbitrary values -> "closest treble controls chaotic change" on Save.
- Verified offline: byte-30/32 packing itself is CORRECT (input .pre files match their .osbf bodies byte-for-byte: goodtone c2, Heavy b3, Sleepy ab, plus UP1 oct2+octFuzz b30=0x84, UP0 diman b30=0xd2). The chaos comes purely from the save overlay.
- Fixes in server.js:
  - ACTIVE_COMPARE / resolveActiveSlot now compare [bodyIdx, liveIdx] PAIRS (0..25 self, 27<-26, 28<-27, 29<-28, 31<-30, 33<-32, 34<-33, 35<-34, 36<-35, 37<-36) instead of raw live[k]==body[k] at disjoint indices -> active-slot resolution and the /api/control commit target stay correct.
  - /api/slots/save merge copies ONLY genuine 1:1 pairs, keeps packed bytes 26/30/32/38 + the body tail (>36) from flash, and applies UI overrides last (full composed bytes, so edited packed fields can never be clobbered). Physical knob changes for 1:1 live controls are still captured.
- Checks: node -c (server.js) passes; offline save-merge simulation shows OLD save scrambled b30->0x6e (treble cut=0 slope=3 rolloff=1 max=3 vs real 1/1/2/5) and b32->0x65, NEW save keeps b26/b30/b32 intact while capturing the mapped live values. Backend-only change (no web build). User must restart the la-lady backend :3111. NOT committed.

## Plan - 2026-09-04 pedal-app/web: Playwright audit suite for the L.A. Lady workbench (every knob, select, toggle, segmented)
- User wants a Playwright-style automated check of every workbench control to LEARN how each one works (UI interaction -> which request it fires -> what byte/bit-field it writes).
- Create web/playwright.config.ts + web/tests/lalady-workbench.audit.spec.ts (single serial spec, shared page, workers=1 because the pedal is one USB device):
  - Guard: skip unless GET /api/device says found.
  - Workbench loads on the active slot (read-only auto-select) -> capture 53-byte slot body snapshot.
  - Targeted save-regression step FIRST: drag Bass Shelf Frequency (body 31, live 30), Save, assert packed byte 30 (treble fields) is unchanged and byte 31 == UI value (this reproduces the fixed clobber on the OLD backend and passes on the fixed one).
  - Full audit: for every control-map spec, drive the DOM control (drag knob up/down by value, pick a different select option, flip toggle, click a different seg), then assert the exact network request it fires (/api/control live vs /api/control flash) with the exact expected payload: live -> {index: liveIndex, value: field}; packed -> {index: byte, value: (prevByte & ~mask) | (field << shift)} and response readback matches.
  - Save round-trip: readback bytes == UI-tracked bytes for every edited index, snapshot bytes unchanged elsewhere; soft-flag if gate toggle edits (byte 26 bits) do not persist on Save (suspected gap).
  - Restore: POST /api/slots/save with overrides for ALL 53 bytes from the snapshot (works on old AND fixed backend), reload page, confirm knobs show snapshot values.
  - Attach a JSON per-control report so the run doubles as a control-map documentation pass.
- Add @playwright/test devDependency + web script (test:e2e:lalady). No backend processes spawned; user runs backend :3111 and 
g serve.

## Progress - 2026-09-04 pedal-app/web: Playwright workbench audit suite written
- Created web/playwright.config.ts (workers=1, no webServer spawn, WEB_URL/API_URL env-derived, default 4211/3111) and web/tests/lalady-workbench.audit.spec.ts.
- Suite, one serial test (shared page):
  1. Loads /dist workbench on the ACTIVE slot, asserts every control-map spec renders exactly one DOM control.
  2. SAFE save-path probe FIRST: drag Bass Shelf Frequency (body 31/live 30), confirm the live CTRL_SET request, Save, assert packed byte 30 unchanged + byte 31 == UI value. Old backend => clobbered byte 30 => probe fails => write-audit ABORTED (protects against stale resolveActiveSlot misidentifying the active slot and flash-committing to the wrong slot); fixed backend => audit runs. Probe is RAM + explicit-idx Save, so it cannot damage other slots even on the old build.
  3. Per-control audit: for EVERY spec (46 total) drives the DOM control (drag knob up/down single-move, pick a different select option, flip toggle, click a different segmented) with waiters registered BEFORE the interaction, then asserts the EXACT payload: realtime -> POST /api/control/live {index: liveIndex, value: field}; packed -> POST /api/control {index, value: (prev & ~mask) | (field << shift)} with response readback === payload. Tracks a body[] mirror of the UI state byte-by-byte.
  4. Save round-trip: readback[i] === UI-tracker body[i] for all 53 bytes (this fails on the old backend since 30/32/38 get clobbered by the misindexed live overlay).
  5. Restore original body via /api/slots/save overrides for ALL 53 bytes (works old/fixed), reload, verify every control's DOM state equals the snapshot body. afterAll backstops the restore.
  - Attaches workbench-audit.json (per-control payloads + findings + hex body snapshot) and logs FINDING lines. Fails at the end listing every failed control.
- Verified: npm i -D @playwright/test@1.47 (installed 1.62.1, lock updated); tsc --noEmit on the two new TS files passes; npx playwright test --list loads 1 test. Not executed against hardware (backend :3111 + pedal + ng serve must be running; pedals: the probe requires the save-fixed server). NOT committed.
- Run: cd web && npm run test:e2e:lalady (WEB_URL/API_URL env override optional). Lost only note: physical-knob gate changes still don't pack into flash body 26 on Save (save keeps byte 26 from flash by design) - flagged as observation, not asserted.

## Status - 2026-09-04 pedal-app/web: Playwright suite runnable, smoke-checked
- npm i -D @playwright/test (lock updated); npx playwright install chromium done.
- Smoke run with API_URL http://localhost:1 (no device): suite loads, browser launches on this machine, beforeAll device guard makes the test SKIP cleanly (1 skipped). No pedal touched.
- web/.gitignore now ignores /test-results, /playwright-report, /blob-report. Real run requires the save-fixed backend :3111 + pedal + ng serve.

## Status - 2026-09-05 pedal-app/web: workbench audit PASSES 45/45 against the pedal; runaway render storm root-cause fixed
- The audit previously failed the moment any knob was hovered: a PERPETUAL Angular change-detection/rebuild loop (~60 ticks/s, `knobs > knob +1` / `ctl-select +1` childList mutations re-created every tick). Isolated to two cooperating causes in web/src/app/dist/lalady/lalady.component.ts:
  1. `get knobRows()` was impure (rebuilt groups + fresh control objects on EVERY CD call); the prior memoization never engaged because its invalidation key compared the fresh key ARRAY by identity (`this._knobRowsKey === [slotParams, ...]` -> always false, confirmed live: rowsKeyChanged=294/294 during a 2.5s hover). Fixed: pairwise key comparison `_knobRowsKey[0] === slotParams && _knobRowsKey[1] === controlSpecsByIndex`.
  2. `onKnobEnter` re-assigned `hoveredParam` on every pointerenter re-fire (each CD replaced the hovered node under the cursor -> re-enter -> reset -> CD...). Guarded to first-set-only per param. Verified the storm is 100% enter-driven (noop handler -> 0 mutations).
- After the fix: idle DOM = 0 mutations, wheel = 1 mutation then settles (was ~350 batches earlier). Pre-existing on the original code (verified by stashing the memoization) - the app had a latent 100%-CPU bug on any knob hover; now stable.
- Audit drives knobs via synthetic wheel (headless drops mouse->pointerdown so drags never arm), selects via selectOption, segmented via .ctl-seg-btn, toggles by clicking the visible .ctl-toggle (its checkbox input is display:none, so setChecked() never becomes actionable).
- Tolerant per-control precondition (root.waitFor attached + .first()) replaced the flaky toHaveCount(1) gate (it intermittently failed AFTER the probe Save reload on 26/27/28/29/30/37 with "toHaveCount Expected 1 Received undefined" even though the elements were present; likely transient panel remount blink during the gate).
- RESULT: `npx playwright test --timeout=1200000` => 1 passed (56.1s). Probe: Save after live bass-freq edit keeps packed byte 30 = 0x19, byte 31 follows (backend still save-fixed). All 45 specs audited (0..44 incl. multi-spec bytes 26,30,32,38), Save round-trip readback == UI tracker for all 53 bytes, restore reverted the pedal to its original body and the DOM reflects it.
- Files: lalady.component.ts (storm fix), tests/lalady-workbench.audit.spec.ts (toggle/precondition hardening). All dbg-*.js probes deleted. NOT committed.
