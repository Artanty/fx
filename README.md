# FX — Eventide H90 Patch Explorer + Source Audio L.A. Lady

Two Angular-backed tools live under `web/`, with their backends under `back/`:

- **H90** — local database + web UI for browsing the **491 Eventide H90
  presets** downloaded from [patchstorage.com](https://patchstorage.com/platform/eventide-h90/).
- **L.A. Lady (dist)** — inspector + preset write/upload against a connected
  Source Audio L.A. Lady via HID/MIDI.

> This README covers the **H90/FX** project. Other projects in this repo:
>
> - **Tabs** — bass tab library app (Node/Express + Angular):
>   [`../tabs/README.md`](../tabs/README.md),
>   [`../tabs/DECISIONS.md`](../tabs/DECISIONS.md)

## Project layout

```
fx/
├── web/                    # Angular frontend (ng serve, :4211)
│   └── src/app/
│       ├── dist/           # L.A. Lady app (default route /dist), hits :3111
│       │   └── lalady/
│       ├── pages/browse/          # H90 filter/search page (/h90)
│       ├── pages/preset-detail/   # H90 per-preset page (/h90/preset/:slug)
│       └── services/ + models.ts
├── back/
│   ├── package.json        # orchestrates backends (start / start:h90 / start:la)
│   ├── h90/                # H90 backend + reverse-engineering tooling
│   │   ├── server.js       # Express API (serves presets.db, :3000)
│   │   ├── build_db.py     # builds presets.db (files + Patchstorage metadata)
│   │   ├── patchstorage/   # downloaded preset files (generated)
│   │   ├── presets.db      # SQLite database (generated)
│   │   └── h90_*.py / h90-*.js   # H90 RE scripts, captures, notes
│   └── lalady/             # Source Audio L.A. Lady backend
│       └── server.js       # Express API (:3111)
├── input/                  # shared raw data (H90 backups/lists + L.A. Lady .osbf/.pre/dist-engines)
└── mc3/                    # Morningstar MC3 backup notes
```

## Running it

**Web frontend (port 4211)**

```bash
cd web
npm install        # once
npm start          # ng serve, dev port 4211
```

Open http://localhost:4211. The top header links both apps: `/dist` (L.A. Lady)
and `/h90` (H90 explorer).

**L.A. Lady backend (port 3111)**

```bash
cd back
npm install --prefix lalady   # once
npm run start:la              # starts back/lalady/server.js
```

**H90 backend (port 3000)**

```bash
cd back
npm install --prefix h90      # once
npm run start:h90             # starts back/h90/server.js; or: npm start
```

From `web/` you can also run `npm run server` (H90 API) or
`npm run start:lalady` as shortcuts.

The Angular dev server proxies `/api/*` to the H90 API on **:3000**
(`web/proxy.conf.json`); the L.A. Lady app talks to **:3111** directly.

## H90 API endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | liveness check |
| GET | `/api/filters` | distinct effect families, algorithms, categories, tags, file types (with counts) |
| GET | `/api/patches` | paginated preset list. Query params: `family`, `algorithm`, `category`, `tag`, `ext` (comma-separated, multiple allowed), `q` (search title/preset/algorithm/author), `sort` (`downloads`\|`views`\|`likes`\|`updated`\|`created`\|`title`), `page`, `per_page` |
| GET | `/api/patches/:slug` | full detail for one preset (full description, notes, tags, stats, file info) |
| GET | `/api/files/:id/download` | downloads the preset file from `patchstorage/` |

API notes:

- Configurable via env vars: `PORT` (default 3000) and `DB_PATH` (default
  `back/h90/presets.db`).
- Pagination defaults to `page=1`, `per_page=24` (max 100). `q` searches title,
  preset name, algorithm, and author.
- Filter semantics: multiple values *within* one group (e.g. several families)
  are OR'd together; groups are AND'd together.
- The API is read-only, CORS is wide open (`*`).

## Rebuilding the H90 database

```bash
cd back/h90
python3 build_db.py
```

It re-scans `back/h90/patchstorage/` and reuses the cached API metadata
(`api_cache.json`) when present, so rebuilds are fast and offline. If the cache
is missing it re-fetches everything from the Patchstorage API (platform ID
`8271`, paginated).

## Sending presets to the H90 (work in progress)

- **Selecting a preset slot works today**: `back/h90/h90-send.js --program N`
  sends a Program Change to the H90 over WiFi MIDI.
- **Importing a preset's content** (sending an arbitrary `.pgm90`/`.preset90`
  to a pedal slot without the desktop app) is being reverse-engineered. The
  write path is **not encrypted**: it is zlib DEFLATE over a 7-bit packed SysEx
  body, compressed against a **preset dictionary** built at runtime from pedal
  state. Full protocol history is in `DECISIONS.md`; working notes are in
  `back/h90/H90-IMPORT-NOTES.md`.
- Status: read path solved (plain zlib FlatBuffers); write path decoded, and
  the req1 write payload (`back/h90/h90-recon/`, from
  `back/h90/h90-captures/`) is identified as the TWO-WAY preset's parameter
  dictionary in a compact base64 wire variant. The exact runtime dictionary and
  the tail encoding are the remaining unknowns.
- **Static RE** of the desktop app binary uses `back/h90/h90_capstone.py`
  (capstone-based xref finder / disassembler for the arm64 slice, to locate
  the JSON builder, base64 encoder and deflate-dictionary construction). Needs
  `pip install capstone` — the `input/capstone-next/` source checkout is
  git-ignored and NOT needed on another device (the PyPI wheel is enough).

### H90 import next steps

1. **Map the req1 region's segment structure** — why 4-char groups break clean
   base64, and the reversed-looking tail fragments. Tooling: `python3
   back/h90/h90_reconstruct.py analyze back/h90/h90-captures/h90_import_req.bin`.
2. **Reconstruct req1's full output** — fill the ~113 dict-copy bytes in
   `out[211:976]` so every literal b64 char re-encodes cleanly.
3. **Prove correctness**: use the reconstructed req1 output as the dictionary
   to decode req2 (MURKY); a clean decode validates both the dict and the
   encoder (check against `MURKY-BUCKUET-LEAD-642f25f984e72.preset90`).
4. **Static-analyze the write path** (capstone): run
   `back/h90/h90_capstone.py` xrefs to locate the write-JSON builder /
   deflate-dict construction in the app binary (setup + usage in
   `back/h90/H90-IMPORT-NOTES.md`).
5. **Live-capture the dictionary** (primary, once and for all): lldb-attach to
   `~/h90-re/H90 Control.app`, trigger an import, dump the compressor's
   `z_stream` dict / `memory find` the heap (helper: `back/h90/h90-captures/
   h90_dict_capture.py`; arm command in `back/h90/H90-IMPORT-NOTES.md`).
6. **Implement the encoder + server wiring**: serialize preset → raw-deflate
   with the dict → 7-bit pack → frame → send via CoreMIDI; add
   `POST /api/h90/preset` in `back/h90/server.js` and a "Send to H90" button in
   the Angular detail page.
