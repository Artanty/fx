# FX — Eventide H90 Patch Explorer

Local database + web UI for browsing the **491 Eventide H90 presets** downloaded from [patchstorage.com](https://patchstorage.com/platform/eventide-h90/).

## What it does

1. **Downloads** all H90 presets from Patchstorage into `patchstorage/`.
2. **Builds a SQLite database** (`presets.db`) from the preset files + Patchstorage metadata.
3. **Serves** the database via a small Express API.
4. **Renders** an Angular web app to browse/search presets by effect family, algorithm, category, tag, and more, with a detail page per preset.

## Project layout

```
fx/
├── patchstorage/          # downloaded preset files
│   ├── pgm90/             #   463 single programs  (.pgm90)
│   ├── preset90/          #     7 preset slots     (.preset90)
│   ├── lst90/             #    20 list/bundle files (.lst90)
│   └── *.zip              #   downloaded bundle(s) (.zip)
├── presets.db             # SQLite database (generated)
├── api_cache.json         # cached Patchstorage API responses (speeds up rebuilds)
├── build_db.py            # builds presets.db (files + Patchstorage metadata)
├── server/                # Express API server (serves presets.db)
└── web/                   # Angular frontend
    ├── src/app/
    │   ├── pages/browse/          # filter/search page (home)
    │   ├── pages/preset-detail/   # per-preset page  (/preset/:slug)
    │   ├── services/api.service.ts
    │   └── models.ts
```

## How the pieces fit together

```
patchstorage.com ──▶ build_db.py ──▶ presets.db ──▶ server (Express, :3000)
                                                        ▲
Angular app (ng serve, :4211) ── /api/* proxied to :3000 ─┘
```

- The frontend dev server (`ng serve`) runs on **port 4211** and proxies `/api/*` to the Express server on **port 3000** (`web/proxy.conf.json`).
- The API reads `presets.db` read-only via `better-sqlite3`.

## Running it

Two processes are needed.

**1. API server (port 3000)**

```bash
cd server
npm install        # once
npm start          # or: node server.js
```

**2. Angular frontend (port 4211)**

```bash
cd web
npm install        # once
npm start          # ng serve, dev port 4211
```

Then open **http://localhost:4211**.

From the `web/` folder you can also run `npm run server` to start the API without `cd`-ing.

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | liveness check |
| GET | `/api/filters` | distinct effect families, algorithms, categories, tags, file types (with counts) |
| GET | `/api/patches` | paginated preset list. Query params: `family`, `algorithm`, `category`, `tag`, `ext` (comma-separated, multiple allowed), `q` (search title/preset/algorithm/author), `sort` (`downloads`\|`views`\|`likes`\|`updated`\|`created`\|`title`), `page`, `per_page` |
| GET | `/api/patches/:slug` | full detail for one preset (full description, notes, tags, stats, file info) |
| GET | `/api/files/:id/download` | downloads the preset file from `patchstorage/` |

API notes:

- Configurable via env vars: `PORT` (default 3000) and `DB_PATH` (default `../presets.db`).
- Pagination defaults to `page=1`, `per_page=24` (max 100). `q` searches title, preset name, algorithm, and author.
- Filter semantics: multiple values *within* one group (e.g. several families) are OR'd together; groups are AND'd together.
- The API is read-only, CORS is wide open (`*`).
- `artwork_url` is stored in the DB but not currently displayed in the UI.

## The frontend

- **Browse page** (`/`): sidebar filters (effect family, algorithm, category, file type, tags with show-more), search-as-you-type, sort dropdown, paginated card grid. Filters are multi-select and combine. Search-as-you-type is debounced 300ms; the tag list is capped at 30 entries with a "Show all" toggle.
- **Detail page** (`/preset/:slug`): full description, program notes, algorithm/family chips, download/view/like stats, tags, and a **Download** button that serves the local file. It also shows file size, the embedded `preset_name`, license, and a link back to the patch on patchstorage.com.
- The dev port (4211) and the `/api` proxy are configured in `angular.json` and `proxy.conf.json`.
- Unit tests exist (`npm test`, Karma/Jasmine) — `web/src/app/app.component.spec.ts`.

## The database

Schema (see `build_db.py` for the DDL):

```
patches           — slug, title, url, full content/description, author, revision,
                    timestamps, view/like/download counts, license, artwork
files             — filename, extension, path, filesize, preset_name,
                    algorithm, secondary_algorithm, effect_family, notes
algorithms        — reference: H90 algorithm name → effect family
file_algorithms   — per-slot algorithms inside .lst90 bundles
tags / categories + patch_tags / patch_categories (many-to-many)
```

- Effect families are derived from the H90 algorithm name embedded in each `.pgm90` file (e.g. `UltraTap` → Delay, `TriceraChorus` → Modulation).
- A file can embed several algorithm blobs: the first becomes `algorithm`, the second `secondary_algorithm`, and `.lst90` bundles get every per-slot algorithm stored in `file_algorithms` with its `position`.
- **Program notes are not from the API** — they are reverse-engineered from the raw file bytes with string-extraction heuristics (`extract_notes` in `build_db.py`).
- Algorithms not in the family map are still recorded, with `effect_family` set to `Unknown`.
- ~100 older files have no embedded algorithm; those are left `NULL` in `algorithm`/`effect_family` but still searchable by title/tags/description.

## Rebuilding the database

```bash
python3 build_db.py
```

It re-scans `patchstorage/` and reuses the cached API metadata (`api_cache.json`) when present, so rebuilds are fast and offline. If the cache is missing it re-fetches everything from the Patchstorage API (platform ID `8271`, paginated).

## Sending presets to the H90 (work in progress)

- **Selecting a preset slot works today**: `server/h90-send.js --program N`
  sends a Program Change to the H90 over WiFi MIDI.
- **Importing a preset's content** (sending an arbitrary `.pgm90`/`.preset90`
  to a pedal slot without the desktop app) is being reverse-engineered. The
  wire format (MIDI SysEx, 7-bit bit-packed payload, custom encryption) is
  documented in `DECISIONS.md`, with captured import traffic in
  `server/h90-captures/` and the BLE MITM proxy in `server/h90_proxy.swift`.
- Status: the 7-bit packing is solved; the payload's custom encryption is the
  remaining blocker (see `DECISIONS.md` → "Resume here").
