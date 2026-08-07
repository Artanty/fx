# h90_dict_recover regression corpus

Deflate streams generated with Node's `zlib` (`inflateRawSync`/`deflateRawSync`,
see the `h90-fb` capture notes) and captured into JSON. Used to validate
`server/h90_dict_recover.py` against a reference implementation.

## Files

- `node_fixed.json` — 26 raw-deflate payloads using **fixed** Huffman blocks
  (payloads built from repeating segments, so matches + literals are exercised).
  Keys: `payload` (plaintext), `defl` (raw deflate).
- `node_fuzz.json` — 60 raw-deflate payloads compressed **with a preset
  dictionary** (`dict` key, random bytes) so early symbols are matches into the
  dictionary — the exact shape of the H90 import write payloads. Keys:
  `dict`, `payload`, `defl`.

All `bytes` are base64 in the JSON.

## Origin

- 2026-08-07 debug session: Node was used as a trusted reference because its
  `inflateRawSync` accepts `{dictionary}`; Python's `zlib` honors `zdict` only in
  raw mode (`wbits=-15`). The corpora were generated then and initially exposed a
  wrong `LENGTH_BASE`/`LENGTH_EXTRA` in `h90_dict_recover.py` (since fixed —
  see `H90-IMPORT-NOTES.md`).
- These JSON files are a persisted copy of the ephemeral `/tmp/h90_fb/*.json`.

## Regenerating

The corpus generator is small; if a future round of validation is needed,
re-create equivalents with:

```js
const zlib = require("zlib");
const d = zlib.deflateRawSync(payload, { dictionary: dict }); // fixed/dict
const p = zlib.inflateRawSync(d, { dictionary: dict });        // reference
```
