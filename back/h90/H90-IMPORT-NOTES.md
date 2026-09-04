# H90 Import Reverse-Engineering Notes

Working notes for deriving the Eventide H90 Control app's preset-import format so
the web app can import presets to the pedal directly (replay of a captured import
is currently rejected by the pedal).

## Goal

- Web app (`server/server.js`, `web/`) should push a preset to the H90 pedal over CoreMIDI/USB.
- Live import works ("imported and assigned" verified once via the app), but a *replayed* capture is rejected by the pedal — the payload is validated against the pedal's current program state.
- The write path is now decoded: it is zlib **DEFLATE with a preset dictionary**
  (see "WRITE PATH DECODED" below), not encryption. Remaining work: capture the
  exact dictionary and re-import verification.

## 2026-08-07 — DEFLATE decoder validated; LENGTH-table bug found & fixed

New tool: **`server/h90_dict_recover.py`** — a from-scratch raw-DEFLATE inflater
with LZ77 **match tracking** (records every symbol: literal vs copy with
length/distance, plus per-output-byte attribution: literal, or the absolute
window offset it was copied from). This is what the dict-footprint analysis will
use to score candidate dictionaries without trusting zlib's black box.

It is now **validated byte-for-byte against zlib** (see below). Persisted
regression tests: `server/test_h90_dict_recover.py` +
`server/tests/{node_fixed,node_fuzz}.json`.

### The bug (why early decodes of the write payloads were garbage)

`LENGTH_BASE` / `LENGTH_EXTRA` in the first version were **wrong** — the base
table was an offset/exponential pattern instead of the real RFC 1951 values
`3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,…`.
Symptom: the 9-byte stream `73 74 a4 3d 70 a2 03 00 00` (which is
`zlib.compress(b"A"*100 + b"B"*100)`) decoded as `copy(L=3088, D=16850)` +
dist-too-far instead of `lit A, lit A, copy(98,1), lit B, copy(99,1)`.

