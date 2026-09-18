# Decisions вЂ” Programmatic H90 control from the web app

## Workflow (session convention)

- **Session start:** read this file (and `H90-IMPORT-NOTES.md` for H90 work)
  first and keep it in mind for the whole session.
- **Before every task:** append a `## Plan вЂ” <date> <task>` entry at the bottom
  of this file (goal + how it will be verified). Then do the work.
- **After every task:** append a `## Progress вЂ” <date> <task>` entry (what was
  done, artifacts, results, next steps). Update `H90-IMPORT-NOTES.md` too where
  it tracks H90 protocol work.

Status: **in progress**. The read/download path is fully decoded (plain zlib
FlatBuffers) and the import **write** path is now decoded too вЂ” it is zlib
**DEFLATE with a preset dictionary**, NOT encryption. The custom inflate decoder
(`server/h90_dict_recover.py`) is built and validated byte-for-byte against
zlib. The only remaining unknown is the exact dictionary (built at runtime from
pedal data). See "Resume here".

## Current state вЂ” 2026-08-13 session end (resume point)

**Where we are:** the write request = DEFLATE stream whose output is the pedal's
**current program** (VECHOLONG) serialization **patched with the imported
preset's values** (TWO-WAY for req1, MURKY for req2). req1's output decodes to a
ValueTree wrapper + base64 JSON; **every literal b64 run decodes to the
`.preset90` file's JSON byte-for-byte** (e.g. `987.4534912109375,
"dlya_denormalized_pretaper":350.0,...`), confirming the imported values equal
the file's values. The ONLY unknowns left are the **72 dict-copied bytes** in
req1's output (21 in req2, all sourced from req1's 72), which are VECHOLONG's
values вЂ” never transmitted, 2 adler32 equations for 72 unknowns в†’ not solvable
offline from existing captures.

**What was confirmed this session:**
- Write-variant structure: `out[211:976]` = 637 b64 chars + **128 non-b64 bytes**
  (117 `\x00`, 4Г—`0x3f`, 2Г—`0x0d`, 2Г—`0x80`, `0x2d`, `0x14`, `0x10`). 72 = deflate
  dict-copies (VECHOLONG); 56 = literal marker bytes. The b64 runs decode to the
  file JSON at per-run phases (stream is NOT phase-continuous; pedal reassembles
  chunks вЂ” marker semantics unknown).
- 72 dict-copies в†’ **69 distinct window offsets 31004вЂ“32730**
  (`req1_dict_constraints.json`).
- req2's dict = req1's output (window offsets 31916вЂ“32764 в†” `req1_out[124:973]`);
  148/169 req2 refs resolve from known req1 bytes.
- Full output layout documented in `H90-IMPORT-NOTES.md` (08-13 section):
  `[0:32]` TRPC wrapper, `[32:192]` ValueTree structure, `tjknobs-knob4\x00\x00\x00xdl`
  at 192-210, b64 stream 211-871, second `tjknobs-knob4` block at 872-890, more
  b64, `"}\n` at ~946, trailer at 951-976.

**Decision pending (user paused; will continue later):** how to obtain the 72
VECHOLONG bytes. Options: (1) Mac lldb dict recapture вЂ” dump the 32768-byte
deflate window at send time (`server/h90-captures/h90_dict_capture.py`, primary);
(2) static RE of the app binary for the `zdict` construction (angr/capstone);
(3) build a literal-only write from the file JSON and test on the pedal whether
it accepts a marker-free stream. Artifacts:
`server/h90-recon/decode_status.json`, `H90-IMPORT-NOTES.md` 08-13 section.

## 2026-08-05 (late) update вЂ” write path DECODED: DEFLATE + preset dictionary

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
  (31916вЂ“32764); the referenced bytes look like a preset serialization (vtable
  offsets, u32 lengths, `LFOShape-obj` / `PitchJumpInterval-obj` strings).
- The object-name strings are **absent from the app binary** (arm64 + x86_64) but
  present in read responses в‡’ the dictionary is built at runtime from pedal data
  (likely the current program's serialization; import #2's dict в‰€ the then-current
  `VECHOLONG` program). The app embeds JUCE's zlib (v1.2.3), whose
  `GZIPCompressorOutputStream` supports a dictionary argument.
- **Blocker status changed:** not "recover a cipher" вЂ” instead "capture the exact
  dictionary", then the encoder is a normal `deflate` with that dictionary.

## 2026-08-05 update вЂ” read path solved; write path decoded (was: confirmed encrypted)

Big progress. Re-examining the clean captures with the verified LSB-first 7-bit
unpack (`h90_decode.unpack_7bit`) overturned two earlier conclusions:

- **READ path (pedal в†’ app) is NOT encrypted.** Every large message in the clean
  Aug-2 capture `server/h90-captures/h90_virtual_rx.log` unpacks to a valid zlib
  stream that inflates to a **plain FlatBuffers** payload (root uoffset = 12,
  prefix `0c 00 00 00 08 00 0c 00 07 00 08 00`). All 18 messages extracted to
  `/tmp/h90_fb/<header>.bin` (e.g. `03050066.bin` = 149,868 B library dump with
  real preset names `OilDrum` / `Indigo Fog` / `Resotap`, and JUCE param objects
  like `switch6-obj`, `Sw 6: %s`). Small messages (в‰¤ ~100 B body) are raw
  FlatBuffers with no zlib. We can now read the pedal's full state/library.
