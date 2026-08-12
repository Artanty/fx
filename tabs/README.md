# Tabs — bass tab library app

Local bass tab library with a Node/Express API (`tabs/server`) and an Angular web
frontend (`tabs/web`). Import Guitar Pro files or Ultimate Guitar tabs, browse by
artist/song, view and play back tablature, and organize your collection with
folders, favorites, and a chord library.

## Layout

```
tabs/
├── server/                  # Express API (port 3001)
│   ├── server.js            # routes, SQLite access, import pipeline
│   ├── indexer.js           # Guitar Pro parsing via alphaTab ScoreLoader
│   ├── ug.js                # Ultimate Guitar search/import (scraping)
│   ├── textTab.js           # plain-text tab renderer
│   ├── chord-data.js        # chord voicing generator + seeder
│   ├── schema.sql           # SQLite schema (WAL)
│   ├── scripts/probe-ug.js  # UG scraping probe
│   └── package.json
├── data/uploads/            # uploaded tab files
├── tabs.db                  # SQLite database (generated, WAL)
└── web/                     # Angular 18 frontend
    └── src/app/
        ├── pages/browse/        # library home
        ├── pages/artist/        # artist → songs
        ├── pages/song/          # song → tabs
        ├── pages/tab-viewer/    # alphaTab viewer + playback
        ├── pages/import/        # Guitar Pro upload/scan/index
        ├── pages/ug-import/     # Ultimate Guitar search/import
        ├── pages/chords/        # chord library browser
        ├── components/chord-diagram/  # SVG chord diagram
        └── services/api.service.ts
```

## Features

- **Guitar Pro import**: upload files (`gp`, `gp3`, `gp4`, `gp5`, `gpx`, `gpif`,
  `capx`, `musicxml`, `mxl`) or scan a directory on disk; files are deduplicated
  by SHA-256 and indexed in batches.
- **Metadata indexing**: title, artist, album, tempo, measures, capo, tunings and
  tracks extracted with `@coderline/alphatab` `ScoreLoader`.
- **Viewer & playback**: alphaTab-rendered tablature with play/pause/stop, track
  selection, playback speed, and loop toggle.
- **Ultimate Guitar import**: search UG by title and import public tabs (stored as
  text). Requests are throttled and Cloudflare/rate-limit responses are handled.
- **Text tab rendering**: quick `text/plain` preview rendered without alphaTab.
- **Search**: FTS5 full-text search across tab title/artist/album, plus a LIKE
  fallback that also covers UG tabs.
- **Organization**: folders (with per-tab membership), favorites for artists,
  songs and individual tabs.
- **Chord library**: seeded chord voicings (open shapes, E/A-form barres,
  generated dim/aug) rendered as SVG diagrams; UG tabs get chords auto-detected
  in the viewer sidebar.

## Running it

Per repo convention, the server is run by the user (not spawned by tooling).

**1. API server (port 3001)**

```bash
cd tabs/server
npm install        # once
npm start          # nodemon server.js (or: npm run start:no-watch)
```

**2. Angular frontend (port 4200)**

```bash
cd tabs/web
npm install        # once
npm start          # ng serve
```

Then open **http://localhost:4200**. The dev server proxies `/api/*` to
`http://localhost:3001` (`tabs/web/proxy.conf.json`).

## API endpoints

| Method | Path | Description |
| --- | --- | --- |
| GET | `/api/health` | liveness check |
| GET | `/api/artists` | artists with song counts (`?q=` filters by name) |
| GET | `/api/artists/:id/songs` | songs for an artist (with tab counts, tempo, favorite flags) |
| GET | `/api/songs/:id` | song detail with GP + UG tabs |
| GET | `/api/tabs/all` | all GP + UG tabs with folder/favorite flags |
| GET | `/api/tabs/:id` | GP tab detail |
| GET | `/api/tabs/:id/file` | download original GP file |
| GET | `/api/tabs/:id/text` | plain-text rendering of a GP tab |
| GET | `/api/ug/search` | Ultimate Guitar search (`q`, `page`) |
| POST | `/api/ug/import` | import a UG tab by URL |
| GET | `/api/ug/tabs/:id` | UG tab detail (text content) |
| GET | `/api/ug/tabs/:id/text` | raw UG tab text |
| GET/POST | `/api/folders` | list / create folders |
| GET/PATCH/DELETE | `/api/folders/:id` | folder detail / rename / delete |
| POST/DELETE | `/api/folders/:id/items...` | add / remove a tab from a folder |
| GET/POST | `/api/favorites` | list / toggle favorites (artist, song, tab) |
| GET | `/api/favorites/ids` | all favorite ids for the UI |
| GET | `/api/search` | FTS5 search across tabs (`q`) |
| POST | `/api/import/scan` | scan a directory and register files |
| POST | `/api/import/upload` | upload GP files (multipart) |
| POST | `/api/import/index` | index pending files in batches |
| GET | `/api/import/status` | import pipeline counts |
| GET | `/api/chords` | chord library (`?q=`, `?quality=`) |
| GET | `/api/chords/qualities` | distinct chord qualities |

Config via env vars: `PORT` (default 3001), `DB_PATH`, `INDEX_BATCH` (default 200).

## Database

See `server/schema.sql` for the DDL. WAL mode, foreign keys on.

- `artists` / `songs` — normalized artist → song hierarchy.
- `files` — imported files deduplicated by `sha256`, with `pending` / `indexed` /
  `error` status.
- `tabs` — indexed Guitar Pro tabs (metadata + reference to `files`).
- `ug_tabs` — Ultimate Guitar tabs stored as text.
- `folders` / `folder_items` — user folders; items are keyed by `(kind, tab_id)`.
- `favorites` — favorites for `artist` / `song` / `tab` kinds.
- `chords` — seeded chord voicings (root, quality, name, notes, base fret, frets).
- `tabs_fts` — FTS5 index over tab title/artist/album.