Caught by compiling zlib's own reference decoder **`puff.c`**
(`contrib/puff/puff.c`, from the madler/zlib repo) and diffing its symbol stream
against ours — puff.c decoded it correctly to 200 B, which pinned the error to
the length tables (puff.c's `lens[]`/`lext[]`). Fixed in `h90_dict_recover.py`
(lines ~23-27).

### Validation (all green, 2026-08-07)

- 26 fixed-block streams + 60 preset-dictionary streams (Node `zlib` generated,
  `server/tests/*.json`) — all decode byte-identical.
- 150 seeded random cross-checks vs Python `zlib` (all compression levels,
  stored/fixed/dynamic blocks, ±zdict) — all match, and every `src` copy
  position is in range.
- Truncated streams: partial output matches zlib's partial-output/eof=False
  semantics (new `EndOfInput` handling in `deflate_track`).
- Real write payloads (`/tmp/h90_fb/req1.raw`, `req2.raw` — note these still
  include the `78 9c` header, strip `[2:-4]` for strict deflate): decoded with
  the zeros placeholder dict to **976 B** and **786 B**, byte-identical to zlib.
  (The 793 B documented earlier for req2 comes from feeding the 4-byte adler32
  tail as trailing deflate bits — the stream is truncated, so those bits decode
  as 7 extra bytes.) req2's dict footprint reproduces the documented numbers:
  169 dict refs, 144 distinct dict offsets, 355 dict-dependent output bytes.

## Environment / Key Artifacts

- Decoder + tests: `server/h90_dict_recover.py`, `server/test_h90_dict_recover.py`,
  `server/tests/*.json`
- App (debug, re-signed with `get-task-allow`): `~/h90-re/H90 Control.app/Contents/MacOS/H90 Control` — app v1.9.5
- Pedal: SerialNumber **XC-05987**, FW **1.11.4.24**, transport = CoreMIDI over USB (pedal BT off)
- App log: `~/Library/Eventide/H90 Control/h90-control-log.txt` (shows connect times, FW, serial)
- Presets: `/Users/artyomantoshkin/server/fx/patchstorage/preset90/` — 7 `.preset90` files; MURKY-BUCKUET-LEAD-642f25f984e72.preset90 = 1684 B
- Write payloads: `/tmp/h90_fb/req1.raw` (664 B), `/tmp/h90_fb/req2.raw` (440 B)
  — the unpacked import data after the `78 9c` header; sources
  `server/h90-captures/h90_import_req.bin` (768 B) / `h90_import2_req.bin` (512 B)
- Decoded request #2: `/tmp/write2_out.bin` (793 B, via `zdict=b'\x00'*32768`)
- Dict footprint (persisted, regenerated from the validated decoder):
  `server/h90-captures/req2_dict_constraints.json` (144 direct window-offset→byte
  constraints, offsets 31916–32764, 355 dependent output bytes) and
  `req1_dict_constraints.json` (69 constraints)
- Custom inflate (validated): `/tmp/deflate_dec.py`
- Capture harness: `/tmp/h90_expect.exp` (expect script driving lldb)
- Trace log: `/tmp/h90-trace.log` (append-only, ~101k lines; append-only across sessions)
- Harness stdout: `/tmp/h90_expect.out`
- Plaintext poll reference: `/tmp/poll.bin` (45 B)
- Replay proof: `/tmp/h90_proxy_session.log` (or `server/h90-captures/h90_proxy_session.log`)
- Pedal firmware (local): `~/Library/Eventide/H90 Control/Firmware/h90-1.11.4.os`
  (34.9 MB; contains zlib, no plaintext object-name strings)
- Server wiring target: `server/server.js`

> NOTE: everything under `/tmp` is ephemeral — reboot clears it. If lost, re-capture using the harness.

## MIDI Packet Format (VERIFIED)

MIDIEventList evtlist layout as observed at `MIDISendEventList` (x2) and callback (x1):

```
word[0] = protocol      (0x00000001)
word[1] = numPackets    (1 for polls/sends; 2..4 for pedal multi-packet responses)
word[2] = timestamp     (varies)
word[3] = wordCount     (0x25/0x32/0x33/0x37/0x5b etc.)
word[4] = count         POLLS 0x10, IMPORTS 0x3e (62) / 0x2e (46), responses 0x40/0x24
word[5] = marker        odd word, only LOW 2 BYTES significant
word[6] = data          even word, full 4 bytes (big-endian)
word[7] = marker
word[8] = data
... alternating (marker, data) pairs
```

Pair decoding (verified byte-for-byte against `/tmp/poll.bin`):

```
(marker_word, data_word) -> low2(marker_word) ++ full4(data_word) = 6 bytes per 2 words
```

## 2026-08-05 (late) — WRITE PATH DECODED: raw DEFLATE + preset dictionary, NOT encryption

**The import write payload is not encrypted.** It is standard zlib DEFLATE (real
`78 9c` header) whose first symbols are length-distance matches referencing a
**preset dictionary** that standard zlib lacks. Decode: raw-deflate + dictionary.

Evidence (import #2 = `h90_import2_req.bin` -> `req2.raw` = `78 9c` + 438 B):
- The `78 9c` parses as a REAL zlib header: CMF=0x78, FLG=0x9c, FDICT bit **unset**
  (`(0x9c >> 5) & 1 = 0`), first block btype=2 (dynamic Huffman), BFINAL=1. Not a fake marker.
- `zlib.decompressobj(15)` (standard) fails at 225 B consumed with
  `invalid distance too far back` — it needs the dictionary.
- `zlib.decompressobj(-15, zdict=b'\x00'*32768)` fully decodes req2 -> **793 B**
  (`/tmp/write2_out.bin`), no error, eof=False, 0 bytes unconsumed.
- Control: the same raw-deflate-with-zdict path decodes the known-good READ
  payload byte-identically to plain `zlib.decompress` (35,604 B). Decoder trust.
- Python honors `zdict` only in raw mode (`wbits=-15`); Node `inflateRawSync`
  honors `{dictionary}` (both verified on controlled streams).

Decoded request (793 B) structure:
- = 32-byte wrapper + embedded preset serialization. Embedded preset (offset 32)
  is byte-identical to `patchstorage/preset90/MURKY-BUCKUET-LEAD-642f25f984e72.preset90`
  head for the first 196 bytes; contains `Tap2DelayDivision-obj`, UUIDs
  `7ea818ee-e87f-487e-896a-eacc8178f059` / `23eb7ac7-616c-4043-b777-e1ab879537a1`,
  name `MURKY BUCKUET LEAD`.
- Wrapper head: `04 00 00 00 f4 ff ff ff 00 00 00 4f 0c 00 00 00` then the same
  vtable pattern seen in read FlatBuffers (`08 00 0c 00 07 00 08 00 08 00 00 00 00 00 00 01`).
- The output's embedded serialization DIVERGES from the `.preset90` layout beyond
  byte 196 (out[228]=0x3e vs p90[196]=0x50) — the request is a compact/wire variant,
  NOT the file verbatim.

Dictionary:
- The stream's early symbols are matches into the missing dict. 19 matches
  reference it; 169 output bytes depend on it; 144 distinct dict window offsets in
  range **31916–32764** (last 848 B of the 32K window); in-stream distances <= 1480.
  Footprint saved at `server/h90-captures/req2_dict_constraints.json`
  (144 direct constraints, regenerated with the validated decoder).
- Referenced dict bytes look like a **preset serialization**: vtable offsets
  (`76 fb ff ff`, `de fb ff ff`), u32 lengths (`04 00 00 00`), object-name strings
  (`terval-obj` = tail of `PitchJumpInterval-obj`, `LFOShape-obj`, `Lte-obj`).
- The object names are **NOT in the app binary** (searched arm64 + x86_64 slices
  for `LFOShape`/`PitchJump`/`Tap2Delay`/`DELAYMODE` — zero hits). They come from
  the pedal at runtime (they appear in the read responses). => the dictionary is
  built at runtime from pedal data (candidate: current preset's serialization).
- JUCE: the binary embeds JUCE's zlib (version string `1.2.3`,
  "deflateEnd failed (ignored)"). JUCE `GZIPCompressorOutputStream` supports a
  dictionary argument — consistent with a runtime-built dict string.

Truncation:
- Both req1/req2 decode with `eof=False` (0 unconsumed, no skip offset 0/2/4/6
  reaches a block end). The SysEx frame is complete but the deflate stream ends
  without a final block (app likely emits a non-final flush, or trailing bits are
  dropped). 793 B is the complete meaningful content.

Dict candidates tested (all "decompress OK" — any 32K dict works as a placeholder,
so this does NOT verify correctness):
- resp1/resp2 read responses, download response, every `.preset90` file,
  `read_raw_zlib`, zero-padding variants. Scoring "dict-dependent output bytes ==
  MURKY.preset90[out-32]" tops out at ~63/144 — unreliable because the output
  layout diverges from the `.preset90` format.
- Pedal firmware is local: `~/Library/Eventide/H90 Control/Firmware/h90-1.11.4.os`
  (34.9 MB) has zlib refs but no plaintext object names (firmware likely
  compressed/encrypted).

## 2026-08-05 (~19:15–19:20 MSK) — LIVE dict-capture attempt (paused, nothing captured yet)

Armed a lldb attach on the running debug app (PID 10344) to snapshot the
dictionary at import-send time. Nothing fired; the session was paused before any
import was clicked. Setup is ready to reuse:

- Helper: `server/h90-captures/h90_dict_capture.py` (persisted copy of
  `/tmp/h90_dict_capture.py`) — lldb Python command `h90_dict_capture.on_midi_send`.
  On every MIDI-send stop it: logs unconditionally (stop reason, valid thread),
  reads the evtlist `count` at `x2+16` (import segments are `0x3e`/`0x2e`),
  dumps the evtlist words to `/tmp/import_seg_N.bin`, then scans **all writable**
  memory regions (chunked ≤64 MB) for `LFOShape-obj` / `PitchJumpInterval` /
  `terval-obj` / `DELAYMODE-obj` / `Tap2DelayDivision` / `Mix-obj` / `Depth-obj`;
  on the first hit saves 64 KB before it to `/tmp/h90_dict_capture.bin` and stops.
- Arm command (attach to a running app — no relaunch needed):
  `nohup lldb -b -p <pid> -o 'command script import /Users/artyomantoshkin/server/fx/server/h90-captures/h90_dict_capture.py' -o 'breakpoint set --name MIDISendEventList' -o 'breakpoint set --name MIDISend' -o 'breakpoint command add -F h90_dict_capture.on_midi_send 1' -o 'breakpoint command add -F h90_dict_capture.on_midi_send 2' -o 'continue' -o 'detach' -o 'quit' > /tmp/lldb_dict_capture.out 2>&1 &`
- Log: `/tmp/h90_dict_capture.log` (append-only). Session: `/tmp/lldb_dict_capture.out`.
- Verified armed: breakpoint 1 = `CoreMIDI MIDISendEventList` @ 0x1b98f6e80,
  breakpoint 2 = `MIDISend` (2 locations), both command-bound, `continue` issued.

Findings this window:
- The app sent **no MIDI while idle**: the proxy log shows nothing after the
  connect burst at 19:14:36 (no TX lines). => breakpoints cannot fire without a
  real import; there is no periodic poll to trigger them.
- App log's last line was `DocController.cpp:312] User cancelled` (a dialog was
  cancelled — firmware-update modal or the import/open dialog).
- To resume: launch the debug app, cancel the firmware-update modal, run the arm
  command above, then click import and watch `/tmp/h90_dict_capture.log` for
  `HIT 0x…` entries. Verify the captured dict against
  `server/h90-captures/req2_dict_constraints.json` (144 direct constraints),
  then `zlib.decompressobj(-15, zdict=…)`
  req1/req2 for a full plaintext.

## 2026-08-05 — Read path DECODED; write path NOT encrypted (was: still encrypted)

The big unlock: the verified 7-bit unpack is **LSB-first** (`h90_decode.unpack_7bit`,
8 packed bytes → 7 raw bytes; round-trip verified — the old "MSB-first" assumption
was wrong). With that:

- **READ (pedal → app) payloads are plain zlib → FlatBuffers, NOT encrypted.** Every
  large message in the clean capture `server/h90-captures/h90_virtual_rx.log` inflates
  to a valid FlatBuffer (root uoffset = 12). All 18 extracted to `/tmp/h90_fb/*.bin`:
  - `03050066.bin` 149,868 B — full library dump (real preset names `OilDrum`,
    `Indigo Fog`, `Resotap`, `trem try`, UUIDs)
  - `032e0161.bin` 35,604 B — switch/expression param set (`switch6-obj`, `Sw 6: %s`)
  - `033f0013.bin` 12,964 B — a preset (import #1 response, `VECHOLONG`; `activeBypass*`,
    `alg-tails-obj`, `repeat-obj`, ...)
  - `03070013.bin` 13,816 B — import #2 response (= `h90_import2_resp.bin`)
  - Small messages (≤ ~100 B body) are raw FlatBuffers without zlib (e.g. `01000004` 448 B)
- **WRITE (app → pedal) import payload is DEFLATE + preset dictionary, NOT encryption.**
  See the "WRITE PATH DECODED" section at the top. Standard zlib rejects it
  ("invalid distance too far back") only because the dictionary is missing;
  `zlib.decompressobj(-15, zdict=…)` decodes both imports.
- Replay rejection (below) is coherent: reads are stateless plaintext; writes are
  deflate-with-dictionary, so a replayed write (compressed against the pedal's
  *current* program) is rejected when the pedal's program differs from the
  dictionary the app compressed against.

Correction to the line below: the "HIGH-ENTROPY / real encryption" observation was
the **write** payload only; read payloads are plain zlib FlatBuffers.

## Markers

- `0x30161c77` — polls AND import segment 1 AND final ack (also common in pedal status)
- Import request segments 2-5: `0x30260228`, `0x3026175e`, `0x30266d75`, `0x30266b38`
- `0x30260405, 0x3026423f, 0x30264d46, 0x30266259, 0x30265f48, 0x30260950, 0x30261202, 0x3026703d` — appear in BOTH import and non-import sessions → regular pedal status packets, NOT import-specific.

## Breakpoints (all set AFTER `process launch --stop-at-entry`)

| id | location | meaning | capture |
|----|----------|---------|---------|
| 1 | `0x10001336c` (symbol857 + 704, `bl MIDISendEventList`) | app's universal MIDI dispatcher send | `memory read -f x -c 300 -s 4 --force $x2` |
| 3 | `0x100014328` (symbol866 block invoke) | CoreMIDI input callback | `memory read ... $x1` |
| 2 | `0x1002f131c` | OLD "import fn" — **DEAD, 0 hits ever, remove** | — |

- Callback runtime signature is `(block, evtlist, refCon)`: **x1 = evtlist**, x0 = block (isa `0x0468ba58`, invoke `0x00014328`).
- `image lookup -n MIDISendEventList` forces the CoreMIDI shared-cache symbol load (cured pending-breakpoint issues). In-app addresses set after launch resolve 100%.

### Send-side caller chain (plaintext hunting)

```
MIDISendEventList (CoreMIDI, shared cache 0x1b2dc6e80)
  <- symbol865+176  (0x100014280)
  <- symbol857+536  (0x1000132c4)   <-- universal dispatcher, SEND site is +704
  <- symbol7315+220 (0x10021e068)
  <- symbol7310+328
  <- symbol7718+260
  <- symbol7198+48
  <- symbol1674+364 / symbol1673+56
  <- CFRunLoop source 0 ... (JUCE Message Thread)
```

## Harness Gate BUG (critical)

`/tmp/h90_expect.exp` SEND block contains:

```
expr -- (*(unsigned int*)($x2 + 24)) & 0xffff
```

`$x2 + 24` = word[6] = the MARKER, never equals 0x3e/0x2e.
**Must be `$x2 + 16` = word[4] = the count.** Compare low 16 bits against `0x3e`/`0x2e`.

Consequence: no IMPORT-SEND heavy stack dumps (900-word `$sp` + registers) were EVER captured.

## Complete Import CAPTURED (PID 15464 session, ~13:46)

- REQUEST (sends, `==BP=1 n=273..277==`): **5 segments**, each wc=0x33, count=0x3e:
  - n=273 marker `0x30161c77`
  - n=274 marker `0x30260228`
  - n=275 marker `0x3026175e`
  - n=276 marker `0x30266d75`
  - n=277 marker `0x30266b38`
- RESPONSE (callbacks, `==BP=3 n=278..287==`): multi-packet (numPackets 2-4), count=0x40
- ACK (callback n=288): count=0x24, marker `0x30161c77`
- Decoded example (n=273 raw words): header `0x16fdfccd0: 0x00000001 0x00000001 0x20a18591 0x00000033`, then `0x16fdfcce0: 0x0000003e 0x30161c77 0x00030e00 0x30264f78 ...`

### Session boundaries in /tmp/h90-trace.log (1-based lines)

```
Process 15096 launched  @ ~1829
Process 15325 launched  @ ~1908
Process 15464 launched  @ 31438      <- contains the complete import
Process 15840 launched  @ 62790      <- last live session, no import
```

## .preset90 File Format

JUCE ValueTree binary serialization — readable: ASCII property strings such as
`Tap2DelayDivision-obj`, `PitchJumpInterval-obj`, `DELAYMODE-obj`, `LFOShape-obj`,
`LFORate-obj`, `Depth-obj` with negative int32 relative offsets. MURKY file = 1684 B.

## Session History & Lessons

- PID 15096: launch-then-set-breakpoint deadlock → always set breakpoints after launch at stop-at-entry.
- PID 15325: first correct dispatch (polls + callbacks) using breakpoint 1 + 3.
- PID 15464: callback x1 fix (was x0); captured ~288-callback device dump, then the full import (n=273-288). Later killed.
- PID 15840: last live session — all 3 breakpoints resolve/fire, app responsive, polls + responses flowing, ~588 callbacks. No import performed during it.
- Firmware-update modal must be cancelled at each app launch (Eventide update server unreachable).

## Next Steps

Read path is DONE. Write path is confirmed DEFLATE + preset dictionary (see top
section); the unknown is the exact dictionary. A live-capture attempt was made on
2026-08-05 and paused before any import fired (see "LIVE dict-capture attempt").
To implement web-app imports we must reproduce the dictionary the app (and pedal)
build at runtime.

1. **Capture the dictionary (primary).** The debug app (`~/h90-re/H90 Control.app`,
   v1.9.5, re-signed) runs live against the pedal through the proxy. Use the ready
   helper + arm command in "LIVE dict-capture attempt": lldb-attach, trigger an
   import, break at `MIDISendEventList`/`MIDISend`, and dump the compressor's
   `z_stream` dictionary or `memory find` the heap for the dict blob
   (`LFOShape-obj` etc.) at send time. Reminder: the app sends NO MIDI while
   idle — the import click is what fires the breakpoints.
2. **Verify:** decompress `req1.raw`/`req2.raw` with the captured dict; the full
   plaintext must be a valid message (and re-import must be accepted by the pedal).
   The custom decoder (`server/h90_dict_recover.py`) is now validated, so a
   candidate dict can be scored offline first: run `deflate_track(req, zdict=cand)`
   and check the 144 direct dict offsets against
   `server/h90-captures/req2_dict_constraints.json`.
3. **Encoder (once the dict is known):** serialize the preset → raw-deflate with
   the dict → 7-bit pack → frame → send via CoreMIDI (`server/h90-send.js` style).
   Wire into `server/server.js` (MVP target).
4. Also fix the `h90_proxy.swift` over-read logging bug (copy exactly `length`
   bytes, one hex line per packet) so future captures are trustworthy.

## 2026-08-07 — TRPC message layer reverse-engineered (Windows H90 Control 1.9.13)

Analyzed the Windows x64 `H90 Control.exe` (JUCE, v1.9.13, 11.2MB) with rizin.
Embedded `__FILE__` strings confirm the source layout:
`h90control\H90\ControlApp\Source\Device\H90Device.cpp`, `H90Device-progdb.cpp`,
`Source\Dot9\Comms\TideUSB.cpp`, `LegacyDot9Comms.cpp`, and protocol core
`AppCommon\DeviceComms\TRPCMessageBroker.h`. **"Dot9" is the H90 codename.**
Transport: **USB HID (hidapi)** for enumerating/opening the device
(`TideUSB::openDeviceWithPath`, `hid_open_path`, `hid_get_feature_report`,
`hid_send_feature_report`) plus MIDI sysex via JUCE MidiMessage
(`TRPCMessageBroker::sendMIDIRequest`).
Dumps: `/var/folders/0x/0j_n_rd502l189qywpmnymtr0000gn/T/opencode/fn/` +
`sites.txt`. Note: brew rizin has no `pdc`; used `pdf`/`pD` disassembly.

### Message header format

Built inline in `TRPCMessageBroker::sendMessage` (fcn.14013b610) and
`sendMIDIRequest` (fcn.14013ed10 → fcn.14013f960 = send-and-wait):

```
offset size value
0      4    magic 0x771cf0  (bytes f0 1c 77 00)   <-- matches low2 "1c 77"
                                        of the capture marker 0x30161c77!
4      1    type byte: 0x01 for requests (a "1" word w/ flags)
5      1    0x00 (reserved)
6      1    (id >> 7) & 1          \__ 8-bit request/response ID split
7      1    id & 0x7f              /   into two 7-bit-safe bytes
8+     ...  payload (e.g. request data / response body)
```

The ID split makes the header MIDI-sysex-safe (each byte ≤ 0x7f). Response
status is the same ID field: `(byte6<<7)|byte7`; **0x02 = device error**
("Device returned error response code 0x02!").

Synchronous request/response: every request carries an ID, the broker spins on
`timeGetTime` until the matching response arrives, with a per-call timeout
(`0x2710` = 10 s, `0x7530` = 30 s seen). Failures print
"Device communications error: Request ID(0x%x)", "Timeout waiting for response:
Expected Response ID(0x%x)", "Corrupt response from H90 with ID: ".

### Request/response opcode pairs (request -> expected response ID)

`TRPCMessageBroker<...>::sendMessage(requestType, data, responseType, timeout)`
at each call site (arg3=req byte, arg4=resp byte):

H90Device / progdb virtuals (call `fcn.14013b610`):
```
0x03->0x04  (virtual_40)        0x70->0x71  (virtual_80-ish)
0x61->0x62  0x63->0x64  0x65->0x66  0x67->0x68  (30s)
0x69->0x6a  (virtual_400, indexed read: dword idx payload)
0x6b->0x6c  (virtual_408, indexed read: dword idx payload)
0x6d->0x01  (progdb, 30s)       0x6e->0x01  (progdb, 30s)
0x82->0x01  (progdb, 30s)       0x83->0x01  (progdb, 30s)
0x84->0x85  (virtual_416, 10s)  0xe2->0xe3  (virtual_392, 10s)
0xe0->0xe1  (H90Device, 30s)    0xe4->0x01  (progdb, 30s)
0xe5->0xe6  (10s)
```
Dot9 family (call `fcn.140154390`): `0x04->0x05 0x08->0x09 0x11->0x12
0x13->0x14 0x15->0x01 0x16->0x01 0x1a->0x1b 0x20->0x21 0x22->0x01
0x30->0x01 0x42->0x01 0x43->0x01`.

Mapping ID->vtable slot: 0x69/0x6a = H90Device.2.virtual_400,
0x6b/0x6c = virtual_408, 0x84/0x85 = virtual_416, 0xe2/e3 = virtual_392,
0x03/0x04 = virtual_40. The 0x6e/0x6d/0x82/0x83/0xe4 progdb calls send a
payload array (MemoryBlock) and expect a generic 0x01 ack — these are the
preset/program-DB write commands.

### Relevance to the import path

The 0x6x/0x8x/0xe4 progdb messages are the program database read/write
operations (H90Device-progdb.cpp). The header magic `1c 77` == the low bytes of
the captured MIDI marker `0x30161c77`, i.e. every TRPC message is framed into
the (marker, data-word) pairs already decoded in this doc. Next candidate step:
map each opcode to a vtable method name and decode a captured import segment
against this 8-byte header to confirm the "Request ID" byte and payload layout.

## 2026-08-09 — req1 embedded JSON identified (TWO-WAY preset), reconstruction in progress

Work directory: `/tmp/h90_fb/` (regenerated this session). All req1/req2 artifacts
were cleared from /tmp, so the pipeline was re-run and the results below are from
fresh extraction.

### Phase 0 — artifacts + read-response verification (DONE)

- `req1_defl.raw` (659 B) / `req2_defl.raw` (435 B) re-extracted from
  `h90_import_req.bin` / `h90_import2_req.bin` (7-bit unpack → drop zlib hdr/footer).
- Read responses decode as **complete** zlib streams (eof=True) with the plain
  `unpack_7bit` path — no big-frame segment-offset headers involved:
  - `h90_import_resp_big.bin` (4999 B) → `h90_import_resp_big_dec.bin` **12,964 B**
    (TWO-WAY state; contains `TWO WAY` at 12912, UUID `7ea818ee…` at 12824).
  - `h90_import2_resp.bin` (5535 B) → `h90_import2_resp_dec.bin` **13,816 B**
    (MURKY state; `MURKY` at 13752).
  - (The earlier session's "10,873 B" figure for resp_big was wrong; 12,964 B is
    correct and self-consistent — see `server/h90_decode.py`).

### Phase 1 — req1's write JSON (MAJOR progress)

`req1` decodes with `zdict=0x00*32768` to **976 B**. Structure:

- `out[0:191]` binary wrapper (vtable offsets; matches the `.preset90` head,
  including the `08 00 0c 00 07 00 08 00 08 00 00 00 00 00 00 01` pattern).
- `out[192:204]` = `tjknobs-knob4` (object name — same string exists in the
  `.preset90` file right before its base64 JSON blob).
- `out[205:207]` = `00 00 00` (NUL terminator, matches `.preset90`).
- `out[208:210]` = `xdl` (3 literal bytes, role unknown; followed by the JSON b64).
- **`out[211:976]` = base64-encoded JSON**, group phase ≡ 3 (mod 4).

The JSON is the **TWO-WAY preset's parameter dictionary** — decoded values match
`patchstorage/preset90/TWO-WAY-640284089dce6.preset90`'s embedded JSON byte-for-byte
for the readable stretches:

```
…verse","bypa_normal":0.0,"bypt_normal":0,"dlya":987.4534912109375,
"dlya_denormalized_pretaper":350.0,"dlya_end_exp":0.9823130369186401,
"dlya_start_exp":0.6586937904357910,"dlyb":1597.311401367188,
"dlyb_denormalized_pretaper":343.8124694824219,"dmix":…}
```

i.e. the write JSON starts at the **`verse` tail of `"Reverse"`**; the head
`{"algorithm_name":"Re` (≈ out[19x:211], incl. positions 208-210 `xdl`) is
**dict-dependent** (already in the pedal). Readable tail fragments also show the
preset's last keys/values: `"TWO WAY"`, `com.eventide.h9.tfreverse`,
`routing_type`, `"version":"3"`, plus **reversed-looking fragments**
(`versmal`, `noxypwitchyb`, `noxfad`, `_denotsyn`) — the tail encoding is NOT yet
resolved.

### Dict-dependence details (important reframe)

- Every position where `deflate_track` returns `src[i]==('copy', dist)` is a
  dict reference; with the zero placeholder dict its output byte shows as `0x00`.
  These ARE part of the base64 string — their real values are base64 chars taken
  from the pedal's runtime dict (previous program state).
- `dict_refs()`'s `depend` set is a **subset** of copy positions (96 vs ~113 copy
  positions in the region) — use `src` markers (`('copy',…)`) for the true set.