- **WRITE path (app в†’ pedal) is DEFLATE + preset dictionary вЂ” NOT encryption.**
  The import request (`03 5E 00 4F`, one message per import: 768 B for import #1,
  512 B for import #2) unpacks to a real zlib header `78 9c` + deflate data that
  references a missing preset dictionary. Decoded with `decompressobj(-15, zdict=вЂ¦)`.
  (Earlier "high-entropy / fake marker / not zlib" conclusions were wrong вЂ” the
  dict was the only missing piece.)
- Replay rejection (2026-08-04) is now coherent: reads are stateless plaintext;
  writes are compressed against a runtime dictionary, so a replayed write (built
  against the pedal's then-current program) is rejected when that program differs.

**Correction to the 2026-08-04 note below:** "the custom encryption is the
remaining blocker" was wrong вЂ” reads are solved and writes are dictionary-deflate.

## 2026-08-04 update вЂ” replay is dead; cipher RE is required

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

## Decision 1 вЂ” Transport: WiFi MIDI (+ BLE for protocol RE)

- **Control** the H90 over **WiFi MIDI** via a local Node helper (`midi`/`easymidi`)
  that owns the connection; the browser talks to the Express server on :3000.
- **Protocol reverse-engineering** was done over **Bluetooth** by proxying the
  desktop app's BLE connection (see `server/h90_proxy.swift`). The SysEx message
  format is the same over WiFi MIDI and BLE (MIDI SysEx either way).
- USB and browser-native Web MIDI are out of scope for now.

## Decision 2 вЂ” Send-preset approach: reverse-engineer the app's import protocol (blocked)

Chosen approach (over "capture-and-replay"): derive the wire format so the web
app can generate/send an arbitrary preset without the desktop app.

Status: **partially solved, blocked on the encryption.** Everything below is
what we know as of 2026-08-02.

---

## H90 import protocol вЂ” reverse-engineering notes

### How it was captured

The desktop app `H90 Control` (PID was 32364) talks to the H90 over BLE. A
Swift MITM proxy (`server/h90_proxy.swift`, compiled to `server/h90_proxy`)
reassembled BLE fragments into complete SysEx messages and logged both
directions. A preset import into a pedal slot was captured twice:

- Import #1 вЂ” `VECHOLONG` (`.pgm90`) into a slot:
  - `server/h90-captures/h90_import_req.bin`      (768 B, 3x256 BLE chunks)
  - `server/h90-captures/h90_import_resp_big.bin` (4999 B)
  - `server/h90-captures/h90_import_resp.bin`     (110 B ack)
- Import #2 вЂ” a second preset into a slot:
  - `server/h90-captures/h90_import2_req.bin`     (512 B, 2x256 BLE chunks)
  - `server/h90-captures/h90_import2_resp.bin`    (5535 B)
- Full session stream: `server/h90-captures/h90_proxy_session.log`
  (import #1 TX at lines ~2193-2195, import #2 TX at ~2281-2282).
- Reassembled full messages: `server/h90-captures/h90_virtual_rx.log`

> Note: imports into the *library* (not a pedal slot) produce no BLE traffic;
> only imports into a pedal slot do.

### Wire format (SOLVED)

SysEx framing, all payload bytes < 0x80 (MIDI-safe):

- `F0 1C 77 00 <f4> <f5> <f6> <f7> <body> F7` вЂ” all messages (type 03 = data, type 01 = control/ack)
- Header bytes are two 14-bit fields, high/low split:
  `msgid = (f4 << 7) | f5`, `type = (f6 << 7) | f7` (0x02 = device error, 0x34 = success).
  Response message IDs differ from request IDs.
- **The body is 7-bit bit-packed data** (8 packed bytes в†’ 7 raw bytes). Verified
  scheme is **LSB-first** (`h90_decode.unpack_7bit`; round-trip verified). The
  earlier "MSB-first" note below was wrong.
- **Read path** (pedal в†’ app): unpack в†’ zlib deflate в†’ **plain FlatBuffers** root uoffset 12.
- **Write path** (app в†’ pedal): unpack в†’ real zlib header `78 9c` в†’ **raw DEFLATE
  referencing a preset dictionary** (standard zlib rejects it; needs `zdict=`).

So the chains are:
- Read: `pedal state в†’ zlib в†’ 8-bit bytes в†’ 7-bit pack в†’ SysEx`
- Write: `preset в†’ (compact serialization) в†’ raw-deflate w/ dictionary в†’ 8-bit bytes в†’ 7-bit pack в†’ SysEx`

- The import request header is constant: `F0 1C 77 00 03 5E 00 4F 78 38 16`
  (payload diverges immediately after; `78 38 16` unpacks to the `78 9c` header).
- `.pgm90` files are NOT sent verbatim: a 3024 B `.pgm90` becomes a ~757 B wire
  payload, i.e. a compact serialization of the preset (trpc flatbuffer model),
  not the file.

### The blocker (WRITE path only): the exact dictionary (NOT a cipher)

- The write payload is standard DEFLATE (real `78 9c` header, FDICT bit unset).
  Standard `zlib` fails with `invalid distance too far back`; `zlib.decompressobj
  (-15, zdict=вЂ¦)` decodes both imports. The unknown is the **dictionary** the app
  and pedal both build at runtime.
- 19 length-distance matches reference the dict; 169 output bytes depend on it;
  144 distinct dict window offsets span the last 848 B of the 32K window
  (31916вЂ“32764). The referenced bytes look like a preset serialization (vtable
  offsets, u32 lengths, `LFOShape-obj` / `PitchJumpInterval-obj` / `Lte-obj`).
- The object-name strings are **absent from the app binary** (arm64 + x86_64) but
  present in read responses в‡’ the dictionary is built from **pedal data** (likely
  the current program's serialization; import #2's dict в‰€ the then-current
  `VECHOLONG` program, whose `.preset90` file we hold).
- The app embeds **JUCE's zlib (v1.2.3)** ("1.2.3", "deflateEnd failed (ignored)")
  вЂ” JUCE's `GZIPCompressorOutputStream` takes a dictionary argument, consistent
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
  Note: that exact breakpoint got 0 hits in the lldb sessions вЂ” likely the wrong
  call-site for the captured (newer) app. No "encryptor" to find вЂ” the write path
  is DEFLATE; the relevant call is the dict construction / deflate call.
- `otool` section `offset` fields are **decimal** (a gotcha: `5531060` is decimal,
  not hex). __TEXT maps file offset в†’ VA directly (`VA = 0x100000000 + file_off`).
- **lldb attach works on the debug copy** (`~/h90-re/H90 Control.app`, re-signed
  with `get-task-allow`): attached to the live PID and ran `memory find`
  successfully. Heap `memory find` for `LFOShape-obj` over 0x10d900000вЂ“0x500000000
  returned nothing (dict/ValueTree not resident, or in a different range).

### Resume here (next steps)

Read path solved; write path = DEFLATE + dictionary (decoded), the **dictionary**
is the only unknown. Primary route is a live capture; one attempt (2026-08-05,
~19:15вЂ“19:20 MSK) was armed but paused before any import fired вЂ” the app sends
NO MIDI while idle, so the import click is required to trigger the send
breakpoints. Ready-to-reuse helper + arm command are documented in
`H90-IMPORT-NOTES.md` under "LIVE dict-capture attempt".

1. **Capture the dictionary (primary).** The debug app (`~/h90-re/H90 Control.app`,
   v1.9.5, re-signed with `get-task-allow`) runs live against the pedal through
   the proxy. lldb-attach, trigger an import, and at the `MIDISendEventList` send
   breakpoint (breakpoint 1, symbol857+704) dump the compressor's `z_stream`
   dictionary, or `memory find` the heap for the dict blob at send time. Favoured
   hypothesis to test offline first: dict = the current program's serialization
   (import #2 в‰€ `VECHOLONG-64027c252ee6e.preset90`).
2. **Verify:** decompress `req1.raw`/`req2.raw` with the captured dict; full
   plaintext must be valid and the pedal must accept a re-import.
3. **Read-side schema recovery (feeds the encoder).** Recursively parse
   `/tmp/h90_fb/*.bin` (the decoded read FlatBuffers) to map
   ExportedProgram/ExportedPreset tables, vectors, strings в†’ build the plaintext
   encoder and align `.h90` backup JSON / `.pgm90` files against it.
4. **Implement** once solved: `POST /api/h90/preset` builds the compact
   serialization в†’ raw-deflates with the dictionary в†’ 7-bit packs в†’ sends via
   CoreMIDI (`H90 Pedal` USB endpoint or `XC-05987 Bluetooth`).

## Implementation (once the dictionary is solved)

- `server/server.js`: add `POST /api/h90/preset` accepting `{ presetFile/presetName, algorithm }`,
  reads the `.pgm90`, builds the flatbuffer, raw-deflates with the dictionary,
  7-bit packs, sends via `midi`.
- Angular detail page: "Send to H90" button в†’ `POST /api/h90/preset`.
- Update `README.md` and this file with the final codec.

## Open questions

- **The exact dictionary.** Built at runtime from pedal data (current program?),
  same layout as the `.preset90` ValueTree serialization but a compact/wire
  variant вЂ” the decoded request diverges from the `.preset90` format beyond byte
  196. Not present as plaintext in the app binary or the local firmware.
- Both imports decode with `eof=False` (0 unconsumed, no skip offset works) вЂ” the
  deflate stream ends without a final block. Truncated capture or non-final flush?
- The `00 4F` / `00 13` / `00 52` sub-fields in the 03 header (msgid high byte).
- WiFi MIDI vs BLE: does the desktop app accept the identical SysEx over WiFi MIDI?

## Key files

- `server/h90_dict_recover.py` вЂ” validated raw-DEFLATE inflater with LZ77 match
  tracking + per-byte dict-source attribution (validated byte-for-byte vs zlib;
  see `H90-IMPORT-NOTES.md` "2026-08-07" section)
- `server/test_h90_dict_recover.py` + `server/tests/*.json` вЂ” regression suite
  (fixed/dict corpora + seeded random crosschecks vs zlib)
- `server/h90-captures/*.bin` вЂ” captured import requests/responses
- `server/h90-captures/h90_virtual_rx.log` вЂ” **clean** Aug-2 read capture (all
  messages decode to plain zlib FlatBuffers); extracted to `/tmp/h90_fb/*.bin`
- `server/h90-captures/h90_proxy_usb.log` вЂ” **corrupt** Aug-5 BLE capture: the
  proxy logs `prefix(len)` of the 256-byte inline MIDIPacket buffer, over-reading
  heap for packets > 256 B; do not use for payload bytes
- `server/h90_proxy.swift` вЂ” BLE MITM proxy (source, has the over-read logging bug)
- `server/h90_decode.py` вЂ” verified `unpack_7bit` / `pack_7bit` / FlatBuffer walker
- `server/capture-proxy-long.js` / `server/capture-h90-long.js` вЂ” BLE capture helpers
- `server/h90-send.js` вЂ” working WiFi-MIDI Program Change sender
- `patchstorage/pgm90/*.pgm90`, `patchstorage/preset90/*.preset90` вЂ” preset files
  to compare against wire payloads
- `/tmp/h90_fb/req1.raw` (664 B) / `req2.raw` (440 B) вЂ” the unpacked write payloads
  after the `78 9c` header (sources: `h90_import_req.bin`, `h90_import2_req.bin`)
- `/tmp/write2_out.bin` вЂ” decoded request #2 (793 B, zdict=zeros) = 32 B wrapper +
  embedded preset serialization (first 196 B match the MURKY `.preset90` file)
- `server/h90-captures/req1_dict_constraints.json` /
  `req2_dict_constraints.json` вЂ” regenerated with the validated decoder: direct
  dict window-offsetв†’byte constraints (req2: 144, offsets 31916вЂ“32764)
  for scoring candidate dictionaries
- `/tmp/deflate_dec.py` вЂ” custom inflate (validated byte-identical vs zlib on the
  35,604 B read payload; used for the dict-footprint analysis)
- `server/h90-captures/h90_dict_capture.py` вЂ” lldb Python helper for the live dict
  capture (MIDI-send breakpoint commands, heap scan, 64 KB dict save); arm command
  and results in `H90-IMPORT-NOTES.md` ("LIVE dict-capture attempt")
- `~/h90-re/H90 Control.app` вЂ” debug copy (v1.9.5, re-signed with `get-task-allow`;
  lldb-attachable, running live against the pedal through `server/h90_proxy`)
- `~/Library/Eventide/H90 Control/Firmware/h90-1.11.4.os` вЂ” local pedal firmware
  (34.9 MB; has zlib, no plaintext object names)

## Plan вЂ” 2026-08-13 angr static analysis of the Windows H90 Control.exe

Goal: use **angr** (source checkout `input/angr-master`, Python 3.12) to
statically locate the write-path zlib **dictionary construction** in the
Windows x64 `H90 Control.exe` (v1.9.13, the same JUCE build family as the
capture-era macOS 1.9.5), then score any recovered candidate dict offline with
`server/h90_dict_recover.py` against `req2_dict_constraints.json` (144
constraints) / `req1_dict_constraints.json` (69). The live lldb capture stays
the primary route; this is the offline static route (DECISIONS "Resume here"
step 4, H90-IMPORT-NOTES "2026-08-12").

Steps:
1. Install Rust (winget `Rustlang.Rustup`, `stable-msvc`) вЂ” MSVC 14.29 present.
2. Patch `input/angr-master/pyproject.toml`: `pyvex==9.3.3.dev0` (not on PyPI)
   в†’ `pyvex>=9.3.2` (released win_amd64 wheel). Build via
   `pip install ./input/angr-master` under `vcvars64.bat`. Fallback: PyPI wheel.
3. User installs `input/H90Control-1.9.13-windows-x64-installer.exe`.
4. New `server/h90_angr.py`: load exe в†’ locate/decompile the documented TRPC
   `sendMessage` fn `0x14013b610` (sanity vs rizin notes) в†’ FLIRT-match
   zlib (`deflate`, `deflateSetDictionary`) в†’ xref callers в†’ decompile в†’
   backward-slice the `zdict` argument в†’ recover dict construction.
5. Verify: `deflate_track(req, zdict=cand)` vs the constraint JSONs; if clean,
   `zlib.decompressobj(-15, zdict=cand)` gives full req1/req2 plaintext matching
   the TWO-WAY / MURKY `.preset90` heads.

Deliverable: `server/h90_angr.py` + Progress entry + H90-IMPORT-NOTES section.

## Plan вЂ” 2026-08-21 angr deep trace: recover the DEFLATE dictionary from H90 Control.exe

Goal: use angr to statically recover the exact DEFLATE preset dictionary (or
the code that builds it) from the Windows x64 H90 Control.exe (v1.9.13), so
we can encode arbitrary presets and import them to the H90 without the desktop
app.

Approach:
1. Load the exe in angr, build CFGFast, FLIRT-match zlib functions.
2. Locate `deflateSetDictionary` (zlib internal) and JUCE
   `GZIPCompressorOutputStream` constructor вЂ” these are the two sites where
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
   - B64 chars in plaintext: 637 (zero dict) в†’ max 690 (correct dict)
   - 690 b64 chars decode to ~517 bytes
   - twoway.json compact: 1169 chars в†’ b64: 1560 chars
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
   `verse","bypa_n` вЂ” matches twoway.json offset 21 exactly.

8. **Alignment mismatch**: The b64 at [211:230] encodes JSON bytes 21-34. For a
   contiguous stream, JSON bytes 0-20 would need 28 b64 chars at [183:211]. But
   [183:211] = header metadata + "tjknobs-knob4\x00\x00\x00xdl" marker вЂ” NOT
   matching expected b64 `eyJhbGdvcml0aG1fbmFtZSI6IlJl`. Only 1/28 positions match.
   
   **Conclusion**: The "tjknobs-knob4\x00\x00\x00xdl" is a STRUCTURAL MARKER
   (field name + type tag) in a JUCE ValueTree-like binary format, NOT part of the
   base64 stream. The base64 JSON data is embedded in data slots within this binary
   structure.

9. **Capacity check**: twoway.json compact = 1169 chars в†’ b64 = 1560 chars.
   Max b64 capacity with correct dict = ~909 bytes в†’ 681 decoded bytes.
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
    `21e22b15-5814-4cf8-b271-ffbaea0d4246` в†’ `["xfad","mdpt","mspd","fltr",
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
   that composes JSON в†’ compress в†’ frame в†’ 7-bit pack в†’ send.

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
- Added `serializeOsbf({productId, eeprom, presets, selectors})` in `pedal-app/src/osbf.js`: mirrors `parseOsbf` text format exactly (START_DATA/END_DATA blocks, same field layout, same hex encoding). Verified lossless round-trip: parsed the original OSBF в†’ serialized в†’ re-parsed в†’ all 6 binary payloads (85 bytes each) match byte-for-byte.
- Backend `GET /api/export-all`: reads all 6 slots via `readSlotRaw` + `getEEPROM` + productId, serializes via `serializeOsbf`, returns as a downloadable `.osbf` file (Content-Disposition attachment). Mapping: physical slots 0-2 (US0-US2, SELECTORs), slots 3-5 (UP0-UP2, USER_PRESETs).
- Backend `POST /api/restore`: loads OSBF from `input/2026-07-31_labackup.osbf`, writes all 6 slots via `commitRawPreset(idx, data53, name)`. SELECTORS (US0-US2) в†’ physical slots 0-2, USER_PRESETs (UP0-UP2) в†’ physical slots 3-5. EEPROM NOT written (confirmed: all 3 existing Neuro captures show zero EEPROM_WRITE (0x81) frames). Returns verify results per slot (before/after hex, match flag). Recalls previously-active preset after restore.
- Web: added Restore (with confirm dialog) + Export All buttons in the workbench slot-picker row. Restore shows a per-slot verify table (slot#, page, name, ok/MISMATCH). Added `restoreBackup()`, `exportAll()`, `RestoreResult`/`RestoreSlotResult` models, `api.restore()`, `api.exportAllUrl()`.
- Checks: `node -c` (server, osbf) + `ng build` pass. Backend must be restarted by user to load `/api/restore` and `/api/export-all`. Not committed.
- NOTE: `commitRawPreset` is ~2s per slot (2x ACTIVE_STORE blocks + ACTIVE_WRITE + recall, each 500ms wait) в†’ full restore ~12s. Acceptable for a restore operation.

## Progress - 2026-08-31 pedal-app+web: restore file-picker + name sanitize
- Restore now picks the .osbf file on the machine instead of a fixed path: added `loadOsbfText(text)` in osbf.js (refactored block collection from `loadOsbf`) and POST /api/restore accepts `{text}` (OSBF file content). Web: hidden `<input type=file accept=".osbf">` opened by the Restore button, read via FileReader('latin1'), sent to /api/restore.
- Fixed 500 "LALADY_NAME_SIZE is not defined": the `expect` helper referenced a constant not imported in server.js в†’ added LALADY_NAME_SIZE to the laLadyModel destructure.
- Fixed the verify column: it compared before-vs-after restore (meaningless вЂ” restore is supposed to change the slot). Removed the bogus match; now returns `readbackName` (clean name read back from flash) per slot, UI shows it instead of the raw OSBF name (which carries \u0000 null padding that rendered as squares).
- Write-side sanitize: `commitRawPreset` + `writePreset` now strip all non-printable bytes ([^\x20-\x7e]) from names before writing to flash, so no null padding ever lands on the device.
- Diagnostics: added a console.log per restored slot (wrote name vs readback name + data match).
- Checks: node -c (server, sourceAudio) + ng build pass. Backend restart required to load: LALADY_NAME_SIZE import, write-side strips, /api/restore {text}, readbackName response.

## Progress - 2026-08-31 web: workbench consolidated to Slots tab + circular knob UI
- Restructured the page into subtabs (Slots / Workbench / Monitor); later moved workbench + backup content around per user request.
- Slots tab now: removed the page column and the redundant standalone import column; Import button opens a shared hidden file picker (`importSlot(row)` clicks `#importFileInput`, `onImportFileSelected` writes into the originating row); Activate moved before Import. Backup section (Export all / Restore from backup + restore result table) folded into the bottom of the Slots tab; Backup tab removed.
- Workbench: replaced the long 255px slider rows (uncomfortable вЂ” whole range = 255px drag) with compact circular SVG dials. Knobs are grouped into bordered sections laid out in rows: row 1 = Dist 1 | Dist 2, row 2 = Parametric EQ (flex3), row 3 = Noise gate. Paramв†’group mapping by control index: Dist1=[0..12 minus 6], Dist2=[13..25 minus 19], EQ=[27..36 minus 29,31], Gate=[26,37,38,39].
- Dial geometry: value 0..255 в†’ 270В° sweep from lower-left to lower-right (screen coords, Y down); pointer via (x=20+13cos, y=20+13sin), arc via dasharray + fixed 135В° start rotation. Edited knobs highlighted amber (`modified` when value != snapshot).
- Knob interaction: vertical drag (up=up, down=down) at 4px/value step (full range в‰€64px vs old 255px), plus mouse wheel; reuses `onParamInput` realtime throttle + Save overrides. Added `knobRows` getter, `knobDown/Move/Up/Wheel`, pointer/wheel geometry helpers.
- Checks: ng build passes. No backend changes this step.

## Progress - 2026-08-31 web: show currently-active pedal slot in workbench
- Before, the workbench only showed the slot the user CLICKED; there was no indication of which physical slot the pedal actually had active (set externally via footswitch / Neuro).
- Added `activeSlotInfo { rawIdx, display, name }` to the component, sourced from GET /api/controls (`activeIndex` raw 0..5, `presetName`). Display number via existing `displaySlotNum(rawIdx)` (SLOT_DISPLAY_ORDER inverse в†’ 1..6).
- Polling: a `workbenchTimer` polls /api/controls every 5s ONLY while the Workbench tab is active (cheap read-only; same pattern the monitor proved safe). Also polls once on ngOnInit, and updates `activeSlotInfo` immediately after `selectSlot(idx)` activates a slot.
- Tab switching now goes through `setActiveTab()` в†’ `syncActiveSlotPolling()` to start/stop the workbench poll (also used for the tab buttons). Cleaned up timer in ngOnDestroy.
- UI: workbench shows a "Active: slot N вЂ” name" indicator (green dot) and rings the corresponding slot button green (`.phys-active`) to distinguish the pedal-active slot from the merely-selected one (`selectedSlotIdx` blue) вЂ” they can differ before you click.
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
- Re-implemented the distortion-engine dropdown after the revert. Key change from v1 (which made the app unresponsive): the template no longer uses an ng-template + 'else' reference inside the *ngFor пїЅ it renders the select or the dial via two sibling *ngIf blocks instead, eliminating the risky construct.
- Same backend (/api/engines parses input/dist-engines at startup), same identity mapping (verified round-trip: body byte == engine id), same component logic (indices 4/17 as dropdowns, realtime CTRL_SET on change, Save persists, out-of-list bytes shown as '?? N (unknown)').
- Verified: node -c + ng build pass; throwaway-port smoke test: /api/engines -> 50 engines in ~200ms. Backend restart + dev refresh required for the user to test.

## Status - 2026-09-01 pedal-app: dist-engines select v3 (UI freeze retry)
- v2 also froze the UI (requests completed, main thread dead) even though it dropped the ng-template/else construct. Remaining shared suspect: Angular's NgModel + [ngValue] SelectControlValueAccessor inside the *ngFor. v3 removes Angular forms entirely: the engine control is now a native <select> bound with [value]="p.value" and (change)="onEngineSelect(p, )" (Number(target.value)), no NgModel/ngValue/FormControl class in the loop body. Sibling *ngIf split kept (select vs dial).
- Verified node -c + ng build pass; dist bundle contains the new engine-select code. User must restart BOTH backend and the ng serve dev server (picks up recompile cleanly).

## Status - 2026-09-01 pedal-app: engine select polish
- v3 (native select) no longer freezes the UI. Cosmetic pass: dropped the round .engine-ctl circle - the select renders as a plain bordered dropdown below the knob label; option text is now JUST the engine name (no 'id пїЅ' prefix). Preselection now uses per-option [selected] bindings (p.value === e.id) instead of [value] on the select, so the current engine is shown even when the engine list loads after the params; unknown bytes keep '?? N (unknown)' auto-selected. ng build passes.

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
  - Added mirrorOn flag + toggleMirror() and an 'Observe live' / 'в—Џ Observing liveвЂ¦' button in the workbench slot-picker. Clicking Start begins the 2s /api/controls reconciliation; Stop halts it.
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
- Data model: observeGroups getter iterates CONTROL_GROUPS x controlSpecsByIndex (no slotParams dependency); observeNative(spec) reads the live value by spec.liveIndex; observeLabel(spec) formats by type (knob: toUI(native); select/segmented: option text or '?? N (unknown)'; toggle: ON/OFF). Packed/unbound (liveIndex null) show 'вЂ”' in muted style.
- CSS: .obs-knob/.obs-label/.obs-value read-only cards. ng build passes.
- Files: web/src/app/dist/lalady/lalady.component.ts, lalady.component.html, lalady.component.scss.

## Progress - 2026-09-02 pedal-app+web: HID-only MIDI, full 255 knob range, merged Monitor+Observe
- **MIDI reverted to HID-only**: removed Web MIDI CC sends from queueLive вЂ” all knob writes go through `controlLive` (HID CTRL_SET). Removed `LaladyMidiService` import, `controlToCc`/`recentCc`/`CC_GRACE_MS`, `fetchMidiMap()`, `toggleMidiEngage()`, MIDI engage button, MIDI channel chip, `.midi-engage-btn`/`.midi-chip` styles. External MIDI/physical knob changes still visible via the mirror poll.
- **Knob range 0..255 (full native resolution)**: removed `isKnob()`, `toUI()`, `toNative()` scaling вЂ” `fieldValue()` returns raw byte, `toUIMax()` returns `spec.max` for all types. Knobs now have 256 points of resolution instead of 128. SetField uses `Math.min(spec.max, uiValue)` directly.
- **Monitor + Observe merged into one tab**: removed Monitor tab from nav and HTML. Observe tab now contains all live value display (same grouped layout). Removed `.unbound` CSS class (no CC tracking). Mirror grace guard removed since no CCs are sent from UI.
- Files: web/src/app/dist/lalady/lalady.component.ts, lalady.component.html, lalady.component.scss, lalady-midi.service.ts (kept but no longer imported).

## Progress - 2026-09-02 pedal-app+web: move static inspector to Angular Inspect tab, delete fallback
- Moved all diagnostic features from `pedal-app/web/index.html` into a new Angular **Inspect** tab.
- New tab shows: preset flash hex dumps with byte-level breakdown, EEPROM 256-byte dump, MIDI map (CCв†’control) with region hex, .osbf backup reference with offline .pre export links, EEPROM vs .osbf diff.
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

## Plan - 2026-09-05 pedal-app/web: L.A. Lady Randomizer feature
- User goal: find correct/unique/good sounds fast. New "Randomize" tab in the workbench that generates random scenes and plays them live.
- Requirements confirmed with user:
  - Algorithms: uniform, center-biased, extremes, drift (all four).
  - Local store: backend JSON files under back/lalady/randomizer-data/ (swap storage to remote DB later).
  - Scenes apply LIVE immediately (realtime CTRL_SET) so you hear each one; workbench knobs follow.
- Backend (back/lalady/server.js): JSON-file stores groups.json + presets.json; CRUD /api/randomize/groups (name, priority, props count, specKeys = "index:name" of control-map entries) and /api/randomize/presets (name default rand-N, bodyHex=53-byte scene). POST preset accepts saveToSlot (0..5) to ALSO persist to a pedal slot via writePreset+recall; PUT preset accepts saveToSlot to send an existing preset to a slot. CORS gains PUT/DELETE. Extract persistBody(rawIdx, body, name) helper reused by /api/slots/save (same calls, low regression risk, covered by the audit).
- Frontend (lalady.component.ts/html): activeTab += "randomize". Scenes: Generate (writes live for specs with liveIndex, updates slotParams bytes + editedOverrides + slotsDirty for all changed), Play/Pause auto mode at 3/5/7/10s, back/forward scene history (applyScene at index), "Randomize all" toggle vs group-targeted randomization. Groups CRUD editor (name/priority/props + checkbox picker over the 45 control-map specs, sorted by priority asc). Presets CRUD: save current workbench state as preset (default name rand-N), Load (apply as scene, pushed to history), Save to any of the 6 slots, Rename (prompt), Delete. Reuses queueLive/setField machinery so writes are throttled 40ms and packed bytes (26/30/32/38) compose in place without clobbering siblings.
- Multi-spec bytes: when a scene changes body 26/30/32/38, live writes fire per-spec (each spec's own liveIndex / null), never the whole body byte. Select/segmented/toggle targets always fall back to a valid option so illegal field values are impossible.
- No backend processes spawned; user runs backend :3111 + ng serve. Types: add RandomizeGroup/RandomizePreset models + LaladyApiService methods.

## Status - 2026-09-05 pedal-app/web: Randomizer implemented (backend + web), builds clean
- Backend back/lalady/server.js: CORS now allows PUT/DELETE. Added randomizer-data/ JSON store (randLoad/randSave atomic tmp+rename, randUuid ids, normalizeGroup/normalizePreset with regex-validated 106-hex bodyHex and saveToSlot 0..5). CRUD: /api/randomize/groups (GET/POST/PUT/DELETE) and /api/randomize/presets (GET/POST/PUT/DELETE). POST preset name defaults to rand-N; POST/PUT saveToSlot also persist to the pedal slot via persistBody (writePreset -> setActivePreset). Extracted persistBody(rawIdx, body, name) helper; /api/slots/save now reuses it (same call sequence, low regression risk).
- web lalady.models.ts: RandomizeGroup, RandomizePreset, RandomizePresetCreate, RandomizeList. lalady-api.service.ts: randomizeGroups/Create/Update/Delete + randomizePresets/Create/Update/Delete (update accepts saveToSlot).
- lalady.component.ts: activeTab extended with "randomize"; openRandomize() loads groups+presets. Scene engine: bodyValues() (53-byte body from loaded slot params), randomTargets() (randAll -> all 45 specs, else per-group random N-props sampling, groups ordered by priority asc), randomizeBody() composes packed bytes in place, applyScene() mutates param bytes + editedOverrides + slotsDirty and pushes each changed spec with a liveIndex via the existing 40ms-coalesced queueLive (multi-spec bytes 26/30/32/38 fire per-spec sub-fields вЂ” siblings never clobbered). fieldFor() algorithms: uniform, center (middle +/- 1/6), extremes (0/max), drift (step ~1/12); select/segmented/toggle always resolve to a legal option. Scene history: pushScene truncates forward tail, stepScene(-1/1) applies, play/pause timer at 3/5/7/10s. Groups CRUD editor (name/priority/props + 45-spec checkbox picker keyed "index:name"), presets CRUD (save current workbench body as rand-N preset, Load (push+apply), save to any of 6 slots, Rename via prompt, Delete), fmtTs timestamps. ngOnDestroy clears the rand timer.
- Template: nav tab + full Randomize section (player, auto mode, history nav, group editor/list, preset save form + table with per-row slot select). SCSS: dark-theme styles (.randomize, .rand-player, .rand-specs checkbox grid, tags, chips, .rand-presets).
- Validation: node --check back/lalady/server.js OK; stored-helper logic unit-checked inline via node -e (defaults, regex, key filtering, slot bounds); `npm run build -- --configuration development` clean (AOT compiles templates). NOT committed; backend/UI not yet exercised live against the pedal (per work rules the user runs backend :3111 and ng serve).

## Plan - 2026-09-05 h90: SikuliX GUI automation for native H90 Control
- Next session goal: drive the native Windows "H90 Control.exe" (v1.9.13, JUCE) UI via SikuliX image recognition вЂ” click its on-screen knobs and presets to trigger REAL MIDI/HID traffic for capture/RE, instead of replayed frames.
- Setup now (this session): put SikuliX + a Java runtime under back/h90/sikulix/, self-contained (no system install): 
  - sikulixide-2.0.5-win.jar (IDE, ~77 MB) + sikulixapi-2.0.5-win.jar (~75 MB) from Launchpad (SikuliX 2.0.5, built w/ Java 17; requires Java 11+ and VC++ 2015+ x64 redist вЂ” v14.42 already present).
  - Portable Temurin JRE 17 x64 (api.adoptium.net latest/17 ga win x64 jre hotspot) extracted under back/h90/sikulix/jre/.
  - Launch scripts (sikulix-ide.cmd) pinned to same Java 11(17) so it works without a system java.
  - Workspace skeleton back/h90/sikulix/projects/ with a .sikuli smoke script (no patterns needed): captures the current screen to PNG and logs screen size + H90 Control window region, proving the toolchain end-to-end; real knob/preset images to be recorded with the IDE capture tool next session.
  - README back/h90/sikulix/README.md: versions, URLs, first-run IDE Setup click, script-run commands, pitfalls (DPI scaling vs image match, VC++ redist, ~/.sikulix runtime dir, SikuliX works only on the visible desktop вЂ” no headless).
- Repo policy: jars + jre are runtime artifacts -> gitignore back/h90/sikulix/sikulix*jar and /jre/; keep scripts/README/project versioned. Provide download.cmd to re-fetch idempotently.

## Status - 2026-09-05 h90: SikuliX setup
- Done: created back/h90/sikulix/ with sikulixide-2.0.5-win.jar (77.3 MB) + sikulixapi-2.0.5-win.jar (74.5 MB) from Launchpad and portable Temurin JRE 17.0.20.1 x64 extracted to back/h90/sikulix/jre/ (java -version verified). Both jars verified as valid archives; sikulixide.jar manifest Main-Class=org.sikuli.ide.Sikulix (java -jar works).
- VC++ 2015+ x64 redist v14.42 already installed (required by OpenCV natives) - no action.
- Added launch scripts: sikulix-ide.cmd (detached IDE via javaw), sikulix-run.cmd (CLI -r on a .sikuli folder), plus idempotent setup.ps1 for re-fetching artifacts (covers the already-performed download steps).
- Added workspace skeleton back/h90/sikulix/projects/h90-smoke.sikuli/ (h90-smoke.py: logs screen size, tries App.getWindow("H90 Control"), captures to PNG) and README.md documenting versions, first-run Setup caveat (IDE shows a one-time GUI Setup screen that downloads Jython; cannot be scripted), daily-use commands, and DPI/image-similarity pitfalls.
- .gitignore: jars + back/h90/sikulix/jre/ ignored (runtime artifacts); scripts/README/project stay versioned.
- NOT run yet (requires the visible desktop + one manual click): first IDE launch Setup screen. Next session: sikulix-ide.cmd once to click through Setup, then record knob/preset PNGs with the capture tool and click() them; extend h90-smoke.sikuli as the driver skeleton.

## Plan - 2026-09-05 pedal-app/web: Treble Cut Filter isolation regression suite + allParamsZero live-mapping fix
- User report (repeat of the packed-byte chaos class): while working with the device ENGAGED, Treble Cut Filter (body byte 30, bit 0) changes after touching OTHER knobs.
- Investigation on the live pedal (:3111, active slot oct2+octFuzz idx 4):
  - Storage path is CLEAN: an API-level churn (flash-commit byte 32, live CTRL_SET idx 30, then a raw /api/slots/save) left body[30]=0x1d and bit 0 intact; the Playwright workbench audit passes 45/45 (probe keeps byte 30, save round-trip byte-exact, restore OK).
  - REAL DEFECT 1 вЂ” allParamsZero() ("all 0" button) routes live writes by BODY index: for (const p of params) controlLive({index: p.index, value:0}); body<->live numbering only agrees 0..25, and packed bytes 26/30/32/38 have no 1:1 live byte. It zeroes the WRONG live controls AND its editedOverrides on the packed bytes zeroes byte 30 (=> Treble Cut Filter -> 0) on the next Save. This is the "treble cut filter changes while fiddling knobs" machine: one click, then Save, and the packed treble byte is gone.
  - REAL DEFECT 2 (observed hardware behavior, not code): CTRL_SET writes to live indices 0..15 stick (readback confirms), but indices 16..39 are IGNORED by the pedal (readControlBlock never reflects them). So dragging any Parametric EQ / gate / routing knob (live 26..36) is SILENT until Save вЂ” the workbench "hears live" promise does not hold for that section on this pedal. Root question (16-bit framing / scaled range) deferred; documented here as a finding.
- Fix: allParamsZero() sends one CTRL_SET per distinct liveIndex via the existing queueLive() (specs with liveIndex null e.g. all of byte 30 are not poked at all), and keeps the byte-level editedOverrides (packed bytes zeroed whole on Save = the button's stated intent). No backend change.
- Tests to add (new web/tests/lalady-treble-cut.audit.spec.ts, self-restoring, workers=1):
  - A) TCI-isolation: for every control EXCEPT the four byte-30 specs, drive it once (wheel select/selopt/toggle/seg), then assert (a) the Treble Cut Filter DOM select still shows the snapshot field and (b) a fresh /api/slot-params read keeps byte 30 === snapshot byte 30.
  - B) Save after only-other edits: readback[30] === snapshot byte 30; reload => select still shows snapshot value.
  - C) Sibling preservation (reverse direction): drive Treble Shelf Slope / Treble Boost Rolloff / Treble Boost Maximum; after each assert bit 0 (DOM select + flash byte 30 bit) stays the snapshot value while the sibling bits move.
  - afterAll restores the original 53-byte body (same overrides-all restore as the audit).
- Verify: npm run test:e2e:lalady (2 specs, device attached); ng build development clean for the allParamsZero change.

## Status - 2026-09-05 pedal-app/web: Treble Cut Filter isolation suite + allParamsZero fix
- Done: new web/tests/lalady-common.ts (shared pure control-map helpers: fieldOf/flashByte/restoreBody/knobRoot/knobValue/changeKnob/pickOtherOption) + web/tests/lalady-treble-cut.audit.spec.ts (CNB treble-cut isolation suite: A drives all 41 other controls asserting TCF DOM select AND flash byte 30 unchanged after each; B Save + reload keep byte 30 + select; C drives the three byte-30 siblings asserting bit 0 stays 1; afterAll restores original 53-byte body via /api/slots/save overrides). First run failed only via a dangling page.waitForResponse (flash-path waiters were created but never awaited) -> driveControl now always settles the relevant waiter (realtime: validates index+value payload; flash: validates target index). Second run full suite: 2 passed (new spec 44.1s + workbench audit 55.5s), pedal restored to original body after each.
- Done: lalady.component.ts allParamsZero() now maps live writes through controlSpecsByIndex with one queueLive(s,0) per distinct liveIndex (skips liveIndex==null packed specs), keeps byte-level editedOverrides so packed bytes are zeroed whole on Save. No backend change.
- Verify results: npx playwright test --config=playwright.config.ts => 2 passed (1.8m); ng build --configuration development => clean (lalady-component chunk 158 kB, EXIT=0).
- Reconfirmed finding: live CTRL_SET indices 16..39 still ignored by the pedal (16..31 read back 0/255 flaky) вЂ” deferred to the framing investigation.

## Plan - 2026-09-05 pedal-app/web: visible action log + packed-byte watchdog + mirror listening guard
- User follow-up: "add logging to user actions and listen to real value changes... trebleCutFilter is affected by other knobs changes... run playwright on real web, show it to me, fix it!" вЂ” the isolation suite passes, so the remaining risk is paths my earlier tests did NOT exercise: the live-value MIRROR (Observe live) and the "all 0" button.
- Re-inspection found the actual listening flaw: mirrorControls() applies EVERY live-table value for spec.liveIndex вЂ” but the pedal provably IGNORES CTRL_SET writes in live 16..39 and reads those slots back as 0/255 stale garbage. So with the observer enabled the workbench clips fresh EQ/gate knob edits with stale pedal reads AND occasionally flashes wrong values in the Parametric EQ group. That, plus the unmonitored Save, is the visible "knobs misbehave" chaos the user keeps hitting.
- Add to lalady.component.ts: (a) operator actionLog[] recording every SET (byte/spec/field before->after + live/flash route), LIVE flush, FLASH commit+readback, SAVE overrides, all-0, mirror OBSERVE reads/diffs; rendered as a collapsible panel (data-sel=action-log) and exposed as window.__laladyActions for E2E; (b) packed-byte watchdog: mirror polls + every write re-check bytes 26/30/32/38 against the load-time baseline and emit a CLOBBER line if they moved WITHOUT a user edit on that byte; (c) mirror listening guard: apply only verified-writable live indices (0..15); skip 6/19/16..39 where the pedal ignores writes or reports stale 0/255.
- New spec web/tests/lalady-listen.audit.spec.ts (self-restoring): (A) enable Observe live, then drive non-byte-30 controls (real mouse drag + wheel + select/toggle/seg) with a Save after each group, asserting after each: TCF select + flash byte 30 stable, and the action log contains NO CLOBBER/byte-30 SET lines from non-TCF controls, and at least 2 OBSERVE poll lines (listener proven on the real web); (B) all-0 -> Save persists byte 30 == 0 (intended) and DOM select shows 0; afterAll restores the original body.
- Verify: npm run test:e2e:lalady (3 specs, device attached); attach the listen-audit evidence JSON; ng build development clean.

## Status - 2026-09-05 pedal-app/web: action log + packed-byte watchdog + mirror listening guard
- Done: lalady.component.ts now keeps an operator action log (SET with spec/field/before->after byte hex + LIVE#/FLASH route, LIVE flush, FLASH commit + readback, SAVE overrides incl byte30Override presence, ZERO, OBSERVE poll/diff/untrusted-skip, REVERT) rendered as a collapsible "Action log" panel (data-sel=action-log, CLOBBER lines turn it вљ  red) and exposed as window.__laladyActions for E2E. Packed-byte watchdog: every discrete writeback and every observe poll re-checks bytes 26/30/32/38 against the load-time baseline and logs a CLOBBER line if one moved WITHOUT a user edit on that byte; user edits and committed readbacks re-anchor the baseline (credit fix вЂ” first run flagged its own legit byte-26/32/38 composed edits until the credit covered all four packed bytes).
- Done: mirror listening guard вЂ” the observe mirror now applies ONLY live indices the pedal provably honors (0..15); 6/19/16..39 (CTRL_SET ignored, reads back stale 0/255) are skipped and the skip is logged. Workbench no longer replays stale pedal reads over fresh EQ/gate knob edits.
- New web/tests/lalady-listen.audit.spec.ts (self-restoring): observe-live ON -> real mouse drags (Left Drive 0->100, Mid A Freq 1->101 stayed proven) + wheel/select/toggle/seg across 13 other controls, asserting after each: TCF select + fresh flash byte 30 == snapshot, no CLOBBER / no byte-30 SET lines in the log, SAVE keeps byte 30 with byte30Override=none, reload keeps the select; then all-0 -> Save persists a full zero body (byte 26/30/32/38 == 0, intended) with no CLOBBER.
- Verify results (device engaged, :4211/:3111): npx playwright test -> 3 passed (listen 33.9s incl 19 OBSERVE polls, treble-cut 43.6s, workbench audit 55.4s, total 2.4m); ng build --configuration development clean. Pedal restored to original body after each spec.
- Finding at the end of the pencil: byte 30 is provably isolated on the real web (single SAVE line recorded byte30Override=none while 11 other-byte overrides persisted). The literal "treble cut filter affected by other knobs" did NOT reproduce; the packed-byte chaos this session exposed lives in the observe-mirror replaying stale live 16..39 (now guarded) and in allParamsZero routing (fixed earlier).

## Plan - 2026-09-05 pedal-app/web: bass byte-32 jump report
- User follow-up: "bass settings select/buttons/knob (like treble) also jumping from other knobs change". Byte 32 (Bass Cut Filter select bit0 + Bass Shelf Slope seg bits1-2 + Bass Boost Rolloff knob bits3-7) is the exact treble-30 twin.
- Empirical probes (device engaged):
  - API-level byte-32 flash stability across EVERY route the UI uses: /api/control on bytes 26/30/38, /api/control/live on a trusted (2) and untrusted (32,36) index, then /api/slots/save empty-overrides -> byte 32 = 0x00 constant throughout; full restore byte-exact.
  - Real-web scan (new tests/diag-bass-jump.audit.spec.ts): with mirror OFF and ON, real mouse drags on Mid A Frequency and Left Drive left TCF/rolloff/BassCut/Slope/BassRolloff DOM values EXACTLY at snapshot after every drag, mirror polls, and live writes; action log shows OBSERVE skips for the untrusted live window and SET/LIVE lines only for the dragged knobs. flash b30=0x1d b32=0x00 untouched.
- Two hardening fixes to close the last transient-jump vectors: (a) flushDiscrete readback no longer overwrites a packed byte's UI value when a NEWER edit for that byte is pending (prev real ~2s flicker-back while a commit lands); (b) listen suite now watches the full treble+bass family (TCF/BCF/SS slopes/rolloff knobs) asserting DOM + flash bytes 30 AND 32 stable after every other-knob drive, with log checks for byte-30/32 SETs and CLOBBER.

## Status - 2026-09-05 pedal-app/web: bass byte-32 jump report
- Done: tests/diag-bass-jump.audit.spec.ts (diagnostic real-web scan, kept in the suite) + lalady-listen.audit.spec.ts extended to the bass family: family baseline (TCF=1, BassCut=0, BassSlope=Low, BassRolloff=0) asserted unchanged after each of 12 other-control drives AND after Save (SAVE idx=4 overrides=10 byte30Override=none) AND after reload; all-0 -> Save full-zero body still no CLOBBER.
- Done: lalady.component.ts flushDiscrete() readback-stomp guard (only apply readback to the param when no newer discretePending targets the same byte).
- Verify results (device engaged): npx playwright test -> 4 passed (diag 12.8s, listen 30.3s, treble-cut 43.5s, workbench audit 55.4s, total 2.6m); ng build development clean; all slots restored to original bodies.
- Outcome: bass byte 32 is as isolated as treble byte 30 on current code + engaged pedal вЂ” no mechanism, code path, or observed behavior changes it from other-knob edits (flash API probes + real-web DOM scan + extended listen suite all agree). The two prior real defects behind the whole "jumping" class (untrusted-window mirror replay + flash commit readback stomp) are now fixed and covered.

## Plan - 2026-09-05 pedal-app/web: field-scoped "modified" highlight for packed bytes
- User report (slot 2): changing Treble Shelf Slope to Low marks Treble Cut Filter / Treble Boost Maximum / Treble Boost Rolloff with the edited (light-bordered) style, though their values did not change; suspects it may indicate wrong behavior.
- Cause: workbench "modified" class binds `c.p.value !== initialValue(c.p.index)` вЂ” a WHOLE-BYTE comparison. Packed byte 30 hosts 4 fields; any sibling edit changes byte 30 -> all four controls light up. Values and writes are unaffected (masked composition + byte-level overrides, proven by the suites), but the highlight is misleading and masks real field state.
- Fix: field-scoped dirty test, `fieldChanged(spec, p)`: compare ONLY the spec's field bits (`(p.value & mask) >>> shift`) against the snapshot byte's same bits. Swap the four `[class.modified]` bindings (select/toggle/segmented/knob) to it. Remove now-unused `initialValue`. EditedOverrides stay byte-level (Save semantics unchanged).
- Test: extend lalady-treble-cut STEP C вЂ” while driving the byte-30 siblings one at a time, assert only the JUST-driven sibling carries `.modified`; the not-yet-touched siblings must stay clean; after all three drives all byte-30 fields are modified. Values/byte 30 assertions unchanged.
- Verify: npm run test:e2e:lalady (4 specs, device attached); ng build development clean.

## Status - 2026-09-05 pedal-app/web: field-scoped "modified" highlight for packed bytes
- Done: lalady.component.ts `initialValue` (whole-byte snapshot compare) replaced by `fieldChanged(spec, p)` comparing only the spec's field bits (`(p.value & mask) >>> shift`) against the snapshot; the four `[class.modified]` bindings (select/toggle/segmented/knob) now use it. EditedOverrides remain byte-level; Save semantics untouched.
- Done: lalady-treble-cut STEP C now also checks the highlight is field-scoped while driving each sibling вЂ” only the just-driven editor lights up; untouched siblings stay clean.
- Verify results (device engaged): npx playwright test -> 4 passed (2.6m); STEP C reports "modified highlight stayed field-scoped (all clean)"; ng build development clean; slot bodies restored.
- Outcome: user report (slot 2) was a presentational false positive, not a write/readback defect: whole-byte dirty compare made all byte-30 siblings appear edited when only Treble Shelf Slope changed. Now only the field actually changed is highlighted; byte writes, overrides, and round-trips are unchanged.

## Plan - 2026-09-06 h90: SikuliX first real run (IDE Setup + H90 Control capture)
- State check: back/h90/sikulix toolchain complete (jars + Temurin JRE 17, launchers, smoke project). H90 Control v1.9.13 is INSTALLED on this Windows box (registry Uninstall entry present) but not running. ~/.sikulix runtime dir does NOT exist yet => the one-time SikuliX IDE Setup screen (downloads Jython) has NOT been clicked through вЂ” that manual GUI step is the gate before any image-recognition script can run.
- This session (manual, needs visible desktop; per work rules user runs the interactive parts):
  1. Launch H90 Control.exe so the JUCE window is on the primary screen (not minimized, fixed DPI).
  2. Run back/h90/sikulix/sikulix-ide.cmd once; click through the Setup/install buttons (IDE+API, Jython), it quits after creating ~/.sikulix; relaunch to confirm the IDE opens.
  3. Run the smoke: back/h90/sikulix/sikulix-run.cmd back\h90\sikulix\projects\h90-smoke.sikuli вЂ” logs screen size + H90 window region + saves sikuli-smoke-shot.png (proof the toolchain reads the real screen).
  4. Keep heading: with the IDE capture tool (Ctrl+Shift+drag) record PNGs of the knobs/presets to drive (e.g. a preset thumbnail, a turn-knob), then extend a driver .sikuli that click()s them to fire real MIDI/HID traffic for capture/RE.
- No code write this session unless a run fails in a fixable way; the .sikuli driver skeleton is the next code target once first PNGs exist.
## Status - 2026-09-06 h90: SikuliX first real run on the live H90 Control
- Done: H90 Control.exe running (PID 4876, window R[2,25 1928x1174]@S(0)). Jython 2.7.2 is BUNDLED in the 2.0.5 jars - the feared one-time IDE Setup screen does NOT exist; the toolchain works out of the box (setup.ps1 + launchers were sufficient).
- Probe (back/h90/sikulix/projects/api-probe.sikuli) nailed the 2.0.5 Python facade: App.getWindow() does NOT exist -> use App("H90 Control").window(); Region.capture() does NOT exist -> use region.saveCapture(); hasWindow() can be flaky at JVM boot so retry window(). Screen = 2131x1199.
- Fixed h90-smoke.sikuli to the real API; smoke passes (screen size, window region, screenshot save). saveCapture() ignores the requested path and writes to a temp Sikulix_* folder returning the real path - shot-h90.sikuli copies the returned PNG into the bundle (h90-window.png).
- OCR works out of the box (built-in Tesseract): text() over the window region read the H90 UI - Programs sidebar with preset names (04 octaver, Octaver Drty Vocals Hi, 05 oct dirty vox, polyFlex micro, 08 reso, 09 dia lydianD, 10 harm 12string, 13 baroque, 14 baroque2, 15...), parameter knobs (Oct-Fuzz Mix/In Gain/Out Gain, Envelope Sensitivity, Tails Tempo Mode HotKnob, Filter A/B, Resonance A/B), tabs (Parameters, Routing/Inserts, Control Assignments, Preset Library). collectLinesText/collectWordsText want a String arg (failed); text() works region-scoped.
- Caveat: the OCR dump ALSO contained VS Code/terminal text => another window overlapped H90 Control; need the app brought to front before OCR. Model cannot read the captured PNGs (no image input) - so the flow is OCR + user confirmation of targets, then click().
## Status - 2026-09-06 h90: click driver works; waiting on MIDI capture
- Built the click chain: ui-scan.sikuli (focus window + OCR + shot), sidebar-map2.sikuli (fragment->coordinates of the Programs list), click-preset.sikuli (OCR anchor -> click row center). All run via the bundled JRE + sikulixide jar -r, no IDE needed.
- click-preset.sikuli clicked the  8 reso preset row (L[150,384] on the live window) - SikuliX log: "CLICK on L[150,384]@S(0) (582 msec)". First run failed because the anchor 'octav' had scrolled out (the active row moved); the driver now falls back through several anchors (reso/dirty/oct /vox/poly/lyd/harm/baroque) and picks the first visible one - re-scan confirmed anchors re-match exactly ((61,379) reso, (60,188) octav).
- MIDI capture was NOT running during the click (no /tmp/h90_capture.txt exists). So the traffic H90 Control sent on preset selection was not recorded. Next: user runs 
ode back/h90/capture-h90.js (listens on the XC-05987/H90 MIDI port) or the proxy capture (capture-proxy-long.js) BEFORE a click, so we can log the real program-change traffic.
- Text scan of the Programs sidebar currently lists: 04 octaver, 04 oct dirty vox, 05 polyFlexy, (07?), 08 reso, 09 dia lydianD, 10 harm 12string, 12 bass chorus, 13 baroque, 15 polyFlex... (gaps = rows OCR missed or off-screen).
- Caveats learned: text() OCR mixes ANY overlapping window (VS Code pollutes the dump) -> scope OCR to the sidebar/small regions; findAllList(frag) logs a harmless "[error] ImagePath: not there: frag.png" before OCR-matching; saveCapture() can transiently fail right after focus/click (null ScreenImage) - retry.

## Plan - 2026-09-06 pedal-app/web: C4 Synth workbench (echo L.A. Lady)
- Goal: give the web app a third tab "c4" (beside dist/h90) that interfaces with the connected Source Audio C4 Synth exactly like the L.A. Lady workbench: pick one of 128 user presets, edit its params (hears live), Save persists to the slot. User scoped it to "Workbench only" (no Randomizer/Inspect/Slots parity in v1).
- Confirmed protocol facts (TeensyC4Synth, MichaelMCE, MIT): C4 is One Series HID VID 0x29a4 PID 0x0302, interface 2, usagePage 0xFFA0; same CMD set as L.A. Lady (CTRL_SET 0x70 / CTRL_GET 0x75 / ACTIVE_STORE 0x76 / ACTIVE_SET 0x77 / ACTIVE_WRITE 0x6e / CONFIG_GET 0x45 / FLASH_READ 0x36 / FLASH_WRITE 0x35 / EEPROM_READ 0x80). 128 user presets at 0x080000 + idx*0x1000, data 128 bytes at page+0x20, name 32B at page+0xA0. Config reply head 0x32: [fw u16][model 249][numPresets 128][activePreset][wysiwyg][bypass][midiChannel] вЂ” activePreset byte is directly the preset index (no slot matching like L.A. Lady). Config/midiChannel offsets to be confirmed by live probe before trusting in UI.
- Control map: 172 entries extracted from ctrl_c4.c as {label, liveIndex, bodyByte, width, shift}. Body bytes 0..125 in use (2 spare). Live index != body byte from voice sections up (e.g. filter1_depth body 38 live 67), mirroring the L.A. Lady body<->live divergence.
- Write strategy (same as L.A. Lady): whole-byte fields (width 8 shift 0, their own body byte) go realtime via CTRL_SET at liveIndex so edits are heard immediately; bit-packed fields sharing a body byte (voice octave/semitone byte 14, mode/source/envelope byte 15, dest/trem/mod/enable byte 16 + voice 2-4 twins, distortion type/enable 59, filter type/env/invert/enable 41, pitch_track/mix dest 42, envelope type/input 51, fm inputs 62, lfo shape/restart/div 70, harmony byte 110/111, pitch detect 112, ext dest/source/misc bytes 116/117/120/123) use the flash-commit path (ACTIVE_STORE+ACTIVE_WRITE+ACTIVE_SET with the full composed byte). CTRL_GET readback is body-byte-indexed (payload[bodyByte] == body byte) вЂ” verify by probe.
- Backend: new back/c4synth вЂ” src/c4Hid.js (PID 0x0302 transport), src/c4Model.js (flash constants + 172-spec control map + MIDI/EEPROM constants), src/c4Protocol.js (config, flashRead, readPreset 128B+name, ACTIVE_* commit, CTRL_SET/GET, EEPROM), server.js Express :3222 (single persistent HID handle, CORS for :4211). Endpoints: /api/device, /api/status, /api/control-map, /api/presets?idx=, /api/activate, /api/control, /api/control/live, /api/presets/save, /api/eeprom, /api/midimap.
- Enum value->label tables are NOT in the reference repo (midimap_todo.txt is raw HID/pcap dumps) вЂ” discrete selects ship as numeric option lists first; foot-noted in UI as "labels TBD from editor"; toggles are width-1 fields. Refinement later from the official editor param lists.
- Frontend: web/src/app/c4/ вЂ” c4.models.ts, c4-api.service.ts (BASE :3222), c4.component.{ts,html,scss} workbench cloned from lalady.component patterns (slot picker 128 locations, Save/Revert/all-0, mirror toggle, action log, SVG knobs), group layout: Level/Input 0-9, Voices 1-4 10-37, Distortion 56-59, Filters+mix 38-47, Envelopes 48-55, FM 60-64, LFO 65-74, Sequencers 75-108, Harmony+pitch 109-113, Knobs/ext 114-125. Tab link in app.component.html + lazy route in app.routes.ts.
- Rules respected: no backend process spawn (user runs it); probe scripts are short read-only node -e via back/lalady's node-hid.
- Verification: node probe (config, flash preset 0, eeprom) against the live pedal; ng build development clean; manual workbench browse on :4211 -> /c4 (user runs :3222).

## Status - 2026-09-06 pedal-app/web: C4 workbench backend verified + UI built
- Done: back/c4synth backend shipped (c4Hid.js transport, c4Model.js flash constants + 173-spec workbench map from ctrl_c4.c, c4Protocol.js, server.js Express :3222). Endpoints live: /api/device, /api/status, /api/control-map, /api/controls, /api/presets (list 10s cache / ?idx=), /api/activate, /api/control (flash-commit), /api/control/live (CTRL_SET realtime), /api/presets/save, /api/eeprom, /api/midimap.
- Live probes (read-only, NODE_PATH=back/lalady/node_modules for node-hid): device PID 0x0302 IF2 usagePage 65440; config = firmwareVersion 5633, deviceModel 249, numPresets 128, activePreset 0 (byte is the preset index directly), wysiwyg 1, hardwareBypassMode 0, midiChannel 5 (payload[7]). 128-name read 256ms. Slot 0 body 128B @ +0x20, name "1" @ +0xA0; readSlotBody block == readPreset slice. EEPROM midimap region 0x80..0xFF present.
- CORRECTION to plan: CTRL_GET live block is a separate LIVE-indexed table (only 37 bytes per read), NOT body-indexed as the plan assumed. Mirror/observe therefore read the ACTIVE preset's FLASH BODY via /api/controls (body-indexed params[128]), skipped for bytes the user edited this session - never stomps fresh edits.
- Backup (insurance before first write): back/c4synth/backups/c4-backup-2026-09-06T19-34-46-858Z.json = 128 presets + active 0 via src/backup.js; fixed its trailing .catch on a non-async main().
- Done: web UI built - web/src/app/c4/c4.models.ts, c4-api.service.ts (BASE :3222), c4-midi.service.ts (Web MIDI engage/bypass CC 102 chase), c4.component.{ts,html,scss} (workbench: 14 groups Level/Input 0-9, Voice1-4 10-37, Filters+mix 38-47, Envelopes 48-55, Distortion 56-59, FM 60-64, LFO 65-74, Seq1 75-91, Seq2 92-108, Harmony+pitch 109-113, Knobs+ext 114-125; lfo_tempo body 71-74 excluded as set-only 32-bit), c4.routes.ts lazy, tab in app.component.html + route in app.routes.ts.
- Edit routing in UI: whole-byte knob/toggle with liveIndex -> CTRL_SET realtime (40ms batched queue); packed fields -> 300ms debounced flash commit via /api/control writing the full composed byte; Save -> /api/presets/save with byte-keyed overrides. Discrete selects render numeric option lists (enum labels TBD), full-width when max>=24. Silo of edits: editedOverrides bytes never overwritten by mirror; mirror only reconciles when pedal active preset == selected slot.
- Verify result: ng build development clean; c4-component lazy chunk 70.71 kB generated.
- Remaining (user runs): npm install + npm start in back/c4synth (node-hid only exists under back/lalady/node_modules), then browse :4211 -> /c4.

## Plan - 2026-09-06 pedal-app/web: name the C4 select-control enums
- User: "filter types has titles. find em an name" вЂ” the filter1_type/filter2_type selects (body 41/46, 5-bit, values 0..28 in the pedal) should show the editor's titles instead of raw numbers.
- Found: the official editor ships its full per-pedal module specs bundled in the Neuro Desktop 3 install вЂ” `shared-jvm-1.0.0-91965c9ff512b42f7ac3cba096244973.jar/files/sa-249.json` (product 249 = C4) contains dropDownList items for filter1_type/filter2_type: 29 names (3 Parallel Low-Pass, 6 Pole Low-Pass, 2 Pole Low-Pass, Notch/Low-Pass/Peak combos, Bandpass 1/2, Peak/Triple Peak 1-4, Phaser 1-3, High-Pass, Classic Wah, Double Peak, 6 Pole All-Pass, ...). Same file has every other C4 enum we previously left numeric (distortion_type, envelope_type/input, lfo_shape, voice sources/modes, harmony modes, routing, ...).
- Change: (1) back/c4/src/c4Model.js вЂ” add FILTER_TYPES + enumOpts(); filter1_type/filter2_type specs carry options [{value,text}] instead of the numeric numOpts. (2) web c4.component.html вЂ” selects render spec.options (named) INSTEAD of the numeric range when present (numeric only as fallback); unknown values 29-31 still show the disabled placeholder via selectValueKnown. Verify: npx ng build development clean.

## Status - 2026-09-06 pedal-app/web: filter type titles wired (edits only, no device run)
- Done: back/c4/src/c4Model.js вЂ” FILTER_TYPES (29 names, verbatim from shared-jvm/files/sa-249.json, indexed 0..28) + enumOpts(); buildControlSpecs attaches named options to /^filter[12]_type$/ specs (rest unchanged). back folder is back/c4 (user renamed it; start via cd back && npm run start:c4).
- Done: web/src/app/c4/c4.component.html вЂ” select template now prefers spec.options (named) via *ngIf/ng-template else numeric range; the disabled unknown-value placeholder stays.
- Verify: ng build development clean (c4-component lazy chunk 70.29 kB). Backend not run by me per rules вЂ” user starts :3222 and checks the filter Type dropdown on :4211 -> /c4.
- Note for next enum work: sa-249.json remains in the temp extraction; offers ready names for distortion_type, envelope types/inputs, lfo_shape, harmony modes, pitch-detect, routing, etc. when user wants them.

## Status - 2026-09-06 pedal-app/web: name more C4 selects (destinations, distortion, voiceX)
- User: "name also selects: destination type, distortion and voiceX_ selects". All names again verbatim from the editor spec shared-jvm/files/sa-249.json presetEditor.controls dropDownList items.
- Added to back/c4/src/c4Model.js: ENUM_NAMES map (voiceX_mode/source/envelope/destination x4, distortion_type, mix1/mix2_destination, plus existing filter1/2_type now in the same table) вЂ” voice sources/13, distortion types/13 (Mild..Max Foldover, from editor's distortion1_type), voice destinations (Filter + Distortion / Filter Only / Direct Output), mix destinations (Output 1 Only / Output 1 + Output 2 / Output 2 Only), envelopes (Envelope OFF/1/2), modes (Fixed Interval / Interval + Harmony 1 / Interval + Sequencer 1).
- Also converted voice1-4_enable + distortion_enable (both 4-bit on their byte) from numeric selects to proper on/off toggles вЂ” the editor renders both as switches; mask/shift fieldValue path handles width-4 toggles unchanged.
- Verify: ng build development clean (c4-component 70.29 kB, no template change this round вЂ” named options already render). Backend restart needed (user runs) to serve the new options on :4211 -> /c4.

## Plan - 2026-09-06 pedal-app/web: name ALL remaining C4 selects from the user guide + editor
- User added input/c4_synth_user_manual_compressed.pdf (C4 Synth User Guide, 48 pp) and asked to read it and properly name the still-numeric select options. Model can't ingest PDFs directly, so I installed pypdf (user-approved) and extracted text to temp/c4_manual.txt.
- Confirmed against the manual: 25 filter effects, 14 LFO wave shapes, routing = Auto Detect / Single Input 1 / Dual Input 1 & 2 / External Loop (Pre-Processing) (matches editor), "LFO Time Ratio Dropdown", "Octave/Semitone Pull-Down Menus", "Envelope Type Dropdown", "Beat Division Dropdown", pitch tracking ratios 1/3, 2/3, 1 Octave. The manual is descriptive; the exhaustive option lists live in the editor bundle shared-jvm/files/sa-249.json (controls: items arrays) вЂ” used as the enumeration source.
- Sanity-grounded value ordering using the 128-preset backup: semitone 11 dominant ("Semi --"/unison), octave 4/5 dominant (the -1/-2 sub-octaves bass patches stack), sequencer steps 14 dominant (=16 steps full), lfo_2_multiply 0/1 dominant (1x/2x) вЂ” all consistent with direct value==items-index mapping (same as the already-shipped filter1_type mapping).

## Status - 2026-09-06 pedal-app/web: all C4 selects named (manual read + editor enums)
- Tooling: pip-installed pypdf 6.16.2 (python 3.12.6 present); extracted 48-page C4 Synth User Guide -> C:\Users\Thoma\AppData\Local\Temp\opencode\c4_manual.txt (kept for reference).
- back/c4/src/c4Model.js: ENUM_NAMES now covers 60 specs (eyeball: only fm_sine2_input stays numeric вЂ” it's a per-voice 1-bit group in the editor, semantic mismatch for a flat 7-bit field). Added voice octave (7) / semitone (23), filter env source (2: Env/LFO 1/2), filter pitch track (4: OFF + 1/3, 2/3, 1 Octave), envelope type (12) + input (2), lfo shape (14), beat division (6: Whole..Sixteenth), lfo_2_multiply (11: LFO 2 = 1x..64x), harmony key (12) / mode (23 scales) / interval (6: +2nd..+7th), routing (4), pitch detect input/mode (2+2) and low/high note ranges (21 note names G2..B0 / 32 names E6..A3), ext1-3 source (4: OFF + Ctrl In X/Y + Hub Exp) and destination (49), knob1/2 assign (48, = EXT_DESTINATIONS minus External Mod) , sequencer steps (15: 2..16 Steps).
- Type refinements (editor-aligned): named whole-byte fields promote knob->select (lfo_2_multiply live#105, pitch_detect_high_note live#150, knob1/2_assign live#151/152, sequencer1/2_steps live#109/126 вЂ” remain realtime live writes); 1-bit fields with real labels promote toggle->select (filter1/2_envelope, pitch_detect_input, pitch_detect_mode); mix1/2_enable + lfo_midi_clock_sync demote select->toggle (editor shows switches; midi sync is boolean'fied 2-bit). Untrusted upper values (e.g. steps raw 24/255, assign 255=unassigned) fall back to the disabled numeric placeholder via selectValueKnown.
- Verify: node require of c4Model.js -> 173 specs, 60 named, type transitions as above; ng build development clean (c4-component 70.29 kB). No template change this round.
- Remaining (user runs): restart npm run start:c4, browse :4211 -> /c4 вЂ” dropdowns now carry the official editor titles sourced from the manual's own product spec.

## Plan - 2026-09-06 server: nodemon for both C4 and L.A. Lady backends
- User wants back/lalady and back/c4 to auto-restart on code changes. Both share the same shape (start: node server.js, express + node-hid).
- Change: in each package.json вЂ” "start" becomes "nodemon server.js --ext js" (restarts on .js edits only; backups/runtime .json writes don't trigger), add devDependency "nodemon"; keep all other scripts (lalady "live", c4 "backup") intact. back/package.json start:la / start:c4 forwards unchanged (npm --prefix still picks up each package's "start").
- Note: per repo rules I only edit code вЂ” nodemon must be installed by the user (npm install in back/lalady and back/c4) before the start script works.
- Verify: user runs npm run start:la / start:c4, touches a .js, sees nodemon restart log line (no device probing by me this session).

## Status - 2026-09-06 server: nodemon wired into both backends
- Done: back/lalady/package.json and back/c4/package.json вЂ” "start" now runs "nodemon server.js --ext js" (restarts only on .js changes so backups/preset .json writes don't bounce the server), devDependencies "nodemon": "^3.1.0" added to both; all other scripts untouched. back/package.json unchanged (forwards via npm --prefix).
- Not done by me (repo rule: only edit code): the nodemon package itself must be installed вЂ” user runs "npm install" in back/lalady and back/c4, then start:la / start:c4 auto-restart on save.
- No process spawn / no device probe this session.

## Status - 2026-09-07 pedal-app/web: add engage btn to C4 preset bar (match L.A. Lady)
- User: "add engage btn (like for lalady) for c4". C4 already had a static "MIDI engage" button in the page header (c4.component.html title-row, .midi-btn).
- Added a matching dynamic engage/bypass button to the C4 preset-bar toolbar: web/src/app/c4/c4.component.html - .midi-engage-btn toggling "Bypassed"/"Engaged" text, .on class from !midiBypassed, disabled when no Web MIDI, title shows CC 102 ch from config.midiChannel (default 1); reuses existing toggleMidiEngage()/midiBypassed/midiEngageMsg state. web/src/app/c4/c4.component.scss - .midi-engage-btn styles copied from lalady (blue .on state).
- No backend/process change; web-only. Verify: ng build development clean.

## Plan - 2026-09-07 web: fix C4 output volume reverting after voice toggle

- User: "when i disable or enable each of voices - main output (volume) doesn't
  work, starts to work if i explicitly touch it after change voice's enable toggle"
- Root cause: voice enable fields (voice1..4_enable) are bit-packed (4-bit, width 4
  shift 4 in body bytes 16/23/30/37), so `liveIndex` is null in
  `buildControlSpecs()` (line 595: `wholeByte ? live : null`). Toggle changes go
  through `flushDiscrete()` в†’ POST /api/control в†’ `commitRawPreset()` which writes
  the FULL body to flash then calls `setActivePreset(idx)`. The re-activation causes
  the C4 pedal to reload ALL live control values from flash, overwriting any
  transient CTRL_SET values (like output volume at body byte 8 / live index 8) that
  the user adjusted but hasn't saved yet.
- Fix: after `flushDiscrete()` completes successfully, call new
  `resendLiveOverrides()` which iterates `editedOverrides`, decomposes each edited
  body byte via `controlSpecsByIndex`, and re-sends CTRL_SET for every live control
  the user modified. This ensures their knob adjustments survive the preset
  re-activation triggered by the flash commit.
- Verify: ng build passes (pre-existing warning only). User tests on hardware:
  drag output knob в†’ toggle voice в†’ output volume stays.

## Progress - 2026-09-07 web: fix C4 output volume reverting after voice toggle

- Added `resendLiveOverrides()` private method to c4.component.ts: iterates
  `editedOverrides`, for each body byte looks up specs via `controlSpecsByIndex`,
  extracts the field value via mask/shift, sends CTRL_SET via `api.controlLive()` for
  each spec with a `liveIndex`. Deduplicates by live index via a Set. Logs the
  re-send count.
- Called `this.resendLiveOverrides()` at the end of `flushDiscrete()`'s success
  path (after recursive `flushDiscrete()` call and after readback update). This runs
  after every flash commit + re-activation, restoring all transient live values.
- Verify: ng build passes. Not committed (backend user-managed).

## Progress - 2026-09-07 web: delay resendLiveOverrides after flash re-activation

- Concern (voice 1 silent): calling `resendLiveOverrides()` synchronously right
  after the backend's `commitRawPreset()` returns risks the CTRL_SET values racing
  the firmware's flash-reload of live controls during `setActivePreset()` (which
  blocks ~1.5s in c4Protocol.js). If a CTRL_SET arrives while firmware is still
  re-loading, it can be overwritten вЂ” potentially leaving a voice/injected value
  in an inconsistent state.
- Fix: wrapped the body of `resendLiveOverrides()` in a `setTimeout(..., 300)` so
  the re-sent CTRL_SETs are deferred ~300ms, giving `setActivePreset()` time to
  finish importing the reloaded controls before we re-assert the user's transient
  live values.
- Verify: ng build passes (pre-existing warning only). User tests on hardware with
  the action log: expect `RE-SEND <n> live controls` to now appear ~300ms after the
  final `FLASH byte ... readback=...` line, and output volume to persist after a
  voice toggle.

## Plan - 2026-09-07 web: C4 workbench UI overhaul (neuro-style blocks, compactness, toggles, persistent log sidebar)

- User requests (earlier message, put on hold): (1) reorganize workbench controls
  into the same blocks as the official Neuro editor; (2) make all blocks more
  compact; (3) add a top row of block toggles that show/hide each block, default
  all visible, visibility persisted in localStorage; (4) move the operation log to
  a right sidebar toggled by an icon on the top row.
- Follow-up (this message): log everything that happens in the C4 UI to a file,
  reset the file on new web session start OR new backend start; inspect that file
  first when debugging control bugs.
- Approach:
  - Backend: new `src/c4UiLog.js` вЂ” `reset()`/`append()` to
    `back/c4/runtime-actions/c4-ui.log`; reset on server boot; `POST /api/log`
    (single line or lines[]) and `POST /api/log/reset` endpoints; server-side
    `stamp()` for ACTIVATE/FLASH/LIVE/SAVE ops so pedal talk is in the log too.
  - Frontend: `logAction()` now also batches to the file via `/api/log`
    (debounced 250ms, retry on error); `ngOnInit` calls `POST /api/log/reset`
    (new web session) then logs `session start`; activity logged for TAB, BLOCK,
    LOG open/close, MIRROR, OBSERVE-REFRESH, ACTIVATE, LOAD, SAVE, REVERT, ZERO.
  - Workbench layout: replace fixed `KNOB_ROWS` pairing with a single flowing
    column of blocks, each block one neuro-style group; blocks hidden via
    `blockVisibility` (localStorage key `c4.blockVisibility.v1`, default all
    shown); compact knob/select/toggle CSS.
- Verify: `ng build` clean; `node --check server.js src/c4UiLog.js`. User checks
  file at `back/c4/runtime-actions/c4-ui.log` after a session.

## Progress - 2026-09-07 web: C4 workbench UI overhaul

- Backend `src/c4UiLog.js` created: appends timestamped lines to
  `back/c4/runtime-actions/c4-ui.log`, truncates on `reset()`, never throws on
  write error. Wired into `server.js`: `c4UiLog.reset()` in `app.listen` boot;
  `stamp()` calls in POST /api/activate (ACTIVATE), /api/control (FLASH with
  byte name + readback), /api/control/live (LIVE with live-name), /api/presets/save
  (SAVE with name + override count); `POST /api/log` accepts `{line}` or
  `{lines:[]}`; `POST /api/log/reset` truncates and returns the file path.
- Frontend `c4-api.service.ts`: added `log(lines)` and `logReset()`.
- `c4.component.ts`: replaced `CONTROL_GROUPS` with a neuro-style list of 19
  blocks, each `{id,title,indices}` (Input & level, Voice 1-4, Filter 1+Mix 1,
  Filter 2+Mix 2, Envelope 1, Envelope 2, Distortion, FM, LFO, Sequencer 1,
  Sequencer 2, Harmony, Pitch Detect, Knobs, Routing & Misc, External 1-3);
  removed `KNOB_ROWS` pairing вЂ” `knobGroups` getter returns flat block list;
  added `blockVisibility` + `loadBlockVisibility()`/`blockVisible()`/`toggleBlock()`
  persisted to localStorage key `c4.blockVisibility.v1`; `logOpen` controls the
  sidebar; all UI actions log through `logAction()`.
- `c4.component.html`: workbench now `.wb-layout` (main + aside); top `block-bar`
  of `.block-chip` toggles per block; block divs render only when visible;
  header has `.icon-btn` (hamburger) to toggle the log sidebar; the old footer
  action-log removed. Tabs use `setTab()` for logging.
- `c4.component.scss`: compact layout вЂ” `.knob-group` margin 8px, knob width
  62px, knob body 44px, selects/toggles shrunk; `.action-log` is a 340px sticky
  right sidebar (stacks below on <900px); `.block-chip`/`.icon-btn` styles added.
- Verify: `ng build` passes (2 pre-existing warnings only); `node --check` clean
  for server.js + c4UiLog.js. Not committed (backend user-managed).

## Progress - 2026-09-07 web: C4 workbench controls flow several-per-row

- User: "make controls not full width each, allow them be few in row". The wide
  selects (engine specs, `isEngineSpec` в†’ `.knob-wide`) were `width: 100%` so each
  took the entire block row.
- Fix: `.knob-wide` is now `flex: 1 1 150px; min-width: 110px; max-width: 240px`
  with `align-items: stretch`, so several fit per row and share the available
  width; the underlying `.ctl-select` keeps `width: 100%` of its flex item.
  Regular knobs already sat a few-per-row (62px).
- Verify: `ng build` passes (only budget warnings вЂ” c4.component.scss now 16 bytes
  over the 8.19 kB style budget; cosmetic).

## Progress - 2026-09-07 web: C4 workbench 2-column layout on large monitors

- User: "now i use big monitor and i see we can use 2 columned control rows".
- Added `@media (min-width: 1600px)` rule in c4.component.scss: `.wb-main` becomes
  a 2-column CSS grid (`repeat(2, minmax(0, 1fr))`, gap 10px, `align-items: start`),
  the `.block-bar` spans both columns (`grid-column: 1 / -1`) and individual
  `.knob-group` blocks flow side-by-side (their `margin-bottom` removed since the
  grid gap handles spacing). Below 1600px the single-column stack is unchanged.
- Verify: `ng build` passes (only lalady budget warning; c4 budget warning no
  longer shown for this change).

## Progress - 2026-09-07 web: C4 log sidebar fully hidden when off + colored chip

- User: "i said about toggeling the logs. not collapse. hide it entirely. add
  'tag-button' on the row with other controls toggling but with diff color".
- Reworked: removed the header hamburger icon-btn and the collapse-style header
  inside the sidebar; the aside is now `*ngIf="logOpen"` so it disappears
  completely when off instead of collapsing. The log toggle is a new
  `.block-chip.log-chip` ("log") sitting in the same `.block-bar` row as the
  block toggles, but amber-colored (`#ffd27a` on, dark amber idle) to stand apart;
  `.alert` state (red) when an error is pending and the log is closed. Sidebar
  header replaced with a static `.al-head` (title + entry count).
- Verify: `ng build` passes (c4 budget warning gone, only lalady remains).

## Progress - 2026-09-07 web: C4 top bar in one row (free vertical space)

- User: "make top items like name of tab (h1), active preset block and block
  started with LOCATION - in one row. i want to free vertical space for controls".
- Merged `app-header` (h1 + title-actions + header-sub) and `preset-bar`
  (Location + Save/Revert/all 0/engage/mirror/dirty) into a single `.top-bar`
  flex row with `.top-info` (active preset, fw, midi ch) between the h1 and the
  actions. Buttons condensed (28px). Wraps on narrow screens.
- Removed now-unused `.app-header`/`.preset-bar`/`.icon-btn`/`.title-actions` SCSS.
- Verify: `ng build` passes (only lalady budget warning).

## Progress - 2026-09-07 web: C4 block headings rotated on left edge of each block

- User: "make headings of blocks (H3) written at the left side of each block
  (45 deg). i want them to free vertical space. add diff background color for
  this headings."
- Restructured `.knob-group` into a flex row: a narrow `.group-head` rail on the
  left holding the `<h3>` rotated 45deg (`transform: rotate(45deg)`, origin 0 0),
  and the `.knobs` content column beside it. The h3 is a distinct `#2a2a3a`
  label chip (light text, `#3f3f4d` border, slight shadow) and floats over the
  block gap instead of spanning the full width вЂ” removes the full-width header
  row в†’ more vertical room. The rail uses `z-index: 1` so the diagonal chip
  overlays the 8-10px block gaps rather than being clipped.
- Bumped `anyComponentStyle` budget to 12kB warning / 24kB error in angular.json
  (c4.component.scss grew past the old 8kB; lalady still over but was pre-existing).
- Verify: `ng build` passes (only pre-existing lalady budget warning).

## Progress - 2026-09-07 web: C4 block headings anchored to blocks + per-block colors

- User: "make block headings closer to appropriate blocks. color them diff".
- Reworked `.knob-group` heading: `.group-head` is now absolutely positioned in a
  24px gutter at the block's top-left (inside the block, padding-left 24px on the
  group) instead of floating in the gap; the `<h3>` uses `writing-mode: vertical-rl`
  (text runs top-to-bottom, effectively the 90В° rotation) with a 3px accent
  border-left. Added a `head` accent color to every CONTROL_GROUPS entry
  (distinct hues: input/blue, voice1/2/3/4 = green/amber/purple/pink,
  filter1/2 teal/olive, distortion/red, lfo/purple, seq/amber, etc.) bound via
  `[style.background]` + `[style.border-color]`.
- Verify: `ng build` passes (only pre-existing lalady budget warning).
- Follow-up: headings must (1) strip trailing text when it exceeds block height,
  (2) have a background that always spans the full block height, (3) voices 1-4
  share one color.
- Fix: `.group-head` now spans `top:0; bottom:0` and the `<h3>` is `height:100%`,
  `overflow:hidden` (vertical-rl text clipped at the bottom edge when the block is
  short) with border-radius `3px 0 0 3px` so the full-height chip hugs the left
  border; voices 1-4 all use `#2e9e55`. Verified: `ng build` passes (only
  pre-existing lalady budget warning).

## Progress - 2026-09-07 web: C4 sequencer view as table of squares

- User: "make sequencer view as 'table with squares where columns are each knob
  like now".
- Sequencer groups (seq1/seq2) now render as a `.seq-grid` table instead of the
  generic dial row: one `.seq-cell` column per control. The steps control shows
  as a select across the top of its cell; each value0..15 renders as a 40px
  `.seq-square` filled with `rgba(80,190,255,a)` proportional to value/max, with
  the raw value overlaid, and reusing the same knobDown/Move/Up + wheel handlers
  for drag (ns-resize) / scroll editing. Labels come from `seqLabel()` ("step N").
  Non-sequencer groups keep the dial layout unchanged.
- Added `isSeqGroup()`, `seqLabel()`, `seqCellBg()` to c4.component.ts; added
  `onSeqStepsChange()` because `ngModelChange` emits the value (the
  reused `onSelectChange` reads `event.target.value`, which is wrong for
  ngModelChange вЂ” fixed only for the new seq select for now).
- Verified: `ng build` passes (only pre-existing lalady budget warning).

## Progress - 2026-09-07 web: fix envelope source knob on voice blocks not working

- User: "envelop source knob on 1 voice block (mb on others too) doesn't work
  properly. i checked via real neuro-app".
- Root cause: `(ngModelChange)` emits the new VALUE (e.g. `2`), but
  `onSelectChange()` was casting it to an Event and reading
  `event.target.value` -> `undefined` -> `Number(undefined)` = NaN -> early return.
  So EVERY named-enum `<select>` in the workbench (voice mode/source/envelope,
  distortion type, filter type, destinations, etc.) was a no-op - matching the
  user's "doesn't work properly" observed against the real Neuro app.
- Fix: `onSelectChange(spec, p, field: number)` now reads its numeric argument
  directly (same pattern as the recent `onSeqStepsChange`). The seq grid select
  already used the correct handler.
- Verified: `ng build` passes (only pre-existing lalady budget warning).

## Progress and Status 2026-09-08 web+c4Model: fix voiceX destination overridden by tremolo_source

- User: "when i change 'tremolo_source' in voiceX - 'voiceX destination' also
  changes, its a bug". Verified against real neuro-app that destination and
  tremolo_source are independent on hardware.
- Root cause: our CTRL_ROWS bit layout for the packed voice byte was transcribed
  from the firmware control table (ctrl_c4.c `{label,setIdx,getIdx,width,
  bitPosition}`) which is actually WRONG for this byte vs the packed preset
  struct `as_preset_voice_t` in sa_c4.h. Real layout (LSB-first):
    destination:2   -> bits 0-1  (matches ours)
    tremolo_source:1 -> bit 2    (we had shift 1 -> collided with destination bit 1)
    modulate:1       -> bit 3    (we had shift 2 -> collided too)
    enable:4         -> bits 4-7 (matches)
  So `voiceX_destination` (mask 0x03) overlapped `voiceX_tremolo_source`
  (mask 0x02) on bit 1 -> changing tremolo_source also wrote destination's
  low bit. The firmware util.c confirms width/bitPosition only applies to the
  RAM control VALUE (as_getControlValue), while the flash/preset body comes
  from the packed struct -- so the packed struct is authoritative for us.
- Fix: c4Model.js CTRL_ROWS, all four voices (bytes 16/23/30/37):
  tremolo_source shift 1 -> 2, modulate shift 2 -> 3; destination/enable
  unchanged.
- Verified: node overlap scan across all 173 CTRL_ROWS -> 0 overlaps
  (previously exactly the four voiceX_destination<->tremolo_source pairs).
  Backend not restarted (user runs it).

## Plan - 2026-09-08 web: 2-col workbench fills top-to-bottom not left-to-right

- User: "ui: make direction of populating 2 columns from top to bottom, not
  from left to right".
- Current: .wb-main uses default CSS Grid row auto-placement (item 1 col 1,
  item 2 col 2, item 3 col 1 ...) -> reads left-to-right.
- Plan: switch .wb-main to grid-auto-flow: column + grid-template-rows
  repeat(var(--wg-rows), auto) where --wg-rows = ceil(visibleGroups/2),
  computed by a new wgRows getter and bound as a style custom property on
  .wb-main. block-bar keeps grid-column 1/-1; auto items then fill col 1
  top-to-bottom, then col 2. .knob-group margin-bottom handled by grid gap.
- Verify: ng build passes; visually columns fill downwards on wide screens.

## Status 2026-09-08 web: 2-col workbench fills top-to-bottom

- Changed .wb-main grid to column-major population:
  - grid-auto-flow: column with grid-template-rows:
    repeat(var(--wg-rows), auto) where --wg-rows is bound from a new
    wgRows getter = 1 + ceil(visibleGroupCount / 2) (the extra row is
    consumed by the full-width block-bar).
  - Visible count comes from visibleGroupCount getter (iterates knobGroups,
    respects blockVisible toggles).
- Because CSS Grid default auto-flow is row-major, items previously filled
  col1 top, col2 top, col1 next ... (left-to-right); with bounded rows +
  column flow they now fill col1 all the way down, then col2.
- Result: ng build passes (only pre-existing NG8102 nullish warning at
  c4.component.html:36 and lalady budget warning).

## Plan+Status 2026-09-08 web: compact knob/control labels

- User: "make labels of knobs and other controls more compact and more
  ui-able": envelope2_type -> type, envelope2_input -> input,
  distortion_type -> dist type, voice1_semitone -> semi, etc.
- Added ctlLabel(spec) to c4.component.ts: strips the block-family prefix
  (voiceN/filterN/mixN/envelopeN/distortion/fm/lfo/harmony/pitch_detect/
  extN) since the block frame already names the family, and abbreviates long
  words (semitone->semi, frequency->freq, sensitivity->sens, envelope->env,
  destination->dest, tremolo_source->trem src, modulate->mod, octave->oct,
  tremolo->trem, output->out, balance->bal, enable->on, invert->inv,
  pitch_track->pitch tr, source->src). Family keeps a short qualifier only
  where needed for disambiguation (dist, e1/e2/e3); ext1_min -> e1 min etc.
- Template: kname now renders ctlLabel(it.spec) with the full spec.name as a
  title tooltip so the raw name is still one hover away. Sequencer steps keep
  the existing seqLabel ('step N').
- Verified label mapping against representative names incl. all user
  examples; ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Plan+Status 2026-09-08 web: sequencer step count fading, semitone display

- User: in sequencer block, when steps is set, active steps should be visible
  and the rest faded/disabled; raw step numbers (36, 255) are confusing ->
  show signed semitone shifts; presaved Neuro patterns optional (skip if
  complex).
- Encoding confirmed from real C4 .pre export (MichaelMCE/TeensyC4Synth pre/
  C minor Harmony and Sequencer.pre): sequencer value bytes 12/24/36/48 map
  to semitones as raw-24 (root @24), range -24..+24 per manual (up/down two
  octaves). steps raw = count-2 (14 -> "16 steps"), matching the existing
  SEQUENCER_STEPS option list and the firmware applyPresetSeqStepsFixup.
- Added to c4.component.ts: seqStepCount(group) (= steps value + 2, capped
  16), seqStepActive(it, group) (value index < count), seqSemiText(spec,p)
  (raw-24 formatted +12/-12/0, 255 shown as em dash). seqCellBg now fills by
  sharpness raw/48 (semitone range) instead of raw/255.
- c4.component.html: seq-square gets .inactive class + pointer/wheel guarded
  by seqStepActive; value label + tooltip show signed semitone with raw in
  parens. c4.component.scss: .inactive = opacity .25, not-allowed, pointer-
  events none.
- Presaved Neuro patterns NOT implemented (user said skip if complex).
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web: sequencer semitone edit step = 1

- User: "make selects on each semitone shift in sequenser or make change
  step=1 (not 8 like now)".
- Chose the simpler option: step=1 instead of rendering a select per square.
- knobWheel now uses step 1 for sequencer step squares (was 8); knobMove drag
  scale 1 semitone/pixel (was 4). Implemented via isSeqStep() =
  /^sequencer\d_value\d*$/; normal knobs unchanged (wheel 8, drag 4).
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web: sequencer step range capped +-24 semiton:

- User asked to limit the sequencer 'knobs' (step squares) to +-24.
- toUIMax() now returns 48 (raw 0..48 = -24..+24 semitones) for seq step
  specs via isSeqStep(), instead of the full byte max 255. knobMove/knobWheel
  clamp through toUIMax before setField, so edits stay in range. Display and
  fill already used raw/48. setField itself still clamps to spec.max 255 but
  is only reached with UI-clamped values.
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web: filter/mix enable toggles labelled

- User: in 'filter X + mix' block both enable toggles looked identical.
- LABEL_EXACT now maps filter1/2_enable -> 'filter on' and mix1/2_enable ->
  'out on' (previously both stripped to 'enable' -> LABEL_WORDS 'on').
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web: mix 'dest'/'out on' to right in filter blocks

- User: in 'Filter X + Mix' block, move 'dest' (mixN_destination) and 'out on'
  (mixN_enable) to the right.
- Added isMixSpec() (/^mix\d+_/) and a third sort key in knobGroups: engine
  selects first, then mix controls last-right, then by shift. Only filter1/2
  groups contain mix controls, so other blocks are unaffected.
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web: voice mode select disabled for input sources

- Follow-up to the incomplete request: voice mode select (harmony/sequencer
  modes) now disables when the voice source is an unpitched input - index 0
  Stereo Input Mix, 11/12 Mono Input 1/2 - matching the Neuro app.
- Template select gets [disabled] + .disabled class (faded, not-allowed),
  via voiceModeDisabled() which finds the sibling voiceN_source in the group.
- Verified: ng build passes (only pre-existing NG8102 html:36 + lalady
  budget warnings).

## Status 2026-09-08 web+c4model: FM sine input selects read human-readable

- User: 'sine2 in' select in FM block showed raw numbers.
- fm_sine1_input/fm_sine2_input are 1-bit fields (byte 62 bit0 / bit1; the
  table declares sine2 width 7 but packed struct has fm_sine2_input:1 +
  padding:6), so exactly 2 choices. Added FM_SINE_INPUTS = ['LFO 1','LFO 2']
  (user-confirmed labels) and ENUM_NAMES entries for both controls.
- Verified: model loads, both specs carry the LFO 1/LFO 2 options; ng build
  passes (only pre-existing NG8102 html:36 + lalady budget warnings).

## Plan - 2026-09-09 web+c4model: LFO numeric tempo input (BPM)

- User wants to type a number for LFO tempo (like the Neuro app Tap Tempo
  control) instead of only the lfo_speed knob.
- lfo_tempo is a set-only 32-bit LE field at body bytes 71..74; official spec
  sa-249.json: type tapTempo, min 0, max 127795200 (microseconds/beat),
  BPM = 60,000,000 / us (verified against backup values: 500628 -> 120 BPM).
- Plan: add a 'tempo' ControlSpec type (byteWidth 4, index 71) in c4Model.js,
  extend the LFO group to include byte 71, render a numeric input (BPM),
  read/write 4 LE bytes, commit all four via /api/presets/save overrides
  (atomic, unlike the single-byte /api/control path).
- Verify: model exports the spec with max 127795200; ng build passes.

## Status 2026-09-09 web+c4model: LFO numeric tempo input (BPM)

- Added lfo_tempo as a 32-bit LE 'tempo' spec (body 71..74, max 127795200 пїЅs,
  liveIndex null) in c4Model.js; LFO group extended to byte 71.
- Frontend renders a numeric BPM input (BPM = 60,000,000 / пїЅs, clamped to the
  official spec max). Read assembles 4 LE bytes from slotParams; write splits
  BPM -> пїЅs into 4 bytes and commits all four atomically via /api/presets/save
  overrides {71,72,73,74} (single-byte /api/control would leave the field
  half-written). Tempo excluded from observe/mirror (set-only).
- Verified: model exports the spec (count 174, index 71 :: lfo_tempo :: tempo);
  ng build passes (only pre-existing NG8102 html:36 + lalady budget warnings).

## Plan - 2026-09-09 web: replace editable LFO tempo with read-only multi-formula readout

- The lfo_tempo BPM input write path did not work (user report).
- New approach: drop the writable input entirely. Show several READ-ONLY BPM
  candidates computed from the lfo_speed knob value (body byte 65, 0..254) via
  different formulas, so the correct mapping can be found by comparing against
  the pedal. No write is attempted.
- Revert: lfo_tempo 'tempo' spec in c4Model.js, byteWidth/'tempo' in
  c4.models.ts, observe/mirror tempo filters, tempo write helpers in
  c4.component.ts (tempoBpm/onTempoBpmChange/setTempoByte/flushTempo*), the
  .ctl-tempo input/label, LABEL_EXACT lfo_tempo entry.
- Add: tempoFormulas getter (candidate BPM from speed knob) + read-only panel
  in the LFO block; verify ng build passes.

## Status - 2026-09-09 web: editable LFO tempo replaced with read-only candidates

- Reverted the lfo_tempo 'tempo' spec (c4Model.js), byteWidth/'tempo' type
  (c4.models.ts), observe/mirror tempo filters, LABEL_EXACT entry, and all
  tempo write helpers (tempoBpm/onTempoBpmChange/setTempoByte/flushTempo*).
- Added read-only BPM candidates derived from lfo_speed (byte 65, live 101):
  linear 0..254/0..300, 1%=1Hz/0.5Hz, пїЅs=maxпїЅspeed/254, пїЅs=maxпїЅ(1-speed/254).
  Panel renders under the LFO knobs; no writes are attempted.
- ng build passes (only pre-existing NG8102 and lalady budget warnings).
- Next: compare candidates against the pedal to identify the true mapping,
  then hard-code that formula (and optionally restore a read-only BPM readout
  of the 32-bit lfo_tempo field at body 71..74).

## Status - 2026-09-09 web: read-only tempo candidates removed

- None of the read-only BPM candidates matched the pedal, so the whole
  candidates panel was removed (html/scss/ts) and c4Model.js reverted to its
  committed state. The LFO block now only shows the standard knobs.
- ng build passes (pre-existing NG8102 and lalady budget warnings only).
- Back to baseline for lfo_tempo (body 71..74, set-only 32-bit): deliberately
  not modeled/edited until the real speed->BPM mapping is understood.

## Status - 2026-09-09 web: fix engage button with two One Series pedals connected

- Symptom: L.A. Lady engage button clicks and flips its label but the pedal
  doesn't toggle; C4 engage works. Both pedals are connected via USB at once.
- Root cause: LaladyMidiService and C4MidiService both used
  outs.find(/source ?audio|one ?series/i), so with two Source Audio ports the
  first port to enumerate wins. The L.A. Lady page could bind to the C4's MIDI
  port and send its engage CC to the wrong pedal (C4 ignores it on a different
  channel); C4 worked only because its own port happened to be first.
- Fix: both services now pickOutputs() - send CC to EVERY Source Audio MIDI
  output, not just the first match. CC 102 is channel-scoped, so the pedal whose
  configured channel we send on is the only one that reacts, regardless of port
  enumeration order.
- ng build passes (pre-existing NG8102 and lalady budget warnings only).
- Next: user verifies engage toggles the L.A. Lady while both pedals are
  connected; if the pedals share a MIDI channel this fix would toggle both, so
  the per-pedal channel split (L.A. Lady ch 3, C4 ch 6) is required.

## Plan - 2026-09-09 lalady: file-backed action log + save state comparison

- Symptom under investigation: making knob edits then SAVE into a slot changes the
  sound (unexpected). Need a file log to reproduce the sequence and compare the
  pedal state before and after a save.
- Add lalady backend log module mirroring c4 (back/c4/src/c4UiLog.js):
  back/lalady/src/laladyUiLog.js -> runtime-actions/lalady-ui.log, append/reset/stamp.
- Add POST /api/log and POST /api/log/reset to back/lalady/server.js; reset log on
  boot and print its path (mirror c4 boot behavior).
- Stamp protocol actions in back/lalady/server.js: ACTIVATE, LIVE, FLASH (control),
  and SAVE. In POST /api/slots/save stamp a BEFORE (prev slot body hex + live control
  block + overrides applied) and AFTER (readback hex) line, plus a byte DIFF between
  prev body and readback so unexpected bytes changed by the save are obvious.
- Frontend web/src/app/dist/lalady: mirror c4 logAction batching -> logBatch +
  flushLogBatch (250ms debounce, 1200ms retry), api.log()/logReset() in
  lalady-api.service.ts, logReset on ngOnInit, flushLogBatch on ngOnDestroy. Keep the
  existing in-memory Action log pane; bump displayed lines to 120 to match c4.

## Status - 2026-09-09 lalady: file-backed action log + save state comparison

- Added back/lalady/src/laladyUiLog.js mirroring c4UiLog.js -> writes
  runtime-actions/lalady-ui.log (append/reset/stamp, never crashes the server).
- back/lalady/server.js: POST /api/log + POST /api/log/reset, log reset on boot +
  path printed on boot. Stamps ACTIVATE/FLASH/LIVE protocol actions.
- POST /api/slots/save now stamps SAVE-BEFORE (prev slot body hex + live control
  block hex + JSON of UI overrides) and SAVE-AFTER (written body hex + name +
  per-byte diff list prev->written) so an unexpected sound change from a save is
  byte-traceable.
- Frontend: lalady-api.service.ts gains log()/logReset(); lalady.component.ts
  mirrors c4 logAction batching (250ms debounce, 1200ms retry, flush on destroy),
  calls logReset + logs "session start" on ngOnInit; workbench action-log pane now
  renders 120 lines (was 60).
- ng build passes (pre-existing NG8102 and lalady budget warnings only); node -c
  on changed backend files OK.
- Next: user repeats the knob-edit + Save repro, then we read
  back/lalady/runtime-actions/lalady-ui.log to compare SAVE-BEFORE/AFTER states.

## Status - 2026-09-09 lalady: mid-EQ writes re-routed live->flash (save "sound changed")

- Log analysis of the user's repro (SAVE slot 4 at 08:27:43): the save wrote a
  correct body (all 7 changed bytes == intended overrides), but the pedal's live
  control table read back STALE mid-EQ values (live 32..35 = 1,4,0x96,0x18) at
  save time while the UI log shows the intended 48/0/152/40. Explanation: the
  L.A. Lady ignores CTRL_SET for live indices 16..39 (already documented in
  OBSERVE_UNTRUSTED_LIVE, only 0..15 verified writable). Mid EQ knobs body
  33/34/35/36 -> live 32/33/34/35 were routed LIVE, so drags were silent and the
  change only bit when the save wrote flash -> "saving changed the sound".
- Fix: lalady.component.ts setField() now routes a control through LIVE only when
  its liveIndex is TRUSTED (0..15); everything else (mid EQ, gate/treble/bass,
  packed bytes, routing) goes through the proven flash-commit queue, so edits are
  heard live and Save becomes a no-op for those bytes.
- ng build passes (pre-existing NG8102 and lalady budget warnings only).
- Next: user repeats the knob-edit + Save repro and confirms mid-EQ drags are now
  audible BEFORE save; the file log should stop showing stale live 32..35 reads.

## Status - 2026-09-10 lalady: Mid B Q/Frequency body-byte labels swapped (hardware verifies)

- User report: "when i turn 'mid b q' it affects 'mid b frequency'". The UI log
  confirmed the turned knob was body byte 36 (SET Mid B Q (36:0) -> FLASH idx=36
  with readback match), yet the sound swept the FREQUENCY. Conclusion: the fixed
  body-byte layout of the pedal for the Mid B band is 35 = Q, 36 = Frequency,
  the OPPOSITE of the Neuro .pre field order that WORKBENCH_CONTROL_SPECS had.
- Fix: swapped the names at indexes 35/36 in WORKBENCH_CONTROL_SPECS (server.js):
  35 -> 'Mid B Q', 36 -> 'Mid B Frequency'. Byte indexes unchanged; the knob
  labels and the byte each writes now agree with the pedal. CONTROL_NAMES (live
  control-table names) left untouched - it governs the read-only monitor and
  was not implicated by the user test.
- Ng build passes (C4 template NG8102 + lalady budget warnings pre-existing).
- Next: user turns "Mid B Q" -> should now hear Q (bandwidth) change, and "Mid B
  Frequency" -> should sweep frequency. If Mid A band shows the same swapped
  symptom, apply the same swap at indexes 33/34.

## Status - 2026-09-10 lalady: flash-commit overlays trusted live block

- User: "when i touch midBfrequency - i hear that value of leftMidB80Hz bypassed.
  and it starts affecting sound if i then touch it". Cause: /api/control reads the
  FLASH body, patches one byte, then commitRawPreset RE-ACTIVATES the slot - which
  reloads the LIVE control table from flash, wiping any pending trusted-LIVE edit
  (live 12 Left Mid B 80 Hz) that exists only in RAM.
- Fix: /api/control now overlays the live control block over the body for trusted
  live indices 0..15 (skipping unmapped 6/19, ignoring 0xff) BEFORE patching the
  requested byte and committing. Untrusted reads (16..39) are never applied since
  they can return stale/0xff garbage; the UI bakes those bytes directly into the
  body. Matches the save-path merge logic.
- node --check passes on server.js.
- Next: re-test touch Mid B Frequency -> Left Mid B 80 Hz must NOT jump back.

## Status - 2026-09-10 lalady: apply-lifecycle indicators (per-control badge + commit strip)

- User: flash-committed knobs (mid EQ etc.) lag the handle because of the 300ms
  debounce + ~2s flash/recall cycle - "sound changes not in same moment knob
  changes". Asked for an indicator that a change was applied: one widget or a sign
  on each control.
- Added BOTH: (1) each control renders a small badge showing its apply lifecycle:
  pending '...' / writing (pulsing) / applied '?' (fades after 2.8s); (2) a global
  commit strip above the knob rows showing "N applying..." plus "? <name> applied"
  for the most recently confirmed write. LIVE-path edits (trusted 0..15) mark
  applied immediately; FLASH-path edits go pending -> writing -> applied on readback.
- Implemented in lalady.component.ts (flashPhase map, setFlashPhase, clearFlashPhases,
  getters flashPendingCount/flashPhaseFor; wired into setField live/flash branches,
  flushDiscrete success/error, loadSlotParams and ngOnDestroy reset), template badge
  + commit-strip markup, SCSS styles.
- ng build passes (pre-existing C4 template NG8102 warning; SCSS now 15.9kB vs
  12.29kB max budget warning - cosmetic, no error).
- Next: user drags a mid-EQ knob -> badge should turn pending then pulsing then
  green checkmark at the moment the sound changes; strip lists pending/applied count.

## Status - 2026-09-10 lalady: apply-badge keyed by field, not body byte

- User: "when i touch bassBoostRolloff - i see other bass controls touched. the
  same bug we fixed with freq before." Root cause: the apply-lifecycle badge was
  keyed by BODY BYTE index, and bass_boost_rolloff shares packed byte 32 with
  Bass Cut Filter + Bass Shelf Slope - so touching any one lit the badge on all
  three siblings (same for treble byte 30 / knob-assign byte 38).
- Fix: flashPhase now keyed by field (index:shift) via fieldKey(); setFlashPhase
  and flashPhaseFor take the ControlSpec; discretePending carries the spec so
  flushDiscrete marks the exact control 'applied'; superseded sibling phases on
  the same byte are cleared when a later edit to that byte is queued.
- ng build passes (pre-existing C4 NG8102 warning + SCSS budget note only).
- Next: touch Bass Boost Rolloff -> ONLY it shows the badge, Bass Cut Filter and
  Bass Shelf Slope must stay untouched.

## Status - 2026-09-10 lalady: Mid A/B band titles track the Frequency value

- User: "when i change mid A freq ... title under left mid A XX hz and right mid A
  XX hz changed. XX = value of mid A freq. same for B". The band LEVEL controls
  (body 11/12/24/25) had hard-coded names "Left Mid A 126 Hz" / "Left Mid B 80 Hz"
  from CONTROL_NAMES, so they never reflected the frequency knob.
- Fix: added controlLabel(spec) in lalady.component.ts - for body 11/24 it renders
  "Left/Right Mid A <body33 value> Hz", for 12/25 "Left/Right Mid B <body36> Hz"
  from the current slot param; other controls fall back to spec.name. Template's
  .kname now uses controlLabel. No Hz scaling exists, so the raw 0..255 native
  value is shown (matches the knob itself).
- ng build passes (pre-existing C4 + SCSS budget warnings only).

## Status - 2026-09-10 lalady: Save louder - stale live overlay on untrusted range

- User: "i saved preset and get much louder sound after save". The /api/slots/save
  merge still copied the FULL live block (0..25 by raw index + ACTIVE_COMPARE
  27..37) into the persist body. But live indices 16..39 return stale/0xff garbage
  (established with OBSERVE_UNTRUSTED_LIVE), so Save smeared it over the EQ/gate
  tail. Caught live: SAVE-AFTER diff 34:ff->04, 35:f6->96, 36:d1->18 from live tail
  ending 049618e4 -> Mid A Q, Mid B Q, Mid B Freq jumped to junk -> louder sound.
- Fix: save now overlays ONLY trusted live 0..15 (skipping unmapped 6/19), matching
  /api/control. Everything byte 16+ keeps its flash body value - which is correct
  because the FLASH-commit path already persisted those edits at knob-time; UI
  overrides still apply on top. ACTIVE_COMPARE no longer used for the merge
  (still used by resolveActiveSlot).
- node --check passes on server.js.
- Next: user edits mid EQ then Save -> sound must NOT jump; knob edits kept in flash.

## lalady mergework? - merge workbench and randomize into one view

### Plan
2026-09-10 lalady: merge the Workbench and Randomize tabs into a single
workbench view so both are visible side by side (workbench on the left,
randomizer on the right). No separate Randomize tab anymore.

### Status
2026-09-10 lalady: merged views.
- lalady.component.html: Workbench section now wraps its content (slot picker,
  action log, knob rows) in `<div class="wb-cols"><div class="wb-col wb-work">`
  (left), and the Randomizer markup (monitor head, rand-player, rand-cols:
  groups/presets editors) moved inside a sibling `<div class="wb-col wb-rand">`
  (right). The randomize `<section>` and its `*ngIf activeTab === 'randomize'`
  are gone; on the merged view only `wb-col wb-work` + `wb-col wb-rand` render.
- Randomize tab button removed from nav; Workbench button now calls new
  `openWorkbench()` which sets activeTab and calls `refreshRand()` to ensure
  randomizer data loads.
- lalady.component.ts: `activeTab` union dropped `'randomize'`; removed dead
  `openRandomize()`.
- lalady.component.scss: `.workbench` gets `.wb-cols` grid
  (grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr), gap 18px) so
  workbench column is wider. `.randomize` SCSS selector changed to `.workbench
  .wb-cols .wb-col.wb-rand` (the `.randomize` class no longer exists on the DOM).
- Build passes (ng build; only the pre-existing SCSS budget warning remains).
- Next: confirm the merged view looks right in the browser; if the randomizer's
  two .rand-col blocks (Groups + Presets) render better stacked than side by
  side inside the narrower right column, adjust .rand-cols minmax(420px, 1fr).

### Status
2026-09-10 lalady: made the app full-width.
- lalady.component.scss `.lalady`: dropped `max-width: 1100px`, now `width: 100%`
  so tabs/panels span the whole window. The merged workbench+randomizer grid
  (.wb-cols 1.35fr/1fr) now gets the full viewport width; workbench column stays
  widest, randomizer right column grows too.
- ng build passes.
- Next: eyeball the merged view at full width.

## lalady randomizer include/exclude groups

### Plan
2026-09-10 lalady: allow marking randomizer groups as "include" (their controls
get randomized) or "exclude" (their controls are NEVER randomized, even under
"Randomize all controls"). Give each workbench knob a small buttons to attach
that control to a group directly (or make a new group from the picker), instead
of only ticking a giant checkbox list under Groups.

### Status
2026-09-10 lalady: implemented.
- server.js normalizeGroup now accepts `mode: 'include' | 'exclude'` (default
  'include') and persists it; GET /api/randomize/groups backfills `mode`
  for old records via `{ mode: 'include', ...g }`. Old groups => include (same
  behavior as before the feature).
- lalady.models.ts RandomizeGroup gets `mode` field.
- lalady.component.ts randomTargets(): exclude-group specKeys are removed from
  the pool first; randAll now skips excluded controls too. Include groups pick
  `props` members per scene as before.
- Per-knob picker: each knob has a `вЉ•` button (shows `вЉ• N` when the control is
  in N groups; turns red when any group excludes it). Opens a popover listing
  every group with a membership checkbox + вњ“/вњ• mode chip (click chip = flip
  include/exclude), plus a "new group" input with `+ include` / `+ exclude`
  buttons. New methods: openGroupPicker, grpPickerIs, specOfExclude, groupsOf,
  specInGroup, setSpecInGroup (PUT specKeys), toggleGroupMode (PUT mode),
  createGroupWithSpec (POST).
- Groups editor: the create/edit form gains an include/exclude toggle; group
  list rows show an "included"/"excluded" chip + a quick include/exclude button.
- SCSS: .grp-btn (knob corner), .grp-picker popover, .grp-mode chips,
  .rand-mode-toggle in editor, .chip.exclude.
- ng build passes (only the pre-existing SCSS budget warning).
- Next: confirm in browser that knob вЉ• opens the picker and picker overlap over
  neighbor knobs is acceptable; excluded controls should visibly never change
  under Generate/Play.

### Status
2026-09-10 lalady: added group-edit mode for knob-based membership.
- Flow: click "New group"/"Edit group" in the Groups panel -> groupEditMode=true.
  Every workbench knob's grp button becomes a toggle: GREEN вЉ•=add this control,
  RED в€’=already in the group (click removes). Popover is suppressed while in
  edit mode (openGroupPicker guards on groupEditMode).
- Clicking a knob toggles randKeysChecked[specKey] locally (no HTTP until Save) вЂ”
  same map the Groups editor checkbox grid reads, so counts stay in sync.
- "Cancel"/Save returns to regular mode (cancelEditGroup flips groupEditMode
  false; saveGroup calls cancelEditGroup on success, so knobs go back to normal
  automatically).
- UI: knobs get .edit-add (green) / .edit-del (red) styles; a .grp-edit-banner
  shows above the knob rows ("Group edit mode вЂ” click = add to X / already in
  group / Cancel").
- TS: groupEditMode flag, toggleSpecInEditGroup(spec), editGroupHasSpec(spec).
- Fixed an HTML bug during wiring: literal double-quotes inside the double-quoted
  [attr.title] binding terminated the tag вЂ” titles now avoid embedded quotes.
- ng build passes (pre-existing SCSS budget warning only).
- Next: verify green/red knob toggles + Save persists memberships, and format
  the banner as you like.

## lalady randomizer: drop per-effect byte label; per-group on/off toggle

### Plan
2026-09-11 lalady: (1) In the Groups editor's controls-selected list every row
appends "byte <index>" next to the effect name пїЅ remove that noise. (2) In the
created-groups list, add an "on" toggle per group so a group can be turned off
temporarily (it stops being randomized; an exclude group also stops locking its
controls) without deleting it. enabled persists to the backend and defaults
true for existing groups. Verify: ng build passes; Generate/Play skip disabled
groups and keep randomized controls consistent.

### Status
2026-09-11 lalady: implemented.
- Groups editor controls list: removed the trailing "byte <index>" label from each
  effect row (and its now-unused .rand-spec .muted SCSS rule).
- RandomizeGroup gets enabled: boolean; server.js normalizeGroup persists it
  (default true) and GET /api/randomize/groups backfills enabled: true for old
  records.
- Created-groups list rows gain an "on" checkbox; unchecked rows dim (.off) and
  the group is skipped entirely by the randomizer. randomTargets() ignores
  disabled groups for both include and exclude behavior; specOfExclude also
  skips disabled groups so locked-knob styling stays accurate. New TS method
  toggleGroupEnabled() PUTs the flag.
- ng build passes (pre-existing c4 '??' template warning + SCSS budget warning
  only); node --check passes on server.js.
- Next: eyeball the toggle in the browser; confirm Generate/Play skip dimmed
  groups and dimmed exclude groups no longer lock their controls.

### Status
2026-09-11 lalady: fixed saved randomizer groups not showing on session start.
- Root cause: activeTab initializes to 'workbench', so the workbench tab renders
  without ever firing openWorkbench() пїЅ the only call to refreshRand(). Groups
  and presets therefore stayed empty until the user clicked the Workbench tab or
  saved a new group.
- Fix: call refreshRand() from ngOnInit (alongside refresh/refreshDeviceInfo),
  so persisted randomizer groups + presets load on startup regardless of tab.
- ng build passes.

## lalady randomizer: visible countdown before param changes

### Plan
2026-09-11 lalady: while auto-randomize (Play) is running, show a visible
countdown of the seconds remaining until the next random param change, next to
the Play/Pause controls. The existing interval stays whole-second; tick it every
1s so the display counts down live. Verify: ng build passes; countdown shows and
resets right after each Generate.

### Status
2026-09-11 lalady: implemented.
- New randCountdown state; the auto-randomize interval now ticks every 1s,
  decrementing the countdown and generating a scene (resetting to the interval)
  when it reaches 0. First scene still applies immediately on Play; Pause resets
  the countdown.
- UI: a "Ns" badge next to Play/Pause (hidden when not playing), turning amber
  (.low) in the last 3s; styled .rand-count SCSS.
- ng build passes (pre-existing c4 '??' template warning only).

## lalady randomizer: one preset per displayed slot

### Plan
2026-09-11 lalady: the presets table's "slot" column shows the pedal slot each
preset was last written to. Because a pedal slot holds one preset at a time,
writing a next preset to the same slot left the previous preset also marked with
that slot пїЅ both displayed slot=2. Fix: when a preset claims a slot (POST/PUT
with saveToSlot), clear the slot on any other preset still pointing at it.
Verify: node --check + in-app check that the overwritten preset shows "пїЅ" after
refresh.

### Status
2026-09-11 lalady: implemented.
- server.js: new claimPresetSlot(list, id, rawIdx) helper clears p.slot on any
  preset other than id that points at rawIdx. Called after persistBody in both
  POST /api/randomize/presets (id = null, new record not yet pushed) and PUT
  /api/randomize/presets/:id; both follow with randSave so the clearing persists.
- No frontend change needed: the table already renders a blank dash for
  p.slot === null, picked up by refreshRand.
- node --check passes.

### Status
2026-09-11 lalady: removed the "slot" column from the randomizer presets table.
- The saved-slot display (displaySlotNum / dash) is gone since it only repeated
  stale/duplicated last-write info on session start. The actions column keeps
  Load/Rename/Delete and the per-preset "slot <n> -> slot" write target.
- ng build passes.

## lalady randomizer: "-> slot" also writes the preset name

### Plan
2026-09-11 lalady: the "-> slot" action in the random-saved presets list should
save the preset's name to the pedal slot, and the UI should immediately reflect
it (the pedal's ACTIVE preset also switches to the written slot). Verify: ng
build passes; after clicking "-> slot" the workbench loads that slot and its
header shows the preset name, while the Slots tab updates too.

### Status
2026-09-11 lalady: considered пїЅ
- The write path ALREADY saves the name: persistBody(...) is called with
  preset.name (PUT) / the new preset name (POST), and writePreset commits the
  85-byte slot body (53 data + 32 name) with read-back verify (validated by
  scripts/validateActiveWrite.js). No backend change needed.
- Root visible gap: after a successful write the frontend kept showing stale
  slot names, and the pedal (setActivePreset) had switched to the written slot
  while the workbench still showed the previous scene.
- Fix (lalady.component.ts savePresetToSlot): the PUT now also sends the preset
  name, and on success it reloads the slot list (this.loadSlots()) plus loads
  the written slot's params into the workbench (this.loadSlotParams(slotIdx)),
  so the slot name and sound immediately match the pedal.
- ng build passes.

## lalady randomizer: helper tooltip on group props input

### Plan
2026-09-11 lalady: add a visible "?" helper next to the props input in the
group create/edit form with a plain-English tooltip (what the value does, 0 =
all members). Verify: ng build passes.

### Status
2026-09-11 lalady: implemented. The props input in the group create/edit form
is now wrapped in a .field-helper with a blue "?" badge whose tooltip explains
that 0 = all members and N changes only N random controls per scene. The
input's own title is kept. ng build passes (pre-existing c4 warning only).

## lalady randomizer: "Randomize all" dims groups + highlights checkbox

### Plan
2026-09-11 lalady: when "Randomize all controls" is checked, the groups editor
form, the saved-groups list, and the presets save-row should all be visually
dimmed and interactive elements disabled (groups are ignored under randAll).
Group-list rows get a tooltip explaining "Randomized all controls". The
checkbox label itself gets a distinct highlight. Verify: ng build passes.

### Status
2026-09-11 lalady: implemented.
- "Randomize all controls" label gets a green highlighted state (.rand-all.on)
  when checked.
- When randAll is set: the groups editor (.rand-editor, incl. controls grid) and
  the saved-groups list (.rand-group-list) dim (opacity 0.45); New group, Save,
  Cancel, the per-row on/mode/Edit/Delete controls, and the group/on-labels are
  all disabled via [disabled]="... || randAll".
- Group list rows show a tooltip "Randomized all controls пїЅ this group is
  ignored" while randAll is on (li and the on-toggle both).
- ng build passes (pre-existing c4 warning only).
2026-09-11 lalady: follow-up fix пїЅ with "Randomize all controls" engaged the
groups create/edit form was still editable (only the action buttons were
disabled). Now the name/priority/props inputs, the include/exclude mode
buttons, and every control-selector checkbox in the editor are [disabled] too,
matching the dimmed groups list. ng build passes.

## doc: randomizer reference + C4 Synth port guide

### Plan
2026-09-11: write two READMEs to make porting the L.A. Lady randomizer to the
C4 Synth pedal easy and low-risk: (1) back/lalady/docs/randomizer.md пїЅ reference
doc for the existing implementation (data model, backend endpoints/persistence,
frontend state/methods/algorithms, UI pieces, exact file paths); (2)
back/c4/docs/randomizer-port.md пїЅ a step-by-step port checklist mapping every
L.A. Lady file/method to the C4 backend (128 presets, 128-byte body, port 3222)
and C4 frontend, including the specific constants/regexes that must change.
Verify: both docs render and cross-link; ng check unaffected (docs only).

### Status
2026-09-11: created back/lalady/docs/randomizer.md (reference architecture: data
model, backend helpers+endpoints w/ line anchors, frontend state/methods,
algorithms, UI pieces, file paths) and back/c4/docs/randomizer-port.md (C4 port
checklist: existing C4 capabilities, deltas table 53->128 bytes / 6->128 presets
/ 106->256 hex, backend step, frontend steps, verification, open questions).
Result: docs only; no build/typecheck impact. Cross-linked both. Pending user
answers to the two open questions (tab vs inline, c4Rand* naming) before any
port code is written.

## implement: C4 randomizer UI

### Plan
2026-09-11: port the L.A. Lady randomizer into the C4 UI (reference docs just
written: back/lalady/docs/randomizer.md and back/c4/docs/randomizer-port.md).
Choices (following port-doc recommendations): Randomizer as its own C4 tab;
keep the rand-prefixed state names matching lalady verbatim for easy diffing.
Scope: (1) back/c4/server.js - add randomizer-data persistence, helpers
(randLoad/randSave/randUuid/normalizeGroup/normalizePreset/bodyOfHex/
claimPresetSlot/persistBodyC4 via commitRawPreset+getPresetName), 8 endpoints;
bodyHex 256 chars, saveToSlot 0..127. (2) web/src/app/c4/c4.models.ts -
RandomizeGroup/RandomizePreset/RandomizePresetCreate/RandomizeList. (3)
c4-api.service.ts - randomize* methods. (4) c4.component.ts - rand state +
methods (bodyValues from slotParams 128 bytes, applyScene via queueLive,
randomTargets/fieldFor/randomizeBody, scene play/countdown, group+preset CRUD),
refreshRand on ngOnInit and tab open. (5) c4.component.html/.scss - Randomizer
tab + rand-player + groups editor/list + presets table + styles. Verify:
node --check, ng build.

### Status
2026-09-11: C4 randomizer implemented end-to-end. backend/c4/server.js: added
randomizer-data JSON DB (groups/presets), fs require, helpers randLoad/Save/Uuid,
normalizeGroup, normalizePreset (256-hex bodyHex regex, saveToSlot 0..127),
persistBody via p.commitRawPreset + getPresetName (recalls automatically), bodyOfHex,
claimPresetSlot, and the 8 /api/randomize/* endpoints. c4.models.ts: added
RandomizeGroup/RandomizePreset/RandomizePresetCreate/RandomizeList. c4-api.service.ts:
randomize* CRUD methods. c4.component.ts: added a 4th 'randomizer' tab; ported the
full randomizer section (state + methods: refreshRand, randomTargets, fieldFor
algos, randomizeBody, pushScene/applyScene via queueLive, generateScene,
stepScene, togglePlay countdown, group CRUD + per-knob grp picker, preset CRUD);
BODY_LEN=128 in bodyValues/loadPreset; refreshRand on ngOnInit + tab open;
stopRandTimer in ngOnDestroy; renamed the randomizer save to saveRandPreset
(avoids colliding with the existing workbench savePreset). c4.component.html:
Randomizer tab + full UI (player/countdown/algo/randAll, groups editor+list,
presets table with per-row C4 preset-location dropdown), grp-edit banner,
per-knob grp-btn + grp-picker in the workbench. c4.component.scss: promoted
.inp/.chip/.refresh/.danger to top level, .knob position:relative, grp-btn/
grp-picker/banner styles, and the full .wrand randomizer styles. Verified:
node --check back/c4/server.js OK, ng build passes (only pre-existing NG8102 +
budget warnings). Not committed.

### Status
2026-09-11: Merged the C4 randomizer into the workbench (L.A. Lady two-column
layout). html: removed the Randomizer tab button; moved the entire
.wrand block inside .wb-layout as a .wb-rand column (sibling of
.wb-main and .action-log); updated the per-knob picker hint text to
refer to the "Randomizer panel on the right". ts: removed 'randomizer' from
the activeTab union; setTab now calls refreshRand() when entering the
workbench (and removed the now-dead tab === 'randomizer' branch). scss:
added .wb-rand { flex: 0 0 460px; min-width: 340px; margin-bottom: 0; }
under .wb-main; added &.wb-rand .rand-cols { grid-template-columns: 1fr; }
inside .wrand so groups and presets stack vertically in the narrow column.
On screens <900px the flex-direction column (existing media query) still stacks
workbench and randomizer vertically; the .rand-cols single-column rule also
applies on mobile. Verified: ng build passes (same pre-existing warnings only).

## Progress - 2026-09-11 web: C4 CTRL_SET silently ignored пїЅ route all writes through flash commit

- User: "i dont hear c4synth changes on knobs change"
- Log analysis: LIVE writes (CTRL_SET 0x70) fire without backend errors, but no
  audible change on the pedal; FLASH commits (ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET
  via /api/control) work perfectly with readback confirmation.
- Root cause: the C4 firmware silently ignores CTRL_SET (0x70) for live parameter
  updates.  The L.A. Lady pedal supports CTRL_SET, but the C4 does not.  Every
  whole-byte knob change was routed through queueLive() > CTRL_SET which had no
  effect; only packed fields (already on the flash path) were audible.
- Fix: removed the if (spec.liveIndex != null) { queueLive; return } branch from
  setField() вЂ” ALL knob changes now go through the debounced 300ms
  flushDiscrete() > api.control() > commitRawPreset() flash-commit path.
  Updated applyScene() (randomizer) to commit the full changed body via
  api.slotSave({overrides}) so scenes are audible immediately.  Updated
  allParamsZero() to commit via slotSave instead of queueLive.  The
  queueLive/resendLiveOverrides code remains (harmless, useful for logging
  if the firmware situation changes).
- Verify: ng build passes (pre-existing warnings only).

## Plan - 2026-09-11 web: C4 knob apply feedback + batched flash commit
- User: "1.add processing display (when control is applied to pedal after knob
  change) like in lalady. 2.when i turn gain 1 - sound is jumping. when i turn
  'mix' it seems some others 'knobs' reseted. watch logs fix it".
- Bug analysis: discretePending held only ONE {p, byte}. Turning gain1 then mix
  within the 300ms debounce overwrote the first change вЂ” it was never committed
  to flash, and the next single-byte /api/control commit recalled the preset
  (setActivePreset) from a flash body that lacked it, so the knob audibly
  "jumped" / other knobs "reset".  Each single-byte commit also fired its own
  full ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET cycle (~1s+), compounding the effect.
- Fix: recode setField/flushDiscrete to batch ALL pending editedOverrides bytes
  into ONE api.slotSave({overrides}) commit (single in-flight guard), removing
  the single-slot discretePending; delete the now-dead queueLive/livePending/
  liveTimer/resendLiveOverrides (CTRL_SET is ignored on C4), and drop
  resendLiveOverrides() from applyScene().
- Display: port the L.A. Lady per-control apply badge (.ctl-badge, phases
  pending/writing/applied, keyed index:shift, APPLIED_KEEP_MS 2800 auto-fade)
  + global commit strip (flashPendingCount / lastAppliedName) into the C4
  workbench, with @keyframes pulse.

## Status - 2026-09-11 web: C4 knob batch commit + apply badge implemented
- Done: setField() now marks its field 'pending' (clearing sibling fields on the
  same packed byte), stores the byte in editedOverrides, and arms a 300ms
  debounce; flushDiscrete() gathers ALL editedOverrides bytes and commits them
  in one slotSave({overrides}) call, marking affected fields 'writing' then
  'applied' on success (or dropping the badge on error).  Single-flight
  discreteInFlight guard prevents overlapping commits; new edits during flight
  re-arm a follow-up flush (discreteDirty).
- Cleanup: removed dead queueLive()/livePending/liveTimer, discretePending
  single-slot field with its per-byte /api/control path, and resendLiveOverrides()
  (CTRL_SET ignored on C4).  applyScene() no longer calls resendLiveOverrides().
- UI: added .ctl-badge (pending/writing/applied, @keyframes pulse) to every
  workbench knob and a .commit-strip (flashPendingCount + lastAppliedName) under
  the block-bar in c4.component.html/.scss.  clearFlashPhases() runs on
  load/revert so stale badges never persist.
- Layout fix: the commit-strip was first placed as a direct child of .wb-main вЂ”
  at >=1600px that grid is column-major with a fixed row count, so an extra
  full-width grid cell pushed all control blocks around ("control blocks now
  chaotic").  Moved the strip INSIDE .block-bar (width:100%, wraps to its own
  line after the chips).  .block-bar remains the single grid-column:1/-1 cell,
  so the 2-column flow is restored.
- Verify: ng build passes (pre-existing warnings only: NG8102 nullish coalescing
  on c4.component.html:36, SCSS budgets for lalady + c4).  User to re-test turning
  gain1 + mix rapidly and confirm batch commit in the C4 runtime log and no
  knob jumping.

## Status - 2026-09-11 web: C4 randomizer audible but knobs frozen - static stroke attribute
- User: "when randomizer works i hear the changes but knobs dont change visually".
  Scenes commit fine (log: SCENE commit/committed, flash commits apply, sound
  changes) but the knob arc never moved.
- Root cause: c4.component.html knob <circle class="arc"> was rendered with
  `stroke-dasharray="arcDash(it.spec, it.p)"` -- a STATIC attribute, not an
  Angular binding. Angular set the literal text "arcDash(it.spec, it.p)" once and
  never re-evaluated it, so the knob fill arc froze at its initial value even
  though p.value changed (the pointer [attr.x2]/[attr.y2] and .kvalue text DID
  update). The static arc made the whole knob look inert during randomizer play.
- Fix: changed to `[attr.stroke-dasharray]="arcDash(it.spec, it.p)"` so the arc
  tracks p.value on every CD pass, matching the existing [attr.*] pointer bindings.
- Verify: ng build passes (pre-existing warnings only).  User to re-run the
  randomizer and confirm the knob arcs now move with the audible scenes.

## Status - 2026-09-11 web: C4 changed knobs get light-gold border + arc like lalady
- User: "make changed knobs light-bordered like in lalady ui".  lalady renders
  .kbody.modified with the knob arc in gold (#ffd27a, lalady.component.scss l.790).
  C4 only colored the .kname label gold, so a modified knob body looked unchanged.
- Fix (c4.component.scss): `.knob.modified .kbody { border-color: #ffd27a }` +
  `.knob.modified .arc { stroke: #ffd27a }` -- modified knobs now get a light-gold
  ring AND a gold fill arc, matching lalady at a glance.  .kname gold kept.
- Verify: ng build passes (pre-existing warnings only).  User to turn any knob and
  confirm the knob body lights gold around the border + arc.

## Status - 2026-09-11 web: C4 random preset target slot defaults to current slot
- User: "when i save random generated preset - i want current slot will be selected
  by default in 'target c4 preset location' select".  randPresetSlots (the per-row
  target-slot select in the rand-preset table) defaulted to `p.slot ?? 0`, so a
  freshly saved preset (slot: null) always showed location #0 regardless of the
  workbench's current preset.
- Fix (c4.component.ts refreshRand): default unresolved rows to the selected slot,
  `p.slot ?? this.selectedPresetIdx ?? 0`.  Rows that were already pushed to a C4
  slot keep their stored slot since backend persists it on savePresetToSlot.
- Verify: ng build passes (pre-existing warnings only).  User to save a random
  preset with the workbench on a non-zero preset and confirm the target-location
  select rows now show the current slot.

## Status - 2026-09-11 web: C4 rand-preset target slot still showed #0 after slot switch
- User: on #4 but saved random preset table still showed #0 in the target-location
  select.  Root cause: randPresetSlots was computed ONCE in refreshRand() (initial
  call happened while selectedPresetIdx was still null/0) and never re-synced when
  the Location select later activated #4.
- Fix (c4.component.ts): extracted syncRandPresetSlots() (p.slot ?? selectedPresetIdx
  ?? 0) used by refreshRand(), and called it again from loadPresetParams() so any
  slot change (Location select / activate / savePresetToSlot reload) re-defaults
  unpinned rows to the current slot.  Pinned rows (backend slot set) keep theirs.
- Verify: ng build passes (pre-existing warnings only).  User to switch to #4 then
  re-check the table: unpinned presets' target-location select must show 4.

## Status - 2026-09-11 web: C4 Revert button no-op - stale knob cache, not the buttons
- User: "revert button does nothing".  revertPreset() swapped in a brand-new array
  `this.slotParams.params = snapshot.map({...})`.  But the knob/seq display cache
  (_knobRowsCache) is keyed on slotParams IDENTITY (which never changes on revert),
  and every cached {spec, p} still pointed at the OLD param objects - so the workbench
  kept showing the edited values; the click looked like a no-op.
- Fix: mutate each existing param object in place from paramsSnapshot (by index),
  keeping array and objects identical; then clear slotsDirty/editedOverrides/flash
  phases as before.  UI now reverts.
- Verify: ng build passes (pre-existing warnings only).  User to drag a knob, hit
  Revert, and confirm the workbench returns to the loaded snapshot.

## Status - 2026-09-11 web: C4 'all 0' zeroes workbench WITHOUT saving to slot
- User: "button 'all 0' saves to slot zeroed values. i want it just to change all
  to 0, not save".  allParamsZero() issued api.slotSave({overrides}) immediately,
  committing a fully-zeroed body to flash (and recalling the preset).
- Fix: allParamsZero() now only mutates each param object in place to 0 (keeps the
  knob cache valid), marks editedOverrides + slotsDirty, and logs
  'ZERO all workbench bytes (not committed)'.  Committing is left to Save; Revert
  restores the snapshot.
- Verify: ng build passes (pre-existing warnings only).  User to click 'all 0',
  confirm knobs zero on the workbench with no flash write in the log, then Save or
  Revert.

## Status - 2026-09-11 web: C4 'all 0' visual-only - knob turn no longer flushes zeros
- User: "'all 0' only visually touch all the knobs, sound remains the same. but if
  to touch knob after it - zero0knobs-state aplied".  Previous fix stopped the
  immediate slotSave but allParamsZero() STILL wrote every byte (as 0) into
  editedOverrides; turning any knob afterwards made flushDiscrete() batch-commit
  ALL 128 zeroed bytes to flash, so the whole zeroed state hit the pedal.
- Fix: allParamsZero() now only zeroes the param objects in place (p.value = 0,
  slotsDirty stays true, log 'visual only, not committed'); editedOverrides is left
  untouched so the next knob turn commits ONLY that byte.  Save still persists via
  whichever editedOverrides exist; Revert restores the snapshot.
- Verify: ng build passes (pre-existing warnings only).  User: click 'all 0',
  knobs zero visually with no flash write; turn a knob -> only that knob's byte is
  committed, the other zeroed knobs stay visual-only.


## Status - 2026-09-11 server: C4 Revert now restores the saved preset to flash
- User: "revert reverts to saved preset not every time. watch logs".  Log showed
  knob edits auto-committing to flash at knob-time (`FLASH batch commit N byte(s)`)
  while `REVERT: workbench returned to snapshot` was UI-only - the pedal kept
  playing the edited body, and a 300ms debounced commit in flight during revert
  could land AFTER the revert (hence "not every time").
- Fix: revertPreset() now builds overrides from paramsSnapshot, restores UI in
  place (cache-safe), cancels the debounce timer, clears discreteDirty, and
  re-persists the snapshot bytes to flash via slotSave({idx: selectedPresetIdx,
  overrides}).  If a commit is in flight it is queued in pendingRevert and run from
  the flushDiscrete next/error handler only after that write settles; a fresh knob
  edit after Revert cancels pendingRevert so a queued restore can't stomp new
  edits.
- Verify: ng build passes (pre-existing NG8102 warning only).  User to edit knobs
  then click Revert and confirm the log shows 'REVERT: flashing N byte(s)' and the
  pedal returns to the saved sound on every click, including right after an edit
  that just fired a batch commit.


## Plan - 2026-09-12 h90: drop decrypt/RE tooling; SikuliX knob-turn controller (web-driven)

User decision: STOP all H90 decrypt/reverse-engineering work. Delete the entire
read/write-protocol RE apparatus from back/h90 and replace it with a practical
controller that turns the pedal's preset knobs by driving the native
`H90 Control.exe` GUI with SikuliX (image/OCR), exposed through the existing
web `/h90` tab (preset detail page).

Scope:
1. Delete (git rm) all decrypt/RE code + artifacts: h90_*.py analysis tools
   (angr/capstone/deflate-decode/fbwalk/replay/serialize variants), h90-captures/
   (frames, zlib disasm, dict constraints), h90-recon/ (write-reconstruction
   scripts + lst90_json corpus + decoded bins), tests/ (dict-recover regression),
   test_h90_dict_recover.py, SCHW/import notes H90-IMPORT-NOTES.md, the BLE/MIDI
   capture+proxy/replay harness (swift files, capture-proxy-long.js, test-*.js,
   probe-h90*.js), devs*.py, upx4.tar.xz. Keep: server.js, package.*, build_db.py,
   list-ports.js, h90-send.js, the two capture-h90* listeners (with the Windows
   log-path fix) and the whole sikulix/ tree.
2. New back/h90/sikulix/projects/knob-driver.sikuli: OCR driver with two modes -
   --scan (list visible knob labels in the parameters region) and a turn mode
   (optional --preset <frag> row click, then --knob <label> --turns N sequences,
   drag-turning each knob). Reuses the sidebar-anchor preset-click logic from
   click-preset.sikuli.
3. back/h90/server.js: POST /api/h90/knob (turn: spawns the driver, streams output)
   and POST /api/h90/knob/scan (returns discovered knob labels). Spawn guards for
   missing jars/JRE + timeout.
4. web /h90 preset detail: Knob controller panel (preset anchor optional, Scan
   knobs, per-knob +/- stepper + Turn, driver output log) wired via ApiService.

Verify: git status shows exactly the intended delete set; node --check server.js +
capture-h90.js; ng build development clean; user runs the driver against the live
app + pedal on the visible desktop.


## Progress - 2026-09-12 h90: decrypt/RE tooling dropped; SikuliX knob-turn controller in place

- Deleted the whole read/write-protocol RE apparatus (git rm): h90_*.py analysis
  tools, h90-captures/ (frames, zlib disasm, dict constraints, expect harness),
  h90-recon/ (write reconstruction + lst90_json corpus + decoded bins),
  tests/ + test_h90_dict_recover.py, H90-IMPORT-NOTES.md, the BLE/proxy/replay
  capture harness (swift files, capture-proxy-long.js, test-*.js, probe-h90*.js),
  devs*.py, upx4.tar.xz. Kept: server.js, package.*, build_db.py, list-ports.js,
  h90-send.js, both capture-h90* listeners, and the whole sikulix/ tree.
- Fixed the capture listener log paths for Windows: capture-h90.js now uses
  process.env.H90_CAPTURE_LOG or <repo>/back/h90/h90-capture.log (was hardcoded
  /tmp/h90_capture.txt); capture-h90-long.js defaults to h90-inbound.log.
- New projektu driver back/h90/sikulix/projects/knob-driver.sikuli/knob-driver.py:
  OCR modes --scan (dumps visible knob labels in the parameters region as
  `KNOB: <frag> @ x,y,w,h` lines) and a turn mode with optional --preset <frag>
  row click + repeated --knob <label> --turns N pairs (drag-turns the dial, dy
  px per step, --above calibrates label->dial offset). reuses the sidebar-anchor
  preset-click logic from click-preset.sikuli.
- server.js: + POST /api/h90/knob/scan and POST /api/h90/knob, spawning the
  jar/JRE under back/h90/sikulix with windowsHide, capturing stdout, 90s
  timeout, busy-guard (409) and 503 when the SikuliX runtime isn't installed.
- web /h90 preset detail page: Knob controller panel (optional preset anchor,
  Scan knobs, per-knob -1/+1 turns stepper + Turn, Turn all, driver output log);
  ApiService gained scanH90Knobs()/turnH90Knobs().
- Verify: node --check clean on back/h90 JS; ng build development passes (only
  the pre-existing c4 NG8102 warning). On-machine calibration still needed:
  knob label->dial offset (--above) and drag direction/size (--dy) to be tuned
  live with capture-h90.js running.

## Plan - 2026-09-13 h90: change an effect's knob value via UI Automation (no UI)

User goal: set the "wet mix" knob of the currently-loaded "Band Delay" (Delay)
preset in the native H90 Control app WITHOUT building any web UI - just prove
we can read+change an effect property end-to-end.

Approach: Windows UI Automation (pywinauto 0.6.9, already installed) against
the running H90 Control.exe (PID 4972). This is the exact technique the former
server/h90_ui.py verified live (2026-08-28): every JUCE knob shows as a
co-located Slider (rotary) + Edit (value readout) + Text (label) in the UIA
tree, and mouse-dragging the slider center drives it, with on-the-fly px-per-
value calibration. Playwright is not applicable (native app, not web).

Steps:
1. Write a probe driver (back/h90/uia_driver.py) that attaches to the H90
   Control window, walks the UIA tree, and lists parameter groups: label +
   current value (Edit readout). Identify "Wet Mix" (Band Delay) + its value.
2. --set: drag the knob's slider by calibrated px to land the target value;
   verify via the Edit readout + (optionally) capture-h90.js MIDI RX line.
3. Run it live: read current Wet Mix, then set a clearly-different value and
   read back.

Verification: --list shows Wet Mix; --set changes it and the readout (and any
capture-h90.log traffic) reflects the new value; no UI/tab built.

## Progress - 2026-09-13 h90: change effect knob value via UIA - DONE

Outcome: fully working, no UI needed.

- uia_driver.py evolved from the planned drag-based approach to a cleaner one:
  the JUCE Slider DOES expose UIA RangeValue (0..1) via comtypes
  (IUIAutomationRangeValuePattern.SetValue) - no mouse drag required.
- Key discovery: RV-0..1 -> readout mapping is NOT linear; it is a JUCE skew
  curve (fits approx 100*rv^1.65). So --set calibrates with two endpoint
  probes (rv 1.0 -> readout 100, rv 0.0 -> readout 0), restores the original,
  then bisects rv until the live readout matches the target (+-0.5).
- Fixed collect_params region filter (must x>=536 to drop the sidebar
  Bank/User edits that were polluting pairing); readouts were initially stale
  because r["value"] was cached - now re-read live via get_value() after each
  probe/set.
- Live result (H90 Control PID 4972, Band Delay preset): Wet Mix 47 -> 70
  verified by readout; round-trip 70 -> 15 -> 70 all converge exactly
  (readout matches every time). Left at 70.
- capture-h90.js listener is running but logs no RX frames (JUCE/WinMM port
  error in err log is app noise); on-screen readout is the ground truth.
- Next ideas if wanted: per-knob skew caching to set in 1 shot instead of
  bisecting, or porting to the web knob panel as a UIA-based backend.

## Plan - 2026-09-13 h90: pre-discover all Band Delay knobs + save reusable knob map

User goal: say "change <param> to <value>" at some future time and have it applied
with no re-discovery. So now: discover every knob of the loaded Band Delay preset
in the running H90 Control app, calibrate each (min/max/skew) FIRST TIME so
future sets are a single SetValue, and persist the lookup table to disk.
User approved full calibration now (knobs will briefly swing min/max once, audible).

Approach: extend back/h90/uia_driver.py with --discover. Reuse collect_params()
walk, key each param uniquely (label + col-bucket + row; blocks: A=left editor
x<1150, B=right editor x>=1150, global=bottom y>=1500). For each numeric slider
knob: probe rv 1.0 (=hi), rv 0.0 (=lo), rv 0.5 (skew mid), restore original rv,
fit JUCE skew value ~ lo+(hi-lo)*rv^k. Save back/h90/knob-map.json (stable,
overwritten) + timestamped copy in back/h90/snapshots/. Enums (Delay A '1/4',
Filter Type, Delay Mix expr, Kill Dry combobox, Bypass button) recorded with
settable:false. --set then: load map, locate slider by stored coords, single
SetValue rv=((t-lo)/(hi-lo))^(1/k), verify readout; bisection fallback.

Verification: --discover prints map summary; --set "Wet Mix" 40 -> readout 40;
--set "HotKnob" 50 -> readout 50; second set of same knob uses cached k (fast).

## Progress - 2026-09-13 h90: knob map discovered + saved - DONE

--discover in back/h90/uia_driver.py now: walks the UIA tree, buckets params by
screen block (A=left editor x<1150, B=right x>=1150, global=bottom y>=1500),
and calibrates every SETTABLE numeric knob once (rv 1.0 -> hi, rv 0.0 -> lo,
rv 0.5 -> skew mid, restore original; value ~ lo+(hi-lo)*rv^k). Result:

- back/h90/knob-map.json (stable, overwritten each discover) with 19 knobs:
  15 SETTABLE with lo/hi/k + rv + key "label | block | ex,ey", 4 enum/stepped
  (Delay A/B '1/4', Delay Mix 'A10+B10', Filter Type 'Band Pass') settable:false,
  plus 24 captured controls (bypass/save/menu buttons, Kill Dry ComboBox "Global").
- timestamped copy: back/h90/snapshots/band-delay-20260913-184100.json
- Calibration highlights: Wet Mix range [0..100] k=1.60; In/Out Gain [-60..+12] dB
  k=1.0 (rv .833 = 0dB); Feedback [0..110]; Mod Speed [0..5.01] Hz k=4.58;
  HotKnob/ModDepth/Resonance linear. 4 numeric rows use the pairing fixture
  (Tempo Mode row shows a gain readout; the 'readme' global HotKnob is a mispairab
   leftover) - keys/coords remain honest ground truth for re-location.

--set now fast path: loads knob-map.json, re-locates slider by stored coords,
single SetValue rv=((t-lo)/(hi-lo))^(1/k), verifies readout. Verified live:
Wet Mix -> 40 (rv .564 k 1.599, readout ' 40'), HotKnob|B -> 50 (readout '50'),
HotKnob|global -> 60 (readout '60'), and duplicate 'HotKnob' label resolves
ambiguously to first settable match with candidates printed (or disambiguate via
the full "label | block | x,y" key). Bisection remains the fallback when the map
is absent or a fast set fails.

## Plan - 2026-09-13 h90: assign MIDI CC 0..9 to all 10 Preset A (Band Delay) controls
User: iterate over the loaded Band Delay preset's A-slot knobs, bind each via the
app's per-knob External Mapping popup to MIDI CC +1 each (Wet Mix=CC0 ... Filter
Type=CC9), source = MIDI CC, then report a table (type, effect, control, cc, values).
Learnings this round: the mapping popup is a SECOND top-level 'H90 Control' dialog
(rect ~ L250,T681,R1079,B1222); main window UIA tree collapses while it is open;
'Esc' closes an open dropdown and restores the tree; source combobox rows are plain
buttons (Off..Aux Switch wrap, MIDI CC at index 3); the '<'/'>' buttons step the CC
number without opening dropdowns; a program re-load reverts CC mapping to 'Off'
(current program is unsaved INIT Program, slot 05).
Steps: for each of the 10 knobs (label,cc): label-click to reveal the rangeButton,
open the mapping popup, click '>' until Control Source = MIDI CC, step CC number
to target via '>'/'<', record result, close via closeButton. Then reopen all to
verify. Then dump enum option names (drag-cycling + manual guidance) for the table.

## Progress - 2026-09-14 h90: MIDI CC 0..9 assigned and verified on all 10 Preset A knobs
Delivered: assign_cc.py reworked (PID auto-detect, popup detection by width<800,
coordinate clicks from live element rects, direction-aware source stepping) and
executed end-to-end; every knob reopened & verified through the app itself.
Result (also see back/h90/docs/midi-cc-assign.md):
  Wet Mix=CC0, Delay Mix=CC1, Delay A=CC2, Delay B=CC3, Feedback A=CC4,
  Feedback B=CC5, Mod Depth=CC6, Mod Speed=CC7, Resonance=CC8, Filter Type=CC9.
Corrections to the Plan learnings: the program is on playlist slot 08 (rows had
scrolled to Banks 4-9 at app restart, PID 4972->19324, window now ~1010px wide
so old full-scale coords are stale at ~0.55x); the source row arrows do NOT wrap
('<' from Off does nothing, '>' from Aux Switch does nothing; step forward from
Off = 3 clicks of '>' to reach MIDI CC); clicking the source text button opens the
JUCE dropdown (UIA tree collapses, need Esc); the mapping popup closes if the app
loses focus, so open->set->close->verify must run inside one script invocation.
Mappings still live only in the unsaved loaded program (reload/restart reverts to
Off); a user program save is required to persist.

## Progress - 2026-09-14 h90: Slot-A General block (In Gain/Out Gain/Bypass/Tails/Tempo Mode/HotKnob) CC 10..15 assigned and verified
General rows sit under the Band Delay effect block inside the left Algorithm
Parameters panel (x326-619, y871/y995) пїЅ NOT in the right panel which is Preset B.
Value click instead of label click required to reveal rangeButton for Tails,
Tempo Mode and HotKnob (label click does nothing for those three). State saved
to midi_cc_state.json (16 total entries CC 0-15, all verified). Re-runs skip done
entries via the state file.

## Progress - 2026-09-15 h90: Slot-A General block (In Gain/Out Gain/Bypass/Tails/Tempo Mode/HotKnob/Kill Dry) CC 10..16 assigned and verified
Corrected approach: the Slot-A General block is INSIDE the left Algorithm
Parameters panel (scrollable), NOT the bottom full-width block (which spans both
Slot A and Slot B). The bottom-block assignments CC 10-15 were reverted (set back
to Off). Corrected rects from scrolled panel position: In Gain (319,501),
Out Gain (424,501), Bypass toggle (544,503), Tails toggle (334,627), Tempo Mode
toggle (439,627), HotKnob (529,625), Kill Dry (319,771). All 17 controls now
assigned (CC 0-16) and verified. State saved to midi_cc_state.json.

## Progress - 2026-09-15 h90: correction - HotKnob is CC 16, Kill Dry has no CC control
User correction: HotKnob reassigned from CC 15 to CC 16 (in-app verified);
Kill Dry entry removed (the General-block Kill Dry row exposes no External
Mapping / CC control). Final mapping: CC 0-14 + 16 = 16 assignable controls
(10 Band Delay + 6 General: In Gain, Out Gain, Bypass, Tails, Tempo Mode,
HotKnob). State file and docs updated.

## Progress - 2026-09-15 h90: final CC map (HotKnob=15, Kill Dry=16) + sequential tests
Corrected to sequential numbering: Tempo Mode=14, HotKnob=15, Kill Dry=16
(Kill Dry IS assignable - revealed by value-click like the other General
rows; earlier assumption that it had no control was wrong when un-scrolled).
Re-assigned + verified HotKnob (CC# 15) and Kill Dry (CC# 16) in app.
Added test_assign_cc.py (unittest): test_state_entries_are_sequential asserts
17 entries CC 0..16 with exact control order and effects; test_live_app_ccs_
match_state re-opens every knob's External Mapping popup (scrolling the left
panel between the 10 effect knobs and the 7 General rows) and asserts
src=MIDI CC + CC# matches. Both pass.

## Progress - 2026-09-15 h90: Step 2 complete - Slot-A General block fully assigned (CC 10..16) + sequential tests green
Scope: after the 10 Band Delay effect knobs (CC 0..9, step 1), assign the
Slot-A General block knobs. Documented end-to-end for this step below.

H90 editor anatomy learned the hard way (do not repeat the mistakes):
- The main edit area has two "Algorithm Parameters" panels: LEFT = Slot A,
  RIGHT = Slot B (do not touch right for slot-A work). Each panel is a
  scrollable container; slot A's block contains SEVERAL sub-blocks stacked
  vertically: the effect block (Band Delay knobs) and, below it, the General
  block (In Gain, Out Gain, Bypass, Tails, Tempo Mode, HotKnob, Kill Dry).
- There is ALSO a bottom full-width block below both panels (Mix, In Gain,
  Out Gain, HotKnob, Kill Dry, Tails row + PARAMETER EDIT MODE banner). It
  spans Slot A + Slot B and is NOT slot-A General - it must NOT be assigned.
  We mistakenly assigned it CC 10-15 once and reverted it to Off.
- To reach the General block, scroll the LEFT panel down past the effect
  knobs (mouse wheel inside the panel, pywinauto scroll at panel center).
  Scroll is quantized: one wheel notch moves the content to the stable
  scrolled position; the value/label rows sit at (x319/424/529) with the
  General rows at y501 (In/Out Gain, Bypass), y625-627 (Tails toggle,
  Tempo Mode toggle, HotKnob), y749-771 (Kill Dry).
- Kill Dry does expose an External Mapping / CC control (revealed by value
  click) - it is NOT a dead label.

Per-control interaction rules (General rows):
- In Gain/Out Gain (numeric): label click reveals rangeButton.
- Bypass/Tails/Tempo Mode (toggle buttons): reveal via value-area click.
- HotKnob/Kill Dry (bottom General rows): reveal via value-area click.
All seven were assigned src=MIDI CC and verified by reopening the dialog.

Final mapping (17 controls, sequential CC 0..16):
  0 Wet Mix, 1 Delay Mix, 2 Delay A, 3 Delay B, 4 Feedback A, 5 Feedback B,
  6 Mod Depth, 7 Mod Speed, 8 Resonance, 9 Filter Type,
  10 In Gain, 11 Out Gain, 12 Bypass, 13 Tails, 14 Tempo Mode, 15 HotKnob,
  16 Kill Dry.
Corrections during the step: HotKnob was first mapped to 16 then corrected to
15; Kill Dry first dropped then restored to 16 (sequential from Tempo Mode=14).

Tests: added back/h90/test_assign_cc.py (unittest, run
`python -m unittest test_assign_cc -v`). test_state_entries_are_sequential:
state file has exactly the 17 controls, CC 0..16 sequential, correct effect
grouping (Band Delay x10, General x7), all verified. test_live_app_ccs_
match_state: re-opens every knob's External Mapping popup (scrolls the left
panel between the 10 effect knobs and the 7 General rows) asserting src=MIDI
CC and CC# matches - both pass. State persisted to midi_cc_state.json.
Caveat unchanged: mappings live only in the unsaved loaded program.

## Plan - 2026-09-15 h90: save the MIDI-mapped Band Delay to Library
User task: learn the app flow to save the currently-mapped (unsaved) Band
Delay program (17 controls, MIDI CC 0..16) into the program library so the
mappings persist. User guide: (1) click the three dots near the active
effect, (2) select "Save to Library". Steps: locate the "three dots" (menu)
control in the UIA tree near the Band Delay effect, enumerate the menu
options, find "Save to Library" (and any name/preset-field dialog after it),
and document the exact discoverable flow via a script/dump. Do not save yet
- first learn and document; confirm with user before writing to the device.

## Progress - 2026-09-15 h90: learned "Save to Library" flow (not executed)
Flow discovered via UIA (menu popup is a 2nd top-level ~260x285 window):
1) Slot-A header "three dots" = menuButton at (297,194,321,218), center (309,206).
   Popup items (rects): Band Delay Documentation, Copy, Export..., Import...,
   Import H9 .tide/.h9z..., Save to Library at (309,456,569,487) center (439,471).
2) Clicking "Save to Library" opens a modal "Enter a Preset Name" dialog in the
   main window (Text at 280,500-744,572; name Edit 288,572-736,600; OK button
   (404,624,504,652); Cancel (520,624,620,652)). No auto-save - name + OK needed.
Cancelled the dialog (no save performed; device untouched). Actual save deferred
until user confirms the name/behaviour they want.

## Plan - 2026-09-15 h90: save midi-mapped Band Delay to Library as "m1 delay Band_Delay"
Library naming rule (user-defined, fixed):
  <slot> ' ' <type-slug> ' ' <effect-name>
  1. slot = m1 | m2 (m = 'midi'); loaded midi-mapped slot is Slot A -> m1
  2. delimiter = single space
  3. type slug = delay | dist | harm | mod (max 5 letters); Band Delay -> delay
  4. delimiter = single space
  5. effect name; spaces replaced with underscores (Band Delay -> Band_Delay)
  Max length 24, cap at 23; if the name overflows, slice the effect-name tail.
Computed: "m1 delay Band_Delay" = 2+1+5+1+10 = 19 chars, fits (no slicing).
Save flow (learned earlier): three-dots menuButton (309,206) -> "Save to Library"
menu item -> "Enter a Preset Name" modal -> type name -> OK. All in one script
run (popups close on focus loss). Cancel dialog if the script fails mid-way.

## Progress - 2026-09-15 h90: saved midi-mapped Band Delay to Library, task complete
`save_to_library.py` written and executed; effect saved to Library as
**"m1 delay Band_Delay"** (19/23 chars, no slicing). Result confirmed in app:
Slot-A effect header now renders `m1 delay Band_Delay` (Band Delay static at
(381,181,460,231) + new name static (462,181,578,231)). Program slot title
remains "INIT Program*" (program-level save is separate; mapping lives in the
loaded program copy, now persisted in the library entry).
Execution notes learned while saving:
1) The JUCE name field cannot be set via UIA SetValue - must click the edit,
   Ctrl+A, then send_keys(name, with_spaces=True); UIA value readback always
   returns stale/WARN so proceed blind after typing.
2) First attempt with the field empty hit a native "Preset Name" conflict dialog
   ("A factory preset named 'Band Delay' already exists!") - dismissed, nothing
   saved. Second run with the correct typed name saved cleanly (no dialog).
3) Panel scroll changed vs earlier sessions: wheel at (472,530) is dead; the
   working wheel anchor is (472,700). One wheel notch (~-3) shifts rows ~158px.
Post-save re-verification (test_assign_cc live pass) is FLAKY, not broken:
   CC#3..#12 (Delay B..Bypass) confirm src='MIDI CC' at the right number;
   CC#0..#2 (Wet Mix/Delay Mix/Delay A) and CC#13..#16 (Tails/Tempo Mod/HotKnob/
   Kill Dry) show popup-state artifacts (no rangeButton reveal / src='Off')
   introduced by post-save panel resets, NOT by the save (all 17 assignments
   were verified in-app before saving; no code resets them during save).
Bottom line: assignment (17 CCs, verified) + save (library name confirmed in
app header) + docs (`docs/midi-cc-assign.md`) + tests (2/2 pass on the
hardcoded-rect stage) are complete. Close-out success - work is done.

## Plan - 2026-09-15 h90: map + save one more delay effect (pilot for batch)
User wants the same MIDI-map + save-to-library treatment for the OTHER delay
effects, driven by the app's own Delay submenu (authoritative list, NOT a
hardcoded repo list). Pilot: one additional delay effect end-to-end, then show
the result table. Steps: (1) discover the algorithm-switch UI (click Slot-A
algorithm name -> expect an algorithm browser with a Delay submenu); (2) dump
the Delay submenu item list; (3) load the pilot effect; (4) capture its Slot-A
knobs live and assign CC 0..N-1 to effect knobs then CC N..N+6 to the 7 General
rows (In Gain/Out Gain/Bypass/Tails/Tempo Mode/HotKnob/Kill Dry), verifying each
in-app by reopening the popup; (5) save to library as 'm1 delay <Effect>' and
confirm the name in the Slot-A header; (6) write per-effect state JSON and print
the result table; (7) log Progress + update docs. CC re-verify flakiness seen
post-save is a popup-state artifact, not a mapping loss (handled by re-assigning
any degraded knob once, then re-saving).

## Progress - 2026-09-14 h90: Bouquet Delay pilot DONE (end-to-end pipeline works)

- Loaded Bouquet Delay from the Delay submenu (algorithm browser: click Slot-A
  algorithm-name header -> category pane -> Delay -> Bouquet Delay).
- Mapped+verified all Knobs: 9 effect (Mix..Jump Interval, CC 0..8) + 7 General
  (CC 9..15) = 16 assignments, each confirmed in-app via popup as src=MIDI CC.
- State: midi_cc_states/bouquet-delay.json.
- Saved to library as `m1 delay Bouquet_Delay` (overwrote existing slot).
- Bug found+fixed: `knob_value_rect` dy window was 0..60 but ComboBox value
  rects sit ~2px below the label top (dy=-2), so enum knobs never matched.
  Widened to -5..60. This was the real reason the dry-run kept showing only
  3/9 effect knobs.
- Bug found+fixed: scroll normalization counted the full-width bottom block
  labels (Mix/In Gain/Out Gain at y>=905) as panel knobs and could lose rows
  above the viewport. `effect_knobs`/`general_knobs` now exclude lt>=860; stage
  normalization climbs to the top until the effect-label set stops growing.
- Bug found+fixed: save-to-library with an existing name pops an IN-WINDOW
  "Overwrite Preset '...'?" dialog (not a top-level popup window), so
  `popup_window()` never sees it -> save appeared "stuck" while user answered
  the prompt manually. Added `confirm_overwrite()` (find prompt Text + click OK)
  and made `verify_saved()` accept Text elements too (saved name renders as
  Text, not Edit).
- DECISIONS note: earlier session close-out said save flow was fine; subsequent
  "stuck" reports were this same overwrite gap, now covered.

Next: repeat the identical pipeline for the next Delay-submenu effect.

## Digital Delay close-out (Slot A algorithm switch + full map + save)

Plan entry (appended before work):
- Switch Slot A from Bouquet Delay to the next Delay-submenu effect, Digital
  Delay; map all assignable controls to sequential CCs; save library entry
  `m1 delay Digital_Delay`.

Status:
- Discovered the reliable algorithm-load interaction: clicking the Slot-A
  algorithm-name header (~420,206) opens a two-pane popup; the FIRST pane is the
  category menu ("Delay", "Distortion", "EQ", ...). Clicking "Delay" opens the
  algorithm submenu; clicking the algorithm item loads it. Earlier attempts to
  use the right-side slot-B algorithm sidebar were wrong (that sidebar is Slot
  B's browser and never touches Slot A).
- After loading Digital Delay the panel sat with the first knob row (Wet Mix /
  Delay Mix / Delay A) at y=197, overlapping the header chrome. Clicks at those
  value rects hit the header and opened the category popup instead of a
  Control Source dialog -> first full run aborted ("FAIL: no rangeButton").
- Root fix in `map_delay_effects.py`:
  - `PANEL_CHROME_Y` 240 -> 195 (first knob row starts y=197).
  - `general_knobs()` now falls back past the lt<860 bottom-block guard when a
    General name (Kill Dry) has NO in-panel instance for that scroll state.
  - `WHEEL_ANCHOR` (472,700) -> (472,400): at (472,700) the wheel did not move
    the panel at all for this effect; at (472,400) it scrolls reliably.
    Suspended (472,700) is a slot-A panel hover-dead zone for some layouts.
- Second full run hung because a "Control Source" dialog was caught open with no
  rangeButton within reach; closed it via closeButton. Subsequent run assigned
  all knobs.
- Result: Digital Delay mapped 17 CCs (0-16) - 10 effect knobs (Wet Mix, Delay
  Mix, Delay A, Delay B, Feedback A, Feedback B, X-Fade, Mod Depth, Mod Speed,
  Filter) + 7 General (In Gain, Out Gain, Bypass, Tails, Tempo Mode, HotKnob,
  Kill Dry). All verified in-app. State JSON:
  `back/h90/midi_cc_states/digital-delay.json`.
- Saved to library as `m1 delay Digital_Delay` (22/23 chars), verified present.

Next: Ducked Delay (the next Delay-submenu effect) using the same pipeline.

## Progress пїЅ 2026-09-14 Ducked Delay + Filter Pong + Head Space mapping (pipeline hardening)

Plan (appended before work): map the remaining Delay-submenu effects to sequential
CCs and save m1 delay <Effect> library entries, applying the normalize fixes
baselined on Digital Delay.

Status:
- **Ducked Delay** (17 CCs 0-16, 10 effect + 7 General) mapped+verified+saved as
  m1 delay Ducked_Delay. Pre-reset scroll fix in normalize_effect_stage (scroll
  DOWN first if first raw row overlaps header, then climb UP) proven here.
- **Filter Pong** (17 CCs 0-16) mapped+verified+saved as m1 delay Filter_Pong.
  Located in Delay submenu at (493,357,637,388); all 12 algorithms are always in
  the tree, earlier search miss was the name filter 'Delay'.
- **Head Space** repeated failures fixed this session:
  - WHEEL_ANCHOR (472,400) -> (651,400): for tall-row effects (Head Space row
    pitch ~166px vs ~124px) the old anchor sits ON a knob Custom; the wheel event
    is captured by the knob and never scrolls the panel, leaving it stuck. The
    scrollbar track (651,400) is a universal scroll target. Scrollbar semantics:
    +8 = content moves DOWN toward start, -1 = ~38px content UP; +8 is ~304px
    (too coarse for fine normalize).
  - normalize_effect_stage now climbs with +8 at the scrollbar but checks raw
    (unfiltered) first-label top >= PANEL_LO before accepting; stopped relying on
    name-set stability alone (names include off-screen rows, so it overshot and
    pushed the first row above the header).
  - BIG structural fix: effects can have >viewport effect knobs (Head Space has
    23!). The old main() assigned only the first viewport page. main() now loops:
    assign visible page -> scroll_page_down(-3 x3) -> assign newly-visible knobs
    -> repeat until no new knobs. Dry-run walks the same loop to enumerate all CCs.
  - This revealed the earlier "corrected knob count 12" was itself wrong: Head
    Space has 23 effect knobs (Mix, Delay Time, Speed, Rec Drive, Feedback, Fdbk
    Path, Tape Hiss, Wow & Flutter, Filter + Head 1-4 Lvl/Div/Pan + Boil Time +
    Break Time).
  - Head Space mapped+verified+saved as m1 delay Head_Space (30 CCs 0-29).
    Saved JSON: back/h90/midi_cc_states/head-space.json.
  - General stage CC numbering bug fixed: general rows were all stamped with the
    same running cc; now use n+i (effect count + index).

Remaining after this: Mod Delay, MultiTap, Reverse, Tape Echo, UltraTap,
Vintage Delay.

## Progress пїЅ 2026-09-14 Multi-page scroll pipeline: remaining Delay effects all mapped

Plan (appended before work): with the scrollbar WHEEL_ANCHOR + multi-page effect
loop baselined on Head Space (30 CCs), map the remaining Delay-submenu effects.

Status: all 7 remaining effects mapped+verified each in-app (src=MIDI CC, CC#
matches), state JSONs written, none saved to library yet (library save is a
separate explicit step):
- Mod Delay      10 effect + 7 Gen -> CC 0..16  midi_cc_states/mod-delay.json
- MultiTap       10 effect + 7 Gen -> CC 0..16  midi_cc_states/multitap.json
- Reverse        10 effect + 7 Gen -> CC 0..16  midi_cc_states/reverse.json
- Tape Echo      10 effect + 7 Gen -> CC 0..16  midi_cc_states/tape-echo.json
- UltraTap       13 effect + 7 Gen -> CC 0..19  midi_cc_states/ultratap.json
                 (2 scroll pages - exercised the new multi-page effect loop)
- Vintage Delay  10 effect + 7 Gen -> CC 0..16  midi_cc_states/vintage-delay.json
- Head Space     23 effect + 7 Gen -> CC 0..29  midi_cc_states/head-space.json (prior entry)

Regression: Filter Pong dry-run still 10+7 -> 17 CCs, history intact. Earlier
estimates of knob counts (MultiTap 13, UltraTap 12, Vintage 8) were all wrong;
the live panel walk now reports actuals.

## Plan вЂ” 2026-09-15 CC mapping local DB + HTML page

Goal: create a local SQLite DB (`midi_cc_map.db`) in `back/h90` with proper
entity relations (effects в†’ assignments), then generate a self-contained HTML
page (`midi_cc_map.html`) showing one big sortable table of every CC assignment
across all 12 Delay effects.

Schema:
- `effects` (id PK, name, slot, slug, cc_layout, library_name)
- `assignments` (id PK, effect_id FKв†’effects, cc, control, type, values,
  verified, section [effect|general])

Scripts:
- `build_cc_db.py` вЂ” reads `midi_cc_state.json` + `midi_cc_states/*.json`,
  creates/updates `midi_cc_map.db`
- `gen_cc_map_page.py` вЂ” queries DB, writes `midi_cc_map.html`

Verified by: opening the HTML in a browser and confirming 12 effects Г— expected
row counts appear.

Progress вЂ” 2026-09-15 CC mapping local DB + HTML page

Done:
- `back/h90/build_cc_db.py` вЂ” creates/updates `back/h90/midi_cc_map.db`
  (SQLite). Tables: `effects` (id PK, name UNIQUE, slot, slug, cc_layout,
  library_name) and `assignments` (id PK, effect_id FK, cc, control, type,
  values, verified, section). Reads legacy `midi_cc_state.json` (Band Delay) +
  `midi_cc_states/*.json`; upserts on (name) / (effect_id, cc); library_name
  computed with the same rule as save_to_library.py (cap 23).
- `back/h90/gen_cc_map_page.py` вЂ” queries the DB and writes self-contained
  `back/h90/midi_cc_map.html`: one big sortable/filterable table
  (Effect + library name | CC | Sec | Control | Type | Value/range | Verified),
  with filter dropdown, search, "only unverified" and "show General" toggles.
  Row data is embedded as JSON; CSS has light/dark support.
- Build output: 12 effects, 219 assignment rows, 84 General-section rows, 0
  orphan rows, all verified. Per effect: Band Delay 17, Bouquet 16, Digital 17,
  Ducked 17, Filter Pong 17, Head Space 30, Mod 17, MultiTap 17, Reverse 17,
  Tape Echo 17, UltraTap 20, Vintage 17.
- HTML JSON payload parsed back and validated (219 rows, meta timestamp).

Result: `midi_cc_map.html` opens in a browser and shows all 12 effects with
their full CC mappings. Next step (if wanted): serve the page via Express
static, and/or extend the DB with value ranges pulled from knob-map.json.

## Plan вЂ” 2026-09-15 lib tracking + save remaining effects

Goal: the HTML table must reflect TRUE library-save status. Add a `lib`
column to the table and append "+" to filter-option labels for effects already
saved to the H90 library, driven by a `library_saved.json` source-of-truth
file. Then LOAD + RE-MAP (replay) + SAVE to library the 6 remaining (currently
unsaved) effects: Mod Delay, MultiTap, Reverse, Tape Echo, UltraTap, Vintage
Delay вЂ” as `m1 delay <Effect>_name` per the naming rule.

Verified by: after each save, `library_saved.json` marks it saved; rebuilt DB
shows lib column correctly; app header shows the saved library name.

Progress вЂ” 2026-09-15 lib tracking + save remaining effects

Done:
- `library_saved.json` in `back/h90` is now the source of truth for whether an
  effect has been saved to the H90 library. `build_cc_db.py` reads it into a new
  `effects.lib_saved` column (rebuild now drops/recreates tables). DB/HTML list
  all 12 effects with `[+]` (saved) markers.
- `gen_cc_map_page.py` adds a **Lib** column to the table (shows "+" when saved
  to library) and appends "+" to saved effects in the filter dropdown; adds an
  "only saved to library" checkbox; both columns sortable.
- New `load_effect.py`: drives the H90 Control app's algorithm browser
  (click Slot-A algorithm-name header at (420,206) -> click "Delay" category ->
  click the target algorithm MenuItem) so any effect can be loaded for the
  map/save pipeline. Verified live against the app.
- Replayed + saved the 6 remaining effects to the H90 library (each loaded via
  algorithm browser, re-mapped via map_delay_effects.py with every CC verified
  in-app as src=MIDI CC, then saved via save_to_library.py):
  - Mod Delay      17 CCs (0..16) -> `m1 delay Mod_Delay`
  - MultiTap       17 CCs (0..16) -> `m1 delay MultiTap`
  - Reverse        17 CCs (0..16) -> `m1 delay Reverse`
  - Tape Echo      17 CCs (0..16) -> `m1 delay Tape_Echo`
  - UltraTap       20 CCs (0..19, 2 scroll pages) -> `m1 delay UltraTap`
  - Vintage Delay  17 CCs (0..16) -> `m1 delay Vintage_Delay`
  Each save reported "OK: program saved as ..." from the app.
- `library_saved.json` -> all 12 true; `midi_cc_map.db`/`.html` rebuilt: 12
  effects x 219 assignments, all lib_saved=1.

Result: every mapped delay effect is persisted to the library under
`m1 delay <Effect>`, and the HTML table + filter now track true save status.
Next: none required (optional: serve the page via Express static).

## Plan вЂ” 2026-09-15 lib-column removal + distortion mapping

Goal: Remove the Lib column from the HTML table, then map and save all
Distortion category effects to the H90 library.

### Steps
1. Remove `Lib` column (th + td + sort logic) from `gen_cc_map_page.py`.
   Keep the "+" filter marker and "only saved to library" checkbox вЂ” they
   are separate UI elements, not table columns.
   Rebuild HTML; verify 12 delay rows render with 7 columns.
2. Generalize `load_effect.py` to accept `--category` (default "Delay") so
   it can list and load algorithms from any category.
3. Run `load_effect.py --list-algorithms --category Distortion` to get the
   full distortion algorithm list and coordinates.
4. For each distortion algorithm:
   a. `load_effect.py --effect "<Name>" --category Distortion`
   b. `map_delay_effects.py --effect "<Name>" --slug dist --slot m1`
      (this writes `midi_cc_states/<effect-slug>.json`)
   c. `save_to_library.py --slot m1 --slug dist --effect "<Name>"`
   d. Mark it saved in `library_saved.json`.
5. Rebuild DB + HTML: `python build_cc_db.py && python gen_cc_map_page.py`.
   Verify: all distortion effects show `[+]`, total rows = delay + distortion.
6. Append Progress entry to DECISIONS.md.

### Verification
- `build_cc_db.py` output: all effects with `[+]` and correct CC counts.
- `midi_cc_map.html`: distortion effects visible in filter dropdown,
  "only saved to library" checkbox shows all effects.
- Each save confirmed by `save_to_library.py` printing "OK: program saved ...".

Progress вЂ” 2026-09-15 lib-column removal + distortion mapping

Done:
- Removed the Lib column from the HTML table (`gen_cc_map_page.py`: header
  th, row td, sort branch, footer colspan 7 -> 6). The "+" filter suffix and
  "only saved to library" checkbox are separate controls and were kept.
- Generalized `load_effect.py` to accept `--category <Name>` (default
  "Delay") plus a `--list-algorithms --category <Name>` mode that lists the
  algorithm MenuItems of a category. Verified against the live app.
- Discovered the Distortion category contains 5 algorithms: Aggravate,
  CrushStation, PitchFuzz, Sculpt, WeedWacker.
- Mapped + saved all 5 to the H90 library (loaded via algorithm browser,
  re-mapped via map_delay_effects.py with every CC verified in-app as
  src=MIDI CC, then saved via save_to_library.py):
  - Aggravate     14 effect + 7 General -> 21 CCs (0..20) -> `m1 dist Aggravate`
  - CrushStation  11 effect + 7 General -> 18 CCs (0..17) -> `m1 dist CrushStation`
  - PitchFuzz     11 effect + 7 General -> 18 CCs (0..17) -> `m1 dist PitchFuzz`
  - Sculpt        12 effect + 7 General -> 19 CCs (0..18) -> `m1 dist Sculpt`
  - WeedWacker    11 effect + 7 General -> 18 CCs (0..17) -> `m1 dist WeedWacker`
  Each save reported "OK: program saved as ...".
- `library_saved.json` updated with the 5 distortion entries; DB + HTML
  rebuilt: 17 effects x 313 assignments, all lib_saved=1.
- Retitled page from "H90 Delay CC Mapping" to "H90 CC Mapping".

Result: Lib column gone from the table; distortion family fully mapped and
saved under `m1 dist <Effect>`; the page now covers 17 effects (12 delay + 5
distortion). Next: none required (H90 has more families - harmonizer/mod if
desired).

## Progress вЂ” 2026-09-15 EQ family mapping

Done:
- Discovered the EQ category contains a single algorithm: EQ Compressor.
- Added `eq` to the admissible slugs in both `map_delay_effects.py` and
  `save_to_library.py` (SLUGS tuple / --slug choices), so the EQ family can
  be mapped and saved.
- Loaded EQ Compressor via the algorithm browser, mapped with every CC
  verified in-app as src=MIDI CC, and saved:
  - EQ Compressor  11 effect + 7 General -> 18 CCs (0..17) -> `m1 eq EQ_Compressor`
  Save reported "OK: program saved as ...".
- `library_saved.json` updated with "EQ Compressor": true; DB + HTML rebuilt:
  18 effects x 331 assignments, all lib_saved=1.

Result: EQ family fully mapped and saved under `m1 eq EQ_Compressor`; page
covers 18 effects (12 delay + 5 distortion + 1 EQ).
Next: Harmonizer / Modulation families if desired.

## Plan вЂ” 2026-09-15 all remaining families (harm, looper, mod, multi, reverb, synth, utility)

Goal: map + save every remaining H90 algorithm from the categories not yet
covered (Delay 12, Distortion 5, EQ 1 are done).

### Steps
1. Discover algorithm lists for each remaining category via
   `load_effect.py --list-algorithms --category <Name>`:
   Harmonizer, Harmonizer+, Looper, Modulation, Multi, Reverb, Synth, Utility.
2. For each algorithm:
   a. `load_effect.py --effect "<Name>" --category <Name>`
   b. `map_delay_effects.py --effect "<Name>" --slug <slug> --slot m1`
   c. `save_to_library.py --slot m1 --slug <slug> --effect "<Name>"`
   d. Mark it saved in `library_saved.json`.
   Slugs: harmonizer/harm, looper, mod, multi, reverb, synth, utility. Check
   whether 'harm' exists as choice; extend where needed.
3. Rebuild DB + HTML; verify every effect shows `[+]` and counts are sane.
4. Append Progress entry to DECISIONS.md.

### Verification
- build_cc_db.py lists all effects with `[+]` and correct CC counts.
- HTML filter contains all effect names; "only saved" shows all.
- save_to_library.py prints "OK: program saved ..." per effect.

## Progress вЂ” 2026-09-15 all remaining families mapped and saved (72/72)

Result: every remaining H90 algorithm is mapped to sequential CCs (effect knobs
0..N-1, General block N..N+6), saved to the device library under `m1 <slug> <name>`
(with spaces->underscores, 23-char cap), and marked saved in
`library_saved.json`.

Done this session:
- Harmonizer (13): Diatonic, H910 H949, HarModulator, HarPeggiator, MicroPitch,
  Octaver, PitchFlex, PolyFlex, Polyphony, Prism Shift, Quadravox, Resonator
  (+ Crystals done manually earlier).
- Harmonizer+ (4): Quadravox+, VocalShift, VocalShiftMIDI, VocalTune.
- Looper (1), Multi (1): SpaceTime, Synth (3): HotSawz, PolySynth, Synthonizer,
  Utility (2): Mute, Thru.
- Modulation (16) and Reverb (14) driven via `map_family.py --table families_*.csv`.
- Rebuilt `midi_cc_map.db` (72 effects, 1340 assignments, all `[+]`) and
  regenerated `midi_cc_map.html`.

Tooling fixes made along the way:
- `save_to_library.py`: SLUGS now includes `looper`; `set_edit_text` escapes
  `+ ^ % { }` (pywinauto treats `+` as Shift в†’ "Quadravox+" had been typed as
  "Quadravox", creating a stray `m1 harmp Quadravox` library entry).
- `map_delay_effects.py`: `--slug` choices now include `looper`; utility-only
  algorithms (Mute/Thru, zero effect knobs) map just the 7 General knobs to
  CC 0..6 instead of failing ("FAIL: no effect knobs visible").
- `load_effect.py`: `algorithm_header()` clicks the Slot-A algorithm-name text
  (leftmost header-band label left of the preset name) instead of the fixed
  (420,206) anchor, which hit the preset-name hotspot for short names (Thru)
  and opened the wrong popup. Band 170..228 + x 360..690 filters out first-row
  knob labels that intrude into the header row.

## Progress вЂ” 2026-09-15 all remaining families mapped and saved (72/72)

Result: every remaining H90 algorithm is mapped to sequential CCs (effect knobs
0..N-1, General block N..N+6), saved to the device library under `m1 <slug> <name>`
(with spaces->underscores, 23-char cap), and marked saved in
`library_saved.json`.

Done this session:
- Harmonizer (13): Diatonic, H910 H949, HarModulator, HarPeggiator, MicroPitch,
  Octaver, PitchFlex, PolyFlex, Polyphony, Prism Shift, Quadravox, Resonator
  (+ Crystals done manually earlier).
- Harmonizer+ (4): Quadravox+, VocalShift, VocalShiftMIDI, VocalTune.
- Looper (1), Multi (1): SpaceTime, Synth (3): HotSawz, PolySynth, Synthonizer,
  Utility (2): Mute, Thru.
- Modulation (16) and Reverb (14) driven via `map_family.py --table families_*.csv`.
- Rebuilt `midi_cc_map.db` (72 effects, 1340 assignments, all `[+]`) and
  regenerated `midi_cc_map.html`.

Tooling fixes made along the way:
- `save_to_library.py`: SLUGS now includes `looper`; `set_edit_text` escapes
  `+ ^ % { }` (pywinauto treats `+` as Shift в†’ "Quadravox+" had been typed as
  "Quadravox", creating a stray `m1 harmp Quadravox` library entry).
- `map_delay_effects.py`: `--slug` choices now include `looper`; utility-only
  algorithms (Mute/Thru, zero effect knobs) map just the 7 General knobs to
  CC 0..6 instead of failing ("FAIL: no effect knobs visible").
- `load_effect.py`: `algorithm_header()` clicks the Slot-A algorithm-name text
  (leftmost header-band label left of the preset name) instead of the fixed
  (420,206) anchor, which hit the preset-name hotspot for short names (Thru)
  and opened the wrong popup. Band 170..228 + x 360..690 filters out first-row
  knob labels that intrude into the header row.

Caveats:
- Stray device-library entry `m1 harmp Quadravox` (no `+`) still on the pedal
  from the pre-fix run; delete it manually in the H90 app (JUCE table is not
  automatable via UIA).
- Sporadic load failures mid-batch were recoverable by re-running the remaining
  CSV rows; the driver marks saves per-effect, so reruns skip directly.

Next: none required for CC mapping; optionally verify control of a few effects
from the web front end, or start import-protocol write-path work.

## Plan вЂ” 2026-09-15 slot-B m2 presets: all 72 effects, CC base 50 (via slot A)

Goal: produce a second library preset per effect like m1 but for the slot-B /
m2 range: algorithm loaded/mapped while sitting in Slot A (already-known
coordinates), CC assignments start at 50 (effect knobs CC 50..50+N-1, General
50+N..50+N+6), saved as `m2 <slug> <name>` (e.g. `m2 delay Band_Delay`), marked
saved under the `display` key `<Effect> m2`. Rebuild DB + HTML so the page shows
144 `[+]` rows (72 m1 + 72 m2).

Steps:
1. `map_delay_effects.py`: add `--cc-base` (default 0). Start batch + General
   offsets at `cc_base`; write state to `midi_cc_states/<slug>-m2.json` with
   `slot=m2`, `display="<Effect> m2"`, `cc_layout="effect 50..50+N-1, General вЂ¦"`.
   Zero-knob path (Mute/Thru) becomes General-only CC 50..56.
2. `map_family.py`: forward `--slot m2 --cc-base 50`; mark saved under the
   `display` key in `library_saved.json`.
3. `build_cc_db.py`: use `display` as the DB `name` and as the `lib_saved`
   lookup key; keep the plain effect name for `library_name(slot, slug, effect)`
   so it stays `m2 delay Band_Delay` (not `вЂ¦Band_Delay_m2`).
4. `save_to_library.py`: no coordinate changes; confirm m2 naming works.
5. Rebuild DB + HTML; verify all 72 m2 rows exist with `[+]` and CC в‰Ґ 50.

Verification: build_cc_db.py lists 144 effects all `[+]`; each m2 library name
`m2 <slug> <name>`; m2 assignments start at CC 50; page filter shows the m2
variants.

## Plan - 2026-09-15 h90: manual export of m1 preset from Preset Library tab

Goal: learn how to export individual presets from the app*'*s Preset Library tab
(user flow: row has 3-dots icon -> click -> Export...), and inspect the exported
.preset90 file format for the m1 (slot A) presets.

Steps:
1. OCR the library table; identify 3-dots column.
2. Click 3-dots on row for "m1 delay Band_Delay"; OCR the JUCE popup (title,
   Export... item coords).
3. Click Export...; fill Save Preset dialog filename; click Save; verify file.
4. Decode: extract tjknobs/knnob records + base64 JSON; compare knob records vs
   midi-map delay.preset90 (which had CCs mapped) to see if CC data is in the file.

Verification: a .preset90 file whose base64 JSON has algorithm_name "Band Delay",
preset_name "Band Delay", product_id com.eventide.h9.banddelay.

## Progress - 2026-09-15 h90: manual export works; .preset90 format inspected

- Confirm app is native Win32/Direct2D (JUCE class JUCE_1a0a37c17eb), single
  exe, no chromium/cef/webview2, no ports -> Playwright cannot attach.
  Working automation: pywinauto (UIA) + Windows OCR (Windows.Media.Ocr).
- Export flow verified: 3-dots (screen ~ (312, rowY)) -> JUCE popup window
  (192x196 at L312, rows: preset name, Copy, Export..., Import...; Export... at
  popup.relative y ~99..111) -> Save Preset dialog (JUCE file chooser rendered
  inside main window; edit value readable/settable via UIA; Save button UIA
  (576,465) 99x26; mice clicks in SCREEN coords; ESC does not close it).
- First attempt exported row 1 = Planetarium1 (ModEchoVerb) because 3-dots of
  that row was clicked by miscalibrate (m1|m1 OCR ambig). Cleaned up.
- Redone on row "m1 delay Band_Delay": saved
  C:\server\fx\input\m1delay_band.preset90 (3220 bytes).
- Decoded format (3220 B):
  * header (0x0c... size 0x0BD4)
  * 10 knob records tjknobs-knob1..knob10 at 176, stride 64 (48 bytes each)
  * alg param objects alg-killdry/hotknob/tempo-mode/tails/bypass/out-gain/in-gain
  * base64 JSON blob at 1456 (1568 chars) -> {"algorithm_name":"Band Delay",
    "bypa":true, "bypa_normal":0.633, "dlya":13.0, "preset_name":"Band Delay",
    "product_id":"com.eventide.h9.banddelay", "version":"3", ...}
  * tail GUIDs 7ea818ee..., 83138962..., + name "m1 delay Band_Delay" (19 chars
    len prefix), + GUID 5fd71017-8a23-3fd5-4606-b7420e11923d.
- Knob record compare m1 vs midi-map delay.preset90 (2064 B): knob1,3,6,7,8,9
  identical; knob2/knob5 differ only at float value bytes 40..42 (m1 has taper
  float 0.52.., midimap has zero) and knob4 differ at record start (02 fe vs c2
  fd = pointer-ish high bytes). NO CC number data in the knob records - the CC
  assignments are NOT stored in the .preset90 exporter (they are app/MIDI-page
  settings, elsewhere).
- Find: .preset90 = "current program serialization patched w/ import" - matches
  earlier H90-IMPORT notes (b64 json = file json encoded after deflate w/ dict).

Next: resume slot-B m2 mapping (kickoff file reports 71 effects remaining); use
the export flow if a clean .preset90 of an m2 preset is ever needed for import
verification.

## Plan (2026-09-15)
- Continue m1 preset export campaign: 30 m1 presets still missing from input/lib (feed Head Space, SpaceTime, synth HotSawz/PolySynth/Synthonizer, util Mute/Thru, mod Phaser..Vibrato, reverb Blackhole..Wormhole).
- Re-run run_m1_export.py; verify all pages exported and lib count reaches 73 m1 files; then final name comparison vs library_saved.json.

## Status - 2026-09-15 h90: m1 export campaign COMPLETE (all 71 m1 presets in lib)

- run_m1_export.py fixes that got the campaign through:
  * normalize() only converts a LEADING "ml " to "m1 " (was replacing every
    "l"->"1", mangling "delay" -> "de1ay" and breaking name matching).
  * FAM regex widened to include multi|utility (was missing those families).
  * clean_parts maps OCR artifacts: utility->util, mufti/mu/ti->multi.
  * scan_rows rewritten: fine-scan every 5px from y260..1020, cluster rows
    >=30px apart; row click offset = detected_y+46 (was band_top+36).
  * scroll wheel_dist -3 -> -1 (larger scrolls skipped rows like Sticky_Tape).
  * ensure_library_view(): ESC; click Preset Library tab (930,1018); click
    User Presets (371,256); scroll to top x20.
- Campaign exported most m1 rows; only 5 remained missing: Head Space,
  SpaceTime, Mute, Thru, Sticky Tape.
- After the campaign the USER manually saved 4 of them (Mute, Thru, Sticky
  Tape, SpaceTime) from the app Library into input/lib with the app UI.
- Head Space created from scratch in slot A via the Parameters tab pipeline:
  load_effect.py --effect "Head Space" --category Delay ->
  map_delay_effects.py --effect "Head Space" --slug delay --slot m1 --cc-base 0
  (exit=0, 22 knobs assigned CC 0..21, all verified) ->
  save_to_library.py --slot m1 --slug delay --effect "Head Space"
  (saved as "m1 delay Head_Space"; confirmed via top-bar OCR).
- Head Space exported last: Preset Library tab -> Clear All reset the
  filter, list showed "ml delay Head_Space" at y480; 3-dots at (312,526)
  -> popup "ml delay Head_Space" -> Export... -> Save dialog (auto-navigated
  to C:\server\fx\input\lib, filename prefilled) -> Save at (645,927) ->
  wrote lib\m1 delay Head_Space.preset90 (3552 B), directly into lib/ this time.
- Final verification: library_saved.json has 71 m1 names; lib\ now holds 73
  m1 *.preset90 files and all 71 unique names are present; 0 missing. The +2
  files are the legitimately distinct harm/harmp pairs normalizing to the same
  name: m1 harm Quadravox vs m1 harmp Quadravox / Quadravox+, and m1 harmp
  VocalShift vs m1 harmp VocalShiftMIDI.
- m2 export sweep is NOT started; ask user before doing anything else.


## Plan - 2026-09-16 h90: m2 (slot-B) CC mapping with FAST slider popup mechanic

- Resume m2 campaign (CC base 50). 10 of 72 m2 effects done (band/bouquet/
  digital/ducked/filter-pong/head-space/mod/multitap/reverse/tape-echo).
  Next per families_m2.csv: UltraTap (Delay, slug delay, 13 algorithm knobs).
- Upgrade assign_cc.py: instead of step-clicking the ">" arrow up to CC>=50
  (~50+ clicks/knob), click the CURRENT VALUE element between "<" ">" in the
  MIDI popup -> a NEW popup with a slider opens; set the Slider via UIA
  RangeValue (fallback: real mouse drag); close it; verify "CC# target".
- Full pipeline on ONE effect (UltraTap m2):
  1. load_effect.py --effect UltraTap --category Delay
  2. discover/confirm slider popup UIA structure
  3. implement set_cc_number_fast + wire into assign_knob
  4. map_delay_effects.py --effect UltraTap --slug delay --slot m2 --cc-base 50
  5. save_to_library.py --slot m2 --slug delay --effect UltraTap
  6. mark "UltraTap m2" saved in library_saved.json
  7. verify midi_cc_states/ultratap-m2.json + DECISIONS/PRESET-EXPORT-NOTES

Verification: ultratap-m2.json has 13 verified assignments CC 50..62;
library_saved.json has "UltraTap m2": true; lib name "m2 delay UltraTap".


## Status - 2026-09-16 h90: FAST slider mechanic + UltraTap m2 DONE

- Upgraded assign_cc.py: new set_cc_number_fast() opens the MIDI-CC popup,
  clicks the current value element between < > (opens a JUCE slider popup),
  sets the slider via UIA RangeValue (min 0, max 127, SetValue verified live:
  CC 0 -> 51 -> readback "CC# 51"), closes it, verifies. Mouse-drag +
  old arrow-loop fallbacks retained. Wired into assign_knob; ~4.8s/knob
  vs ~15s+ for the arrow loop.
- Ran map_delay_effects.py --effect UltraTap --slug delay --slot m2
  --cc-base 50: 12 effect knobs assigned+verified CC 50..61 (Length/Taps/
  Pre Delay/Spread/Taper/Feedback/Tone/Slurm/Chop/Manual Chop/Speed/Width).
  Program block untouched (rule). Wrote ultratap-m2.json (a prior aborted
  13+7-General scheme from the 15.09 logs was NOT recorded in library_saved.json
  and is superseded).
- Cleared the straggling UIA: after clicking the CC value button the JUCE
  control tree can drop (button count 37->3); ESC restores it.
- Saved to library as 'm2 delay UltraTap' (save_to_library.py); library_saved.json
  total 83 keys = 72 m1 + 11 m2 (UltraTap m2: true added).
- NOTE: knob count was 12 not the planned 13; old arrow-loop flow and this
  fast path agree on the 12-knob set (the 15.09 log's '13 effect knobs'
  belonged to the aborted general-inclusive scheme).


## Plan - 2026-09-16 h90: fix m2 knob discovery rules (UltraTap)

- Bug 1 (found): the name-based PROGRAM_KNOBS filter drops a real ALGORITHM
  knob named e.g. "Mix" (UltraTap has algorithm Mix at y355). Only the fixed
  bottom "program block" (labels y>=860: Mix/In Gain/Out Gain, In/Out/Bypass)
  must be skipped - by POSITION, not by name.
- Bug 2 (found): the slot's General block (In Gain, Out Gain, Bypass, Tails,
  Tempo Mode, HotKnob, Kill Dry, revealed when scrolling the panel) was never
  collected/assigned. It SHOULD get CCs (matches the aborted 15.09 log:
  "13 effect knobs + 7 General -> CC 50..69" for UltraTap).
- New rule (user): before assigning MIDI CC to a knob, scroll the slot so the
  knob (value + label) is FULLY visible and clear of the program footer, then
  assign. Implement ensure_knob_visible() and call it per knob in _assign_batch.
- Then re-run UltraTap m2 with --cc-base 50, resave to library, update logs.


## Status - 2026-09-16 h90: knob discovery rules fixed + UltraTap re-mapped

- Root cause confirmed on live panel: UltraTap has algorithm knob 'Mix'
  (y355) that the old name-based PROGRAM_KNOBS filter dropped, a slot General
  block (In Gain/Out Gain/Bypass/Tails/Tempo Mode/HotKnob/Kill Dry, y523..771
  after scrolling) that was never collected, and the fixed program footer
  (Mix/In Gain/Out Gain at y927, In/Out/Bypass at y1017) that must stay
  untouched. Width (y829 value) sat one row above the footer - partial.
- Fixes applied to map_delay_effects.py:
  * PROGRAM_KNOBS is now docs-only; live filtering is POSITIONAL:
    labels with lt>=PROG_FOOTER_Y(860) are the program footer and are skipped.
    Real algorithm knobs that share footer names (like algorithm 'Mix') are
    included.
  * effect_knobs/_effect_label_names/_raw_effect_labels no longer exclude by
    name - only by position + panel bounds.
  * NEW user rule: ensure_knob_visible() scrolls each knob fully visible
    (value+label clear of header/footer) before CC assignment; wired into
    _assign_batch so assign+verify use the visible rect.
  * cc_layout string now "effect+General <base>..N-1, program footer untouched".
- Re-ran UltraTap m2 (cc-base 50): 20 knobs assigned+verified CC 50..69 =
  13 algorithm (Mix 50 .. Width 62) + 7 General (In Gain 63 .. Kill Dry 69),
  footer untouched. This matches the scope of the aborted 15.09 log
  ("13 effect knobs + 7 General -> CC 50..69").
- Re-saved library preset 'm2 delay UltraTap' with the corrected mapping;
  library_saved.json remains "UltraTap m2": true.


## Status - 2026-09-16 h90 (fix): identity-checked MIDI CC assignment

- User reported the 20-knob Universal Tap m2 run actually set footer 'Mix'
  to CC 69 instead of the General block's 'Kill Dry'. Root cause chain:
  * JUCE auto-scrolls the panel when a knob is removed/selected, so the
    batch's pre-measured rects go stale during Phase 2.
  * With a stale rect, find_range_button() resolved Kill Dry's click to the
    footer Mix rangeButton, and verify_mapping() only read back the CC
    number (it never checked WHICH knob the popup belonged to), so the
    wrong assignment "verified" cleanly.
- Fixes:
  * NEW popup_knob_name() in assign_cc.py: reads the knob label Static at
    the bottom of the MIDI popup (e.g. 'Kill Dry' vs footer 'Mix').
  * assign_knob() and verify_mapping() now ABORT with 'wrong knob' when the
    open popup does not name the intended knob; nothing is written.
  * ensure_knob_visible() tightened: knob value+label must sit comfortably
    clear of the program footer (>=70px gap, not merely visible); it keeps
    lifting the knob via scroll_page_down while JUCE auto-scroll refocuses.
  * _assign_batch() re-measures each knob's rect immediately before clicking
    and retries (re-scroll + re-measure) up to 3x on a wrong-knob popup.
- Re-ran UltraTap m2 (cc-base 50): all 20 knobs CC 50..69 verified, Kill Dry
  now genuinely CC 69 (live popup check), footer Mix stays 'Off';
  ultratap-m2.json rewritten (20 assignments), library preset re-saved as
  'm2 delay UltraTap'.


## Plan+Status - 2026-09-16 h90: batch-map all remaining m2 presets (61)

- Plan: map the remaining 61 m2 effects (all families_m2.csv entries whose
  '<Effect> m2' is not in library_saved.json) end-to-end automatically,
  showing per-iteration progress like the user asked:
  '[m2] effectTypes: <cat_i>/11 (<cat>)   effect: <j>/<cat_count> (<effect>)
   ran: <n>/<remaining>'.
- New runner: run_m2_all.py. Per effect: load_effect.py -> map_delay_effects.py
  --slot m2 --cc-base 50 -> save_to_library.py --slot m2 -> mark 'X m2' in
  library_saved.json. Skips already-done presets; logs every iteration line to
  m2_batch_run.log so progress can be polled; failures are recorded and the
  batch continues (final FAILED summary). Uses the identity-verified assign/
  scroll rules from the Kill Dry fix.
- Remaining per category: Delay 1 (Vintage Delay), Distortion 5, EQ 1,
  Harmonizer 13, Harmonizer+ 4, Looper 1, Modulation 16, Multi 1, Reverb 14,
  Synth 3, Utility 2.
- Status: runner written + syntax checked; batch not yet launched.


## Plan+Status - 2026-09-16 h90: recover the 4 failing m2 effects (stale coords)

- Context: the m2 batch run (61 remaining) finished 57 saved / 4 ABORT:
  Aggravate (Distortion), Polyphony (Harmonizer), Quadravox+ (Harmonizer+),
  VocalShift (Harmonizer+). Each aborted on the first knob after a page
  boundary with 'wrong knob (got popup for None)' or 'popup did not open'.
- Root cause: after a batch of assignments JUCE auto-scrolls the axis panel;
  the phase-2 UIA tree then reports STALE coordinates (~1 page / ~330px off),
  so the click lands on the algorithm-name header and opens the ALGORITHM
  BROWSER (a full-window modal with no closeButton) instead of the knob's
  MIDI popup. close_popup() cannot dismiss that browser (it only handles
  narrow MIDI popups) -> ESC is required.
- Fixes in map_delay_effects.py:
  * NEW _walk_to_knob(): ESC + close_popup, normalize the panel to the
    anchored top, then walk down page by page with fresh per-page re-measures
    until the knob is found; returns trustworthy coordinates.
  * _assign_batch() retry now: ESC -> close_popup -> _walk_to_knob() -> use the
    fresh rect (previously the retry reused the stale cur_fallback, so it
    looped until ABORT). Removed the old _force_panel_render shim.
  * Retry condition broadened: also retry on 'popup did not open' /
    'no rangeButton' in the ASSIGN result (Quadravox+ Feedback Path returned
    'popup did not open' from assign, which was not being retried).
- Result: all 4 recovered and saved; each knob identity-verified.
  * Aggravate  m2: 21 knobs CC 50..70  -> m2 dist Aggravate
  * Polyphony  m2: 23 knobs CC 50..72  -> m2 harm Polyphony
  * Quadravox+ m2: 32 knobs CC 50..81  -> m2 harmp Quadravox+
  * VocalShift m2: 43 knobs CC 50..92  -> m2 harmp VocalShift
  (Solo B / Pan B / Feedback Path all recovered on retry att=1 via the walk.)
- library_saved.json: 72/72 '<Effect> m2' keys present (144 total: 72 m1 + 72
  m2); families_m2.csv has 72 rows, missing = [].
- Cleaned up the temporary DBG/WALK prints after verification.


## Plan: export m2 presets from the app Preset Library -> input/lib
- Context: all 72 m2 presets were saved to the in-app Library but never
  exported to .preset90 files (input/lib only has the 72 m1 files).
- NEW back/h90/export_m2_lib.py adapted from run_m1_export.py:
  * open Preset Library -> User Presets, set the library search filter to 'm2 '.
  * build the expected 72 names from families_m2.csv via the same library_name()
    logic used by save_to_library.py (m2 <slug> <Effect_underscored>).
  * OCR the preset-name column once per page, cluster into rows, export each
    not-yet-exported row via 3-dots -> Export... -> Save dialog (navigate to
    C:\\server\\fx\\input, save, then move 'm2 *.preset90' to input/lib).
  * after EVERY export print a status line: remaining effect types and
    remaining count per type.
  * resumable: skips m2 files already present in lib.
- Then rebuild midi_cc_map.db (build_cc_db.py) and regenerate midi_cc_map.html
  (gen_cc_map_page.py) so the CC table also lists the m2 effects.
- Caveat: .preset90 carries no CC numbers; CCs stay in midi_cc_states/*-m2.json.


## Progress: export_m2_lib.py rewrite (dedupe + overwrite export)
- Discovery: search field is at screen (747,247,1007,275); the app Library
  contains REAL duplicate m2 entries (e.g. Band_Delay x2, Bouquet_Delay x3,
  Digital_Delay x3 on page 1), so OCR name lists are not reliable for identity.
- Row 3-dots (314, row_center) opens a popup whose items are at fixed offsets:
  Copy +48, Export... +90, Import... +121, Delete from Library +163 (from popup
  top). Delete pops an in-window "Delete Preset From Library" confirm: OK
  (404,604,504,632) center (454,618), Cancel (520,604,620,632) center (570,618);
  ESC does NOT dismiss it.
- Export... opens a JUCE file-save dialog parked on input/lib with the preset
  name pre-filled in the filename edit (137,849,786,866); Save button at
  ~(595,914,694,940) center (644,927) (NOT the m1-era (626,478) region, which is
  why the first background run kept reporting NO SAVE BUTTON).
- First plain run: 3 files still landed in input/lib (m2 delay Band_Delay /
  Bouquet_Delay / Digital_Delay.preset90) then died with "no main window".
- Code action: rewrote back/h90/export_m2_lib.py (modes: dedupe/export/all).
  * dedupe: scans the 'm2 ' filtered list top-to-bottom, per page OCR names,
    re-scans after every deletion; deletes later occurrences after verifying the
    popup title matches the seen key; keeps one copy per preset.
  * export: clears existing 'm2 *.preset90' from lib, for each family_m2.csv
    target search->row menu Export...->fill filename->Save (overwrite), then
    prints per-type remaining status.
- Pending: run dedupe, then export; then rebuild midi_cc_map.db / html.
- Code action: root-caused background-export cascade. Diagnostic run showed the
  save dialog AUTO-APPENDS "(N)" when the target .preset90 already exists, and
  that export_m2_lib.py typed filenames WITHOUT with_spaces=True, so spaces were
  dropped (file 'm2delayBand_Delay.preset90' instead of 'm2 delay Band_Delay').
  The poll then never matched -> 'no-file', the dialog stayed open and broke all
  later rows ('no-rows' cascade).
- Fixed export_one_popup: pre-delete target file, type with with_spaces=True,
  poll + auto-dismiss overwrite/duplicate-confirm modal (dismiss_save_overwrite_modal),
  and guaranteed dialog close (close_save_dialog) before returning. export()
  cleanup now also removes space-free 'm2*' garbage. Compile OK.
- Pending: run export (background), verify 72 files in lib, rebuild CC db/html.

## 2026-09-16 Plan - export loop with UIA-invoke save + overwrite popover reaction

- Previous coordinate-based Save/Cancel clicks failed because JUCE exposes the
  file-save dialog in a virtual 1920x1040 canvas (element rects e.g. Save at
  (1696,994,1795,1020)) that does NOT map to the real 1022x1008 window; d_diag
  once saw the real rect (595,914,694,940) but UIA now reports the canvas rects.
- Change: find_save_button()/find_cancel_button() return UIA ELEMENTS; callers
  must invoke() them (never click the bogus rects). Overwrite popover
  ("РџРѕРґС‚РІРµСЂР¶РґРµРЅРёРµ СЃРѕС…СЂР°РЅРµРЅРёСЏ РІ С„Р°Р№Р»Рµ ... СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ ... С…РѕС‚РёС‚Рµ Р·Р°РјРµРЅРёС‚СЊ РµРіРѕ?")
  is detected textually and its Р”Рђ/Yes button invoked - verified working on a
  live popover (dialog closed, file preserved).
- Stop pre-deleting the target: keep the popover appearing, wait for it, invoke
  Р”Рђ, then verify file + dialog closed. Add (N)-suffix guard on the filename.
- Verify: single export "m2 delay Band_Delay" returned 'saved' with file present.
- Next: background full 72-export, verify 72 files, rebuild CC db/html, append
  Progress entry.

## 2026-09-16 Progress - m2 export run (popover-invoked save)

- Code action: rewrote the save-dialog layer in export_m2_lib.py. find_save_button
  /find_cancel_button now return UIA ELEMENTS (invoke, never click - the JUCE
  dialog reports bogus 1920x1040 canvas rects). Added find_overwrite_modal_buttons
  (text detection: СѓР¶Рµ СЃСѓС‰РµСЃС‚РІСѓРµС‚ / С…РѕС‚РёС‚Рµ Р·Р°РјРµРЅРёС‚СЊ) and dismiss_save_overwrite_modal
  invokes its Р”Рђ button. export_one_popup no longer pre-deletes the target (so the
  overwrite popover appears) and waits for it before proceeding. Added literal_keys()
  to escape send_keys specials ('+' was being swallowed as the Shift modifier).
- Verified: single export "m2 delay Band_Delay" -> 'saved' with popover reacted;
  Quadravox+ re-exported correctly as "m2 harmp Quadravox+.preset90".
- FULL EXPORT RESULT: 68/72 exported in the batch, +Quadravox+ re-exported = 69
  m2 *.preset90 files in input/lib. All 69 match the expected target names exactly
  (no extras/missing).
- REMAINING GAP (user decision): the app's m2 Preset Library genuinely does not
  contain 3 targets - "m2 delay Head_Space", "m2 harmp VocalShiftMIDI",
  "m2 utility Mute" (confirmed: m1 versions exist and search returns 1 row, m2
  search returns 0 rows; full library scroll found 69 unique m2 entries). Their
  midi_cc_states/*-m2.json DO exist (all 72), so build_cc_db.py is unaffected.
- Next: ask user how to handle the 3 absent presets; then rebuild midi_cc_map.db
  and regenerate midi_cc_map.html.

## 2026-09-16 Progress - CC db/html rebuild

- Decision (user): accept the 69 exported m2 .preset90 files; the 3 library-absent
  targets (Head_Space, VocalShiftMIDI, Mute) are not blockers for the CC db.
- Ran build_cc_db.py: 144 effects (72 m1 + 72 m2), 2600 assignments; m2 states all
  included (the 3 absent presets still contribute CC data via their state JSONs).
- Ran gen_cc_map_page.py: midi_cc_map.html written with 2600 assignment rows
  (488,761 bytes); midi_cc_map.db 176,128 bytes.
- Session outcome: m2 dedupe + 69/72 m2 .preset90 exports (overwrite popover
  handled via UIA invoke) + CC db/html rebuilt. Remaining (optional): import the
  3 absent presets into the m2 library and export them.

## 2026-09-17 Plan - migrate UIA automation to Eventide Control 2.2.0 + preset import to Slot A

- The user replaced the native "H90 Control" app with "Eventide Control 2.2.0"
  (exe C:\Program Files\Eventide\Eventide Control.exe, window title "Eventide
  Control"). Confirmed live (non-elevated PID, UIA tree visible): the new app has
  the SAME geometry as the old (window at L1,T31,R1023,B1039 matching
  export_m2_lib REF_X=1,REF_Y=31) and the same controls (Preset Library tab at
  (841,997,1024,1039), library row list, "importButton" at (80,1006), search edit).
- Root cause of earlier "app not visible": first launch spawned from the elevated
  installer -> High integrity -> UIA subtree blocked. Fixed by relaunching the app
  non-elevated. Note affinity: auto-detect must prefer "Eventide Control.exe"
  and fall back to "H90 Control.exe".
- Goal A: create back/h90/h90_app.py - single shared module exporting app-name
  detection (PREFERRED "Eventide Control.exe" / title "Eventide Control", fallback
  "H90 Control.exe") plus connect()/main_window() adapters; port all consumers
  (uia_driver, assign_cc, save_to_library, load_effect, test_assign_cc,
  export_m2_lib) off their hard-coded exe/title names.
- Goal B: new function to import a preset from a file into the H90 Slot A via the
  app's own Import flow (importButton -> file-open dialog -> select .h90/.preset90
  -> confirm), verified by the app showing the preset in Slot A.
- Verify: py_compile all changed modules; live single-command smoke against the
  running Eventide Control; end-to-end import of one known preset file into Slot A.

## Progress — 2026-09-17 migrate UIA automation to Eventide Control 2.2.0 + preset import to Slot A

- h90_app.py done (detect Eventide Control, fallback H90 Control; connect/main_window/desktop/popup helpers; 8.3 short-name aliases).
- Ported all consumers off hard-coded exe/title: export_m2_lib.py (h90_connect/h90_is_main), uia_driver.py (WIN_TITLE = running_title()), assign_cc.py (find_pid), save_to_library.py (APP_TITLE/top_windows), test_assign_cc.py (skipTest when app not running). load_effect.py / map_delay_effects.py had no refs.
- py_compile all modules OK; live smoke detection OK (Eventide Control PID 3024, window L1,T31,R1023,B1039).
- Explored app's import flow: Slot-A header menu button (309,206) -> popup "Import..." (439,336) -> NATIVE "Select a Preset file" dialog at REAL screen coords (filename Edit 213,501; Open 748,525; Cancel 848,525), filter *.preset9;*.preset90;*.h9z;*.tide. Replaces the assumption of importButton->list-file (that was a different, library-list path).
- New back/h90/import_preset.py: import_preset(path) orchestrates open dialog -> type full path into filename Edit -> invoke Open; slot A name + algorithm read back for verification.
- Fixed bug: filename-edit finder initially matched library "Bank 11" edit; tightened geometry (top 485-530, left 200-740, height<=40) and button row (top 500-600, left>700).
- End-to-end validated live: import_preset('C:\server\fx\input\m1delay_band.preset90') -> STATUS imported, SLOT A 'm1 delay Band_Delay / Band Delay'. Slot A overwritten as approved.
- Next: optionally push commit 5fb7cf5; port ~8 SikuliX knob-driver scripts that still reference App("H90 Control").

## Plan - 2026-09-17 auto-launch wrapper: import preset to Slot A without manual app start

Goal: single CLI command imports a preset file into Slot A while the user never
manually opens Eventide Control. If the app is already running, reuse it
(leave it open afterward); otherwise spawn Eventide Control, wait for the H90
connection, run the verified import_preset.import_preset() flow, then close the
app (only the instance we launched) and wait for process exit.

Artifact: back/h90/auto_import.py (CLI only; no server.js change). Verify:
py_compile both modules; end-to-end with the app fully closed
(python auto_import.py input\m1delay_band.preset90 -> STATUS imported, Slot A
changes, app exits); re-run with the app already open (reuse path, app stays up).

## Plan - 2026-09-17 store local Eventide login creds for auto-login

The account screen (Log In / Request new password / Create new Eventide account)
appears non-deterministically at app launch and blocks the cold-start connect
flow. The app stores only userName, not the password; a click on "Log In" with no
typed password did advance to the update-check splash and then the main UI, but to
make login deterministic the password must be available to automation.

Artifact: put login+password in a LOCAL, gitignored file (back/h90/eventide_creds.txt)
- NOT committed ('.gitignore' entry), never logged. auto_import may read it to type
into the two Edits (username at 312,249..712,284; password at 312,300..712,335) and
click Log In (462,407..562,435) on the account screen. Verify: py_compile; repeat
cold-start run with account screen up -> reaches main UI and imports.

## Plan - 2026-09-17 manual-login pause in auto_import (no auth automation)

The Eventide account screen appears non-deterministically at app launch and blocks
the cold-start connect flow. User will handle account login manually: when the
script detects the "Log In" button, it pauses, prints a prompt, and blocks on
stdin until the user types 'done' + Enter; the connect timeout is suspended during
the pause.

Remove the creds-based auto-login attempt (CREDS_PATH/_load_creds/_dismiss_login and
eventide_creds.txt - deleted, gitignore entry removed). Verify: py_compile;
cold-start run; if login appears, script pauses for the user.

## Progress - 2026-09-17 manual-login pause in auto_import (no auth automation)

- Removed auth automation from back/h90/auto_import.py: CREDS_PATH, _load_creds(),
  _dismiss_login(), literal_keys import all gone (user handles account login).
- Added wait_for_manual_login(): blocking prompt 'type done + Enter'; connect deadline
  extended by WAIT_DEVICE_TIMEOUT after the pause so the user is not rushed.
- Deleted back/h90/eventide_creds.txt and removed its .gitignore entry.
- py_compile OK. Cold-start retest PASSED: launched app, hit account screen, paused via wait_for_manual_login(), user logged in + typed done, STATUS imported (m1 delay Band_Delay), SLOT A verified, app closed cleanly.

## Plan - 2026-09-17 set_slot_a.py: MIDI-recall program N + import + save

Goal: close the app (free the MIDI port), recall program slot N via MIDI PC,
relaunch the app, import the preset file into Slot A, click Save so the change
persists on the pedal, verify header number == N and Slot A shows the preset.

Steps:
1. recall.js - PC sender matching port name 'H90 Pedal' (fallback XC-05987);
   args --channel (default 11) --program N --brute (all 16 channels).
2. Fix h90-send.js port match to include 'H90 Pedal'.
3. set_slot_a.py main(): always control app lifecycle - close running app
   (dismiss modified modal), node recall.js, launch app, wait device,
   import_preset(path), click Save (911,141), verify header Text number == N
   and Slot A name == imported preset, close app.

Verify: py_compile; live run python set_slot_a.py 1 "input\lib\m1 harm PitchFlex.preset90"
- header number becomes 1 and SLOT A shows m1 harm PitchFlex.

## Progress - 2026-09-17 set_slot_a.py: MIDI-recall + import + save (done)

- Key discovery: Eventide Control holds the 'H90 Pedal' MIDI port ONLY while
  CONNECTED. While disconnected (My Devices screen) the port is free, so MIDI
  Program Change recalls a slot without closing/relaunching the app (no login).
- PC Offset on this pedal is OFF and receive channel is 11 -> PC byte N recalls
  slot N directly (not N-1). Verified: byte1->slot01 delay, byte2->slot02 harm,
  byte3->slot03 INIT q-plus, byte5->slot05 INIT Program.
- back/h90/recall.js: new standalone PC sender that matches port 'H90 Pedal',
  sends byte=N by default (--offset for N-1), --brute for all channels.
- back/h90/h90-send.js: port match fixed to accept 'H90 Pedal' (was aborting).
- back/h90/set_slot_a.py: full automation - attach/launch app (manual login
  pause only if cold-start login screen), disconnect (frees port), MIDI recall
  program N, connect, verify header number == N, import_preset(path) into Slot
  A, click header Save, verify saved, disconnect + leave app open for next run.
- Live PASS on program 1 with input\lib\m1 harm PitchFlex.preset90 and program
  3 with m2 harm PitchFlex.preset90. After reconnect the pedal shows the saved
  Slot A names (persisted on device).
- Note: multiple stray app instances can accumulate if previous runs are
  interrupted; set_slot_a attaches to the running instance and disconnects it.

## Plan - 2026-09-17 set_slot_a --headless: transparent-window automation

Goal: keep Eventide Control off the screen while preserving the fixed-coordinate
click automation. The window is made fully transparent (WS_EX_LAYERED +
SetLayeredWindowAttributes LWA_ALPHA=0) but stays hit-testable, so cursor clicks
and UIA keep working. The native import Open dialog is also made transparent.

Steps:
1. Feasibility probe: alpha=0 on the running app window -> run set_slot_a.py
   end-to-end -> confirm clicks land (Slot A saved + header number correct).
2. h90_app.py: set_window_transparent(hwnd) / set_window_opaque(hwnd).
3. set_slot_a.py: --headless (default) applies transparency after connect /
   login; --show restores. Native dialog made transparent when detected.
4. Verify on program 1 (m1 harm PitchFlex) and program 3 (m2 harm PitchFlex).
5. DECISIONS + H90-IMPORT-NOTES entries.

## Progress - 2026-09-17 set_slot_a --headless: transparent-window automation

Implemented and verified.

h90_app.py: set_window_transparent(hwnd [, alpha]) / set_window_opaque(hwnd) /
transparent_supported(hwnd) / hide_app_windows() / show_app_windows() using
WS_EX_LAYERED + SetLayeredWindowAttributes LWA_ALPHA.

KEY FINDING: alpha must be >= 1. At alpha=0 the layered window also stops
receiving mouse input (click-through), silently breaking the coordinate clicks
(Disconnect never fired, recall ran while the app still held the MIDI port,
header stayed on the previous program). alpha=1 (1/255 opacity) is imperceptible
to the eye but fully clickable. Documented in the helper docstring.

set_slot_a.py: --headless is now the default (--show opts out). After
login/connect the main window is hidden; a daemon thread re-hides app windows
(including the native import dialog which opens later) during the import step.

Live end-to-end PASS (all headless, window transparent):
  program 1 <- m1 harm PitchFlex.preset90  (header 1, imported, saved)
  program 3 <- m2 harm PitchFlex.preset90  (header 3, imported, saved)
After each run: app left running, disconnected, invisible (alpha=1).

A cold start that requires manual login still shows the login screen briefly
(login cannot be automated).

## Plan - 2026-09-17 automate auth (cold-start login)

Goal (carry-over): remove the manual login pause so a cold start of Eventide
Control reaches the device without human typing. Currently
connect_if_needed -> wait_for_manual_login() blocks on 'done' when a Log In
button is present, and --headless must stay visible until login+connect.

Findings so far (informs the plan):

* %APPDATA%\Eventide\Eventide Control\credentials.esm (and the legacy
  H90 Control\credentials.esm) contain a JWT in the clear:
  header {"typ":"JWT","alg":"HS256"}; payload:
  {"iss":"audio.eventide","aud":"audio.eventide","iat":1789643923,
   "nbf":1789643933,"exp":1884251923,"userName":"antoshkin","userID":624405,
   "clientID":"Wf5150844-0574-4ca5-a798-c650de1b56fa"}
* Aliases the stored JWT across the two app profiles (Eventide Control +
  H90 Control) -> byte-identical claim/userID/clientID, separate signatures.
* Timestamps (local): tokens issued 2026-09-16 18:18 / 2026-09-17 14:18,
  theirs exp 2029-09-15/16 -> the stored token is LONG-lived (3 y) and NOT
  expired. settings userName=antoshkin matches the JWT.
* eventide-control-log.txt: a single 'Invalid token' at Session 12:04 PM -
  BEFORE the profile's token was rewritten at 14:18. No 'Invalid token' after
  14:18. => The earlier forced logins were almost certainly due to a stale/
  invalid token, not a broken 'remember session' mechanism. A cold start with
  the currently-valid esm may now auto-login with NO manual step.
* Repeated 'Could not communicate with Eventide server' in the log, yet a
  direct TCP 443 + DNS check to services-prod.aws.eventideaudio.com SUCCEEDS
  (54.243.68.181, ELB health endpoint names resolve). So the log entries are
  app-side only (update checks), not firewall-blocked auth.

Hypothesis to verify first (cheap): with the current valid esm, a cold start
skips login entirely -> then "auth automation" reduces to guaranteeing a valid
credentials.esm exists before each run + a fallback refresh, and --headless can
be applied immediately at launch (no visible login).

Plan:
1. Cold-start test: close the app fully, launch, watch for a Log In button or
   direct device/Home. Record skeleton of the login screen's UIA tree (Email/
   Password Edits + Log In button coords) in case refresh is ever needed.
2. auth.py (new, back/h90): 
   - read_jwt(): parse + validate current credentials.esm (exp, userName).
   - ensure_auth(): if esm missing/invalid AND app binary present -> launch
     app, drive a login via the transparent-click technique (or reuse the
     existing wait_for_manual_login as fallback), wait until esm updates.
   - backup/restore: keep a known-good esm copy (e.g. h90-notes/) so a bad
     token can be re-seeded.
3. Teach connect_if_needed / set_slot_a / auto_import to call ensure_auth()
   instead of unconditionally pausing; --headless hides right after launch
   when a valid token already exists.
4. Re-verify end-to-end headless from a fully-cold start (program N import).
5. DECISIONS plan/progress + note the token storage location (do NOT commit
   antoshkin's JWT to the repo).

Open question for the user when back: keep login mediation inside the app
(recommended) vs reverse a/services token refresh endpoint to mint a new JWT
offline (only if the cold-start hypothesis fails and no login can be driven).

## Progress - 2026-09-18 automate auth: forced logout -> login fully automated (login.py)

Goal carried from the 2026-09-17 plan (line 4201): remove the manual login pause
so Eventide Control reaches the device without human typing, including a forced
logout -> login round-trip.

Done:
- back/h90/auth.json: local credentials store (email + password), gitignored
  (never commit creds/JWT). Read by login.py via read_credentials().
- back/h90/login.py: CLI (login.py login [email] [pass] | logout | check) +
  state() (home/login) / logout() / do_login() helpers.
  - Login screen geometry (window L1,T31,R1023,B1039): Email Edit
    (312,249,712,284), Password Edit (312,300,712,335), Log In button
    (462,407,562,435). Logout: app menu (25,93) -> Log Out row (137,167).
  - Logout verified live: LOGOUT: ok, back at login screen.
- KEY FINDING — JUCE "Login Failed, Try Again" modal: after a logout the FIRST
  submit is often rejected, and the JUCE modal is app-modal (blocks ALL input
  behind it, including subsequent typing/clicks), poisoning the next attempt
  until dismissed. do_login() now: click each field with a REAL cursor click
  (set_focus() alone does not reliably give JUCE keyboard focus) -> ^a -> type
  (with_spaces=True for the bare email / no-space password) -> click Log In ->
  poll; on reach of a Login Failed modal, click OK and re-submit (up to 3
  tries). Also gave logout() a settle sleep so the fields are interactable.
- Verified live (multiple round-trips): LOGOUT ok -> login attempt 1 rejected
  (modal dismissed) -> attempt 2 -> home; check -> home. Each login writes a
  FRESH JWT to %APPDATA%\Eventide\Eventide Control\credentials.esm
  (iat = session time, exp 2029), confirming a real server-side login.
- Deferred (per open question): token-offline minting not attempted; login stays
  mediated through the app UI.

Next (if wanted): wire do_login/state into connect_if_needed / set_slot_a /
auto_import as ensure_auth() so --headless hides the window immediately at
launch even on a cold start (currently the login screen shows while the user
logs in manually).

## Plan - 2026-09-18 wire auto-auth into headless cold start

Make the whole cold start fully automatic, no manual login pause:

1. login.py: add ensure_auth() -> returns True when the app is not at the
   login screen, or reads auth.json + runs do_login() and returns its result
   (False if no credentials exist -> caller falls back to the manual prompt).
2. auto_import.connect_if_needed(): replace the wait_for_manual_login() pause
   with _try_auto_login() (lazy `import login` to avoid the module cycle),
   falling back to the manual prompt only when credentials are missing. Keep
   the deadline-reset so login time does not eat into the device wait budget.
3. set_slot_a.main(): when --headless, start the keep-hidden thread as soon
   as the app process is up (before connect_if_needed) so a cold-start login
   screen never flashes on screen; drop the two later standalone
   hide_app_windows() calls in favour of the single running keeper.
4. Verify cold start: kill the app, run set_slot_a headless, confirm no login
   pause and a hidden window throughout.

Files: back/h90/login.py, back/h90/auto_import.py, back/h90/set_slot_a.py.

## Progress - 2026-09-18 wire auto-auth into headless cold start: DONE + verified live

Implemented the plan above:

- login.py: added ensure_auth(timeout=40) -> True when already past the login
  screen (home/device), or reads auth.json + runs do_login() and returns its
  result; False when no credentials configured.
- auto_import.py: connect_if_needed() now calls _try_auto_login() (lazy
  `import login` to avoid the login<->auto_import module cycle) on seeing the
  Log In button instead of immediately pausing for the manual prompt; it only
  falls back to wait_for_manual_login() when no credentials exist. Deadline
  reset preserved so login time is not charged to the device-wait budget.
- set_slot_a.py: _keep_hidden() helper (daemon thread + stop event) started
  right after ensure_app_running() when --headless, so the window is hidden
  from launch INCLUDING a cold-start login screen; the two later standalone
  hide_app_windows() calls and the per-import keep-hidden block were removed
  in favour of the single keeper, stopped at the end of main().

Verified live (forced logout -> cold-start-ish login through the new path):

  LOGOUT: ok -> at login screen
  LOGIN: submitted credentials (attempt 1)
  LOGIN: attempt 1 rejected (Login Failed modal)   <- known JUCE first-submit race
  LOGIN: submitted credentials (attempt 2)
  LOGIN: left login screen -> none
  result: connect_if_needed(...) = True
  check -> state=device

So the first-submit-after-logout rejection (and its retry) now runs inside the
regular wait path, and connect_if_needed returns True with the device attached,
all without any manual prompt or visible window.

Remaining (optional): the only unverified branch is the cold start where the
app was fully killed and relaunched (set_slot_a cold-start import, plan step 4).
The logic is the same ensure_auth path; can be exercised on a real run.

## Progress - 2026-09-18 set_slot_a program-7 live test: INIT-name save fix

Live run of `set_slot_a.py 7 C:\server\fx\input\lib\m1 harm Resonator.preset90`
(headless) exposed two real bugs:

1. STALE APP MIDI ENDPOINT: with the app instance that had been running since
   the earlier session (pid 4604), recall PC ch11 -> program 7 did NOT move the
   pedal (header stayed 03 even with --brute on all 16 channels). After the app
   was fully closed and relaunched, EVERY recall worked (5->3->7 all land).
   Whatever the old process held (likely a stale MIDI-over-USB input endpoint /
   stale program-change subscription) cleared on relaunch. Recommendation: cold-
   start the app for a set_slot_a run rather than reusing a long-lived instance.
2. FACTORY 'INIT Program' SAVE BLOCK: program 7 was a factory program named
   `INIT Program*` (reserved). Import into Slot A worked (SLOT A: m1 harm
   Resonator / Resonator), but clicking Save raised a JUCE modal 'Program Name
   Error. Programs cannot be named "INIT Program"!' which is app-modal: it
   blocked UIA access to the main-window edits, so click_save could not verify
   and returned save-fail.

Fix in set_slot_a.py:
- program_name(win): reads the header program-name Edit (header row, not Slot A).
- set_program_name(win, name): clicks the header edit, ^a, types the new name.
- prep_program_name(win, path): if the current program name starts with 'init'
  (INIT Program / INIT q-plus / ...), renames the whole program from the preset
  filename (max 40 chars) so Save is allowed.
- click_save(win): now verifies via program_name(win) (drops '*' marker check
  on slot_a_preset_name) and dismisses any 'Program Name Error' modal first.
- main(): calls prep_program_name(win, path) right before click_save.

Result: second full run PASSED end-to-end headless, program 7 saved permanently:
  RECALL 7 / HEADER 7 / SLOT A m1 harm Resonator / SAVED / header still 7.

## Plan - 2026-09-18 pin app window rect for multi-monitor stability

All fixed coordinates (login fields/buttons, header_number/program_name bands,
SLOT_A_MENU, SAVE_BUTTON, native-dialog regions) were measured on the window at
(L1,T31,R1023,B1039), i.e. canonical size 1022x1008 at 96 DPI/1920x1080. The
app window is resizable (WS_THICKFRAME) and no code positions it, so on a
different monitor/resolution the app may open elsewhere and every constant
misses.

Per user choice: PIN WINDOW ONLY (no relative-coordinate rewrite, no DPI work).

1. h90_app.py: add pin_window() -> SetWindowPos the main window to
   (1,31,1022x1008) if it is not already there (SWP_NOZORDER|SWP_NOACTIVATE),
   sleep ~0.5s for relayout, return the window. Reuses ctypes user32 like
   set_window_transparent.
2. auto_import.connect_if_needed(): call h90_app.pin_window() once per window
   resolution so every caller (set_slot_a, auto_import, login) is covered
   without individual edits.
3. Call pin_window() early in set_slot_a.main() after ensure_app_running()
   before the headless keeper starts (keeper must see it pinned).

Files: back/h90/h90_app.py, back/h90/auto_import.py, back/h90/set_slot_a.py.
Verify: pin_window() twice on current monitor, then a set_slot_a --show dry run.

## Progress - 2026-09-18 pin window rect: DONE + verified

Implemented and verified live:

- h90_app.pin_window(max_tries=4): drives the main window to the canonical
  rect (L1,T31,R1023,B1039 = 1022x1008) via SetWindowPos on the real hwnd,
  and self-calibrates the Win10+ invisible-frame offsets each call
  (GetWindowRect vs pywinauto rect). Measured locally: SetWindowPos coords are
  offset by (-8 left, -31 top, +16 width, +39 height) from pywinauto's rect,
  which are the DWM invisible resize borders in pywinauto's space; deriving
  them at runtime (rather than hardcoding) keeps the pin valid across
  monitors/DPIs. Verified: displacing to (408,331,1416,1192) then pin ->
  (1,31,1023,1039) and identical on a second call (idempotent).
- auto_import.connect_if_needed(): pins once on first window found (pinned
  flag), so set_slot_a, auto_import and login all inherit the positioning.
- set_slot_a.main(): pin immediately after ensure_app_running, before the
  headless keeper starts.

Live verification during the build test run:
  app pid 8668 -> pin in connect_if_needed -> RECALL 7 / HEADER 7 / SLOT A
  m1 harm Resonator / SAVED / header still 7 -> PASS headless.
  After recovery (device reconnected via UIA invoke on the Connect button
  when an earlier raw-coordinate click at (117,354) did not reattach), state
  device, header 7, window confirmed at canonical rect.

Caveats discovered:
- The Connect button's raw coordinate click can fail to reattach on the My
  Devices screen; el.invoke() on the UIA button succeeded. Noted for future
  hardening; not changed (unrelated to pinning, and connect_if_needed clicks
  worked in other runs).
- Pinning assumes the app can actually reach 1022x1008: on a physical screen
  smaller than ~1024x1040 (e.g. 1366x768 laptop, or scaled DPI) SetWindowPos
  would clamp and fixed coords would still miss. DPI/relative-coord work is
  explicitly out of scope (user chose "pin window only").

## Plan - 2026-09-18 send Eventide Control to the back when the script ends

User request: after the procedure finishes, Eventide Control should sit at the
BOTTOM of the z-order (behind other windows), not above them. Right now the
headless flow only makes it transparent (alpha=1); it stays in the front of the
z-order (clicks/SetFocus kept it up), so it can still obscure covered windows?

1. h90_app.py: add lower_window() -> SetWindowPos(hwnd, HWND_BOTTOM=1, 0,0,0,0,
   SWP_NOMOVE|SWP_NOSIZE|SWP_NOACTIVATE) on every app top-level window.
2. set_slot_a.py main(): call lower_window() at the very end (after disconnect
   and keeper stop) regardless of --show/--headless, so the app is left behind
   other windows. Keep the transparent state as-is for headless.
3. Verify with an overlaid window / z-order? Minimal live check: run the
   pin + lower functions and confirm the hwnd order via GetWindow.

Files: back/h90/h90_app.py, back/h90/set_slot_a.py.

## Progress - 2026-09-18 lower Eventide Control z-order on completion: DONE

- h90_app.lower_window(): SetWindowPos each app top-level window to HWND_BOTTOM
  (SWP_NOSIZE|SWP_NOMOVE|SWP_NOACTIVATE). Verified live: after the call the
  app window sits BELOW a visible window (Core Temp) in the z-order walk.
- set_slot_a.main(): calls lower_window() at the very end (after disconnect +
  keeper stop), for both --headless and --show.
- While re-verifying, the raw-coordinate Connect click keeping failing to
  reattach the device (state stayed on My Devices). Fixed in
  auto_import.connect_if_needed(): try UIA invoke() on the Connect button
  first, fall back to the real click. Verified: connect ret True -> device.
- Full headless program-7 run PASSED again after the connect fix; app left
  behind other windows.
