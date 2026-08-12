# Decisions — Tabs app

Design decisions and notes for the bass tab library (server + Angular web). See
`README.md` for usage; this file records *why* the code is shaped the way it is.

## Database: built-in `node:sqlite`

- No ORM, no external DB driver. `node:sqlite` `DatabaseSync` (built into recent
  Node) with synchronous statements — simple, fast for a single-user local app.
- Schema is applied idempotently from `server/schema.sql` on every boot; WAL mode
  and `PRAGMA foreign_keys = ON`.
- `tabs.db` lives at the `tabs/` root, next to `data/uploads/`.

## Two kinds of tabs, unified through `kind`

GP imports and UG imports are stored in separate tables (`tabs`, `ug_tabs`) but
are presented as one list. The composite key pattern is used everywhere:

- `folder_items(folder_id, kind, tab_id)` — `kind` is `'gp'` or `'ug'`.
- `favorites(kind, ref_id, tab_kind)` — `kind` is `artist`/`song`/`tab`; when
  `kind = 'tab'`, `tab_kind` disambiguates `gp` vs `ug`.
- The API unions both tables (`TAB_ITEM_SQL`) and attaches `folders` /
  `favorited` flags via `attachTabFlags`, so the frontend never branches on the
  backing table.

## Import pipeline

- **Dedup by SHA-256** in `files` — the same file uploaded or scanned twice is a
  duplicate; status transitions `pending → indexed` (or `error` with a message).
- **Batch indexing** (`INDEX_BATCH`, default 200) so a large scan doesn't block
  the API; the UI polls `/api/import/status` for progress.
- **Scanning** (`/api/import/scan`) walks a directory the server can see; upload
  (`/api/import/upload`) uses multer in-memory storage, writes the file with a
  ` (n)` suffix on name collisions, then re-checks the digest.
- Indexing can auto-add results to a chosen folder (used by the UI's "import into
  folder" flow).

## Metadata extraction via alphaTab

`server/indexer.js` uses `@coderline/alphatab` `ScoreLoader` to parse GP files for
metadata (title, artist, album, tempo, measures, per-track tunings, capo) and
detects the GP version from header magic (`FICHIER GUITAR PRO vX.Y`) or zip
signature (`gp6+` / `gp7/8`). Raw file bytes are kept on disk and re-parsed on
demand (viewer, text render); the DB stores the extracted metadata.

## Ultimate Guitar integration

`server/ug.js` scrapes UG's site JSON (`data-content`) rather than using an API:

- Requests throttled to one per 2s minimum; desktop Chrome UA; redirects followed.
- 403/429/202 responses are surfaced as "Cloudflare/rate-limit; try again later".
- Only `public`, non-Pro tabs are accepted; Pro-gated content is rejected.
- Content is cleaned (`[tab]`/`[ch]` tags stripped, whitespace normalized) and
  stored as text in `ug_tabs.content`.
- `scripts/probe-ug.js` is the manual probe used while developing the parser.

## Text tab rendering

`server/textTab.js` renders a GP score to plain text (note names, per-track
fret/string cells, bar separators) without alphaTab, so tabs can be previewed
without loading the viewer. Percussion tracks are skipped.

## Chord library

`server/chord-data.js` seeds `chords` (all 12 roots × 9 qualities) with voicings:

- Hardcoded **open shapes** for common keys/qualities.
- **E-form and A-form barre patterns** transposed to the fretboard.
- **DFS-generated voicings** for `dim`/`aug`, minimizing fretboard span (≤7) and
  position, requiring ≥3 distinct pitch classes.
- Shapes are validated against the chord's interval set before seeding; invalid
  ones are skipped with a warning.
- The web `chord-diagram` component renders an SVG fretboard (strings, frets,
  dots, mute/open markers). UG tabs in the viewer auto-detect chord names in the
  text and pick matching library chords into the sidebar.

## Search

`tabs_fts` is an FTS5 virtual table populated at index time for GP tabs. The
search endpoint prefixes the query with `*` for prefix matching; UG tabs are
matched with a plain `LIKE` fallback and merged into the results.

## Frontend

- Angular 18, **standalone components** (no NgModules), `provideRouter` config in
  `app.config.ts`; routes in `app.routes.ts`.
- alphaTab browser build + soundfont are vendored under `web/src/assets/alphatab/`
  and loaded as a script tag; the viewer (`tab-viewer`) wires `alphaTab.AlphaTabApi`
  for rendering, playback (play/pause/stop, speed, loop) and track selection.
- Dev server proxies `/api/*` to the API on 3001 (`proxy.conf.json`).