- The NUL-looking bytes inside `out[211:976]` (at 230-231, 254-255, 273-274,
  549-550, 560-565, 578-579, 587-591, 594-596, 618-628, 650-652, …) are all
  dict-copy placeholders, i.e. unknown base64 chars.

### Where the write JSON DIVERGES from the `.preset90` blob

Greedy alignment of region literals against `b64(TWO-WAY.json)` (start at fwd
index 28) matches **out[211:544]** almost perfectly (the `bypa_normal…dmix`
stretch), then **diverges at the `dmix` VALUE (~out[545], preset `38.8183593750`)**
— 141 mismatches across the rest of the region. So the write serialization is a
**compact / wire variant**, NOT the file JSON verbatim (consistent with the 2026
note "embedded serialization diverges beyond byte 196"; the region is ~573
decoded bytes vs the file's 1173-byte JSON).

Also: some 4-char groups inside the region cannot decode to printable bytes under
*any* base64 assignment of the copy positions (e.g. group `out[231:235]` with
known `t1h`), so the region is **not one contiguous clean base64 stream** — the
structure (segment gaps / variant encoding) is still to be mapped.

### Known unknowns / next steps

1. Map the region's exact segment structure (why groups with known literals break
   clean base64) and the reversed tail fragments.
2. Reconstruct req1's full output (fill ~113 dict-copy bytes) under the write
   variant; verify every literal char matches when re-encoded.
3. Use reconstructed req1 output as the dictionary to decode req2 (MURKY): req2's
   copy refs should point into TWO-WAY's serialization (post-import#1 state) →
   clean MURKY decode = correctness proof. Validate against
   `MURKY-BUCKUET-LEAD-642f25f984e72.preset90`.
4. Then persist a reusable `server/h90_reconstruct.py` (workflow above was
   exploratory stdin scripts; the analysis code lives in this doc's commands).

## 2026-08-13 — dict = previous program's write serialization (req2 fully mapped, 21 bytes left)

New findings that correct/supersede the 2026-08-09 "known unknowns" list. Artifacts:
`server/h90-recon/decode_status.json` (position lists), temp scripts under
`C:\Users\Thoma\AppData\Local\Temp\opencode\`.

### Correction: the `\x00\x00` bytes are NOT dict-copies

The 08-09 note claimed the NUL-looking bytes in `out[211:976]` (230-231, 254-255,
273-274, 549-550, …) were all dict-copy placeholders. **Wrong.** With
`h90_dict_recover.deflate_track` those positions decode as `('copy', abs>=32768)`
= **output-copies** (fixed, self-referential LZ matches) whose real value is the
`\x00\x00` byte pair in the write. They are KNOWN.

True dict-copies in req1 (bytes whose value can only come from the runtime
dictionary): exactly **72**, at output positions
`[560-565, 587-591, 594-596, 618-628, 735-739, 759-761, 799-804, 851-858,
917-922, 952-954, 956-968, 973-975]`.

### adler32 oracle (proves zeros-dict tail is wrong)

Stored zlib adler32 in the deflate trailers vs the zeros-dict decode:

| stream | stored adler32 | zeros-decode adler32 |
|--------|---------------|----------------------|
| req1 | `0xee497217` | `0xb3c1f985` |
| req2 | `0xac6eda29` | `0x77305a75` |

Mismatch confirms the 72 dict-copied bytes are wrong under the zero placeholder.

### req2's dictionary = req1's output (TWO-WAY write serialization) — CONFIRMED

- req2's 169 dict refs are at window offsets **31916–32764**. Since req1's output
  (976 B) is right-aligned at the window end (BASE = 32768−976 = 31792), each ref
  maps to `req1_out[w−31792]` → range `req1_out[124:973]`.
- Decoding req2 with a dict built from req1's **known** bytes resolves 787/787 of
  req2's output EXCEPT the bytes that alias req1's 72 unknown positions: exactly
  **21** req2 output bytes are still unknown, all of them dict-copies sourced from
  req1's 72 unknown bytes.
- Structural proof: req2's output contains `Tap2DelayDivision` (MURKY's object
  name) AND b64 fragments `…ide.h9.tfreve…`, `noxypwitchyb`, `"syn`, `"routing_…`
  that come from req1's (TWO-WAY) serialization via dict copies. So the write is
  **the current program's write-serialization, patched with the imported preset's
  values** — dict-copies where new==current, literals where they differ.

### The 72 bytes = VECHOLONG's values; unrecoverable from these captures

- req1's 72 dict-copies reference the dict, which is the program state present
  before import #1 = **VECHOLONG** (the pedal's initial program).
- req1 = VECHOLONG's serialization patched with TWO-WAY's values; req2 = req1's
  output patched with MURKY's values. The 72 (21) shared bytes are the same
  VECHOLONG values, never transmitted (the app only ever references them via the
  dict), and only 2 adler32 equations exist for 72 unknowns → not solvable here.
- They ARE part of the base64 JSON stream (b64 alphabet chars), so a candidate
  dict is still scoreable: fill `dict[31792:32768] = req1_out`, then check
  req2's 148 known-alias refs agree AND adler32(req2) == `0xac6eda29`.

### Write-variant structure (later 08-13): b64 runs + marker bytes, values = file JSON

Per-run decoding of `out1[211:976]` (765 B) shows it is **NOT one contiguous b64
stream** — it is 637 b64 chars split into runs by **128 non-b64 bytes** (117
`\x00`, 4×`0x3f`, 2×`0x0d`, 2×`0x80`, 1×`0x2d`, 1×`0x14`, 1×`0x10`). Of those 128:
the **72 deflate dict-copies** (VECHOLONG) + **56 literal output bytes** (the
`\x00\x00`/odd markers that are part of the write itself, e.g. the `\x00\x00` of
the `vcm`→`\x00\x00t` groups).

- **Every b64 run decodes to 100% clean ASCII at some phase**, and the readable
  text is the `.preset90` file's JSON: e.g. run at [275..548] phase0 =
  `987.4534912109375,"dlya_denormalized_pretaper":350.0,"dlya_end_exp":0.9823130369186401,"dlya_start_exp":0.6586937904357910,"dlyb":1597.311401367188,"dlyb_denormalized_pretaper":343.8124694824219,` — byte-identical to `preset90_twoway.bin`'s JSON. The write's literal VALUES are TWO-WAY's values.
- **The stream is NOT phase-continuous**: run phases do not chain (cumulative
  char count mod 4 ≠ observed phase) and do not equal the file-position phase.
  The pedal-side decoder must reassemble per-chunk.
- `iIn0K` at `out[946:950]` decodes to `"}\n` — the write JSON ends exactly like
  the file JSON. So the write JSON ≈ file JSON end-to-end; the only divergences
  are the 72 dict-copy positions and the marker groups (write emits 2 dict-chars
  + 1 literal where the file has 3 chars, e.g. `vcm`→`\x00\x00t`).
- Full layout: `[0:32]` TRPC wrapper; `[32:192]` ValueTree structure bytes
  (incl. float32 1.0/0.5 at 176-187); `tjknobs-knob4\x00\x00\x00xdl` at 192-210;
  b64 stream 211-871; second `tjknobs-knob4\x00\x00\x00xdl` at 872-890; more b64;
  `"}\n` at ~946; trailer `\x00\x00\x00\x00\x14\x00\x00\x00 ... \x10\x00\x00\x00...` at 951-976.
- `req1_dict_constraints.json` records the 72 refs → **69 distinct dict offsets,
  range 31004–32730** (some offsets hit by 2 refs).

Implication: a fully-literal write (fill the 72 dict-copies + 56 markers with the
file's b64 chars, position-preserving) WOULD inflate to the file JSON, but the
pedal-side parser expects the marker groups — untested whether it accepts a
marker-free stream. The marker semantics are still unknown (2 dict-chars + 1
literal per group is the current best model).

### Next steps (updated)

1. **Primary:** live lldb capture of the dict at send time (per 08-05 section)
   — that directly yields the 72 bytes.
2. **Static (secondary):** in the app binary, xref the deflate/`zdict` construction
   to find where the "current program serialization" string is built (capstone tool,
   08-12 section).
3. Once the dict is known: verify `deflate_track(req, zdict=cand)` matches both
   stored adler32s, then implement the encoder in `server/server.js`.

## 2026-08-12 — capstone static-analysis tool (`server/h90_capstone.py`)

New tool for the static RE of the app binary. Finds **ADRP/ADD and ADR xrefs**
to target VAs (string literals or hex offsets) across `__text` and disassembles
the referencing functions — to locate the write-payload JSON builder, base64
encoder and deflate-dictionary construction in the arm64 slice.

### Setup on another device

```bash
pip install capstone        # works with 6.0.0 stable; also verified with 6.0.0a10 (next)
```

The `input/capstone-next/` source checkout is **git-ignored** and NOT needed —
the PyPI wheel ships the native core. On macOS the arm64-capable build resolves
via `/usr/bin/python3` (system Python 3.9) or a pip-managed interpreter; use a
Python whose `import capstone` succeeds. If the API errors on a newer stable,
pin `pip install capstone==6.0.0a10`.

### Usage

```bash
APP="/Applications/Eventide/H90 Control.app/Contents/MacOS/H90 Control"

# xref a string literal; --show also prints the referencing function's disasm
python3 server/h90_capstone.py "$APP" --find "Import already in progress" --show

# xref multiple strings / a literal VA (0x- prefix = VA, else looked up as a string)
python3 server/h90_capstone.py "$APP" --find "imported" "0x1002f131c" --show

# just disassemble forward from a VA (80 insns default)
python3 server/h90_capstone.py "$APP" --disasm 0x1002f131c

# widen the ADRP→ADD pairing window (default 32 insns)
python3 server/h90_capstone.py "$APP" --find "Import already in progress" --window 64
```

### Gotchas

- Binary is **stripped** (742 symbols, no dSYM). __TEXT maps file offset → VA
  directly (`VA = 0x100000000 + file_off`; `--vm` default matches). `otool`
  section offsets are **decimal**.
- The app binary is **fat**; string lookups search only the arm64 slice, so the
  VA is computed relative to the slice (slice file offset ≠ absolute offset).
  The x86_64 slice contains the same strings at different offsets — don't mix
  them up.
- The capstone "next" preview (6.0.0a10) reports ADRP immediates as absolute
  page addresses; the script handles both forms.
- Note from earlier work: the `0x1002f131c` import-thread candidate got 0 lldb
  hits on the captured (newer) app — re-verify call sites before trusting them.

### Status / tie-in

- Verified (2026-08-12): `--find "Import already in progress"` → xrefs at
  `0x1002f1368` and `0x1002f13b4` (the documented import-thread function region,
  DECISIONS.md "Static RE progress"), each loading a message string then calling
  `0x100018b48` — looks like a `juce::String` / message formatting helper.
- This is a **secondary/offline route** to the dict problem (DECISIONS.md
  "Resume here"). The primary route stays the live lldb capture
  (`server/h90-captures/h90_dict_capture.py` + "LIVE dict-capture attempt").
- Next: xref `zlib`/`deflate*` and `GZIPCompressorOutputStream` call sites, find
  the `zdict` argument's construction, then score the resulting candidate dict
  offline with `server/h90_dict_recover.py` against
  `server/h90-captures/req2_dict_constraints.json` before any live attempt.
