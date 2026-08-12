const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { indexFile, upsertArtist, upsertSong } = require("./indexer");
const { renderTextTab } = require("./textTab");
const { searchUg, fetchUgTab } = require("./ug");
const { seedChords } = require("./chord-data");

const PORT = process.env.PORT || 3001;
const ROOT_DIR = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT_DIR, "data");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const DB_PATH = process.env.DB_PATH || path.join(ROOT_DIR, "tabs.db");
const BATCH_SIZE = parseInt(process.env.INDEX_BATCH || "200", 10);

const EXTS = [".gp", ".gp3", ".gp4", ".gp5", ".gpx", ".gpif", ".capx", ".musicxml", ".mxl"];

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
const schema = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf8");
db.exec(schema);
seedChords(db);

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`[req] ${req.method} ${req.originalUrl} -> ${res.statusCode} (${Date.now() - start}ms)`);
  });
  next();
});

const upload = multer({ storage: multer.memoryStorage() });

function sha256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function attachTabFlags(items) {
  if (!items || !items.length) return items || [];
  const folderMap = db
    .prepare(
      `SELECT fi.kind, fi.tab_id, f.id, f.name
       FROM folder_items fi
       JOIN folders f ON f.id = fi.folder_id`
    )
    .all();
  const favs = db
    .prepare(`SELECT ref_id AS tab_id, tab_kind AS kind FROM favorites WHERE kind = 'tab'`)
    .all();
  return items.map((it) => ({
    ...it,
    folders: folderMap
      .filter((f) => f.kind === it.kind && f.tab_id === it.id)
      .map((f) => ({ id: f.id, name: f.name })),
    favorited: favs.some((f) => f.kind === it.kind && f.tab_id === it.id),
  }));
}

const TAB_ITEM_SQL = (gpWhere, ugWhere) => `
  SELECT t.id, 'gp' AS kind, t.title, a.name AS artist, a.id AS artist_id,
         s.id AS song_id, s.title AS song_title, t.album, t.tempo,
         t.gp_version, t.measures, NULL AS ug_type, NULL AS rating, NULL AS votes
  FROM tabs t
  JOIN songs s ON s.id = t.song_id
  JOIN artists a ON a.id = s.artist_id
  ${gpWhere || ""}
  UNION ALL
  SELECT u.id, 'ug' AS kind, u.title, a.name AS artist, a.id AS artist_id,
         s.id AS song_id, s.title AS song_title, NULL AS album, NULL AS tempo,
         NULL AS gp_version, NULL AS measures, u.ug_type, u.rating, u.votes
  FROM ug_tabs u
  JOIN songs s ON s.id = u.song_id
  JOIN artists a ON a.id = s.artist_id
  ${ugWhere || ""}`;

function fetchAllTabItems() {
  const rows = db.prepare(TAB_ITEM_SQL("", "")).all();
  return attachTabFlags(rows);
}

function fetchFolderTabItems(folderId) {
  const gpWhere = "WHERE EXISTS (SELECT 1 FROM folder_items fi WHERE fi.folder_id = ? AND fi.kind = 'gp' AND fi.tab_id = t.id)";
  const ugWhere = "WHERE EXISTS (SELECT 1 FROM folder_items fi WHERE fi.folder_id = ? AND fi.kind = 'ug' AND fi.tab_id = u.id)";
  const rows = db.prepare(TAB_ITEM_SQL(gpWhere, ugWhere)).all(folderId, folderId);
  return attachTabFlags(rows);
}

function fetchFavoriteTabItems() {
  const gpWhere = "WHERE EXISTS (SELECT 1 FROM favorites f WHERE f.kind = 'tab' AND f.tab_kind = 'gp' AND f.ref_id = t.id)";
  const ugWhere = "WHERE EXISTS (SELECT 1 FROM favorites f WHERE f.kind = 'tab' AND f.tab_kind = 'ug' AND f.ref_id = u.id)";
  const rows = db.prepare(TAB_ITEM_SQL(gpWhere, ugWhere)).all();
  return attachTabFlags(rows);
}

function isTabExt(name) {
  return EXTS.includes(path.extname(name).toLowerCase());
}

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (isTabExt(entry.name)) out.push(full);
  }
  return out;
}

function registerFile(absPath, filename) {
  const ext = path.extname(filename).toLowerCase();
  const size = fs.statSync(absPath).size;
  const digest = sha256(fs.readFileSync(absPath));
  const rel = path.relative(ROOT_DIR, absPath);
  const info = db
    .prepare("SELECT id, status FROM files WHERE sha256 = ?")
    .get(digest);
  if (info) return { id: info.id, status: info.status, duplicate: true };
  const result = db
    .prepare(
      "INSERT INTO files (sha256, filename, ext, path, size, status) VALUES (?, ?, ?, ?, ?, 'pending')"
    )
    .run(digest, filename, ext, rel, size);
  return { id: result.lastInsertRowid, status: "pending", duplicate: false };
}

app.get("/api/artists", (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    const rows = q
      ? db.prepare(
          `SELECT a.id, a.name, a.slug, COUNT(DISTINCT s.id) AS song_count
           FROM artists a
           JOIN songs s ON s.artist_id = a.id
           WHERE a.name LIKE ?
           GROUP BY a.id
           ORDER BY a.name COLLATE NOCASE`
        ).all(`%${q}%`)
      : db.prepare(
          `SELECT a.id, a.name, a.slug, COUNT(DISTINCT s.id) AS song_count
           FROM artists a
           JOIN songs s ON s.artist_id = a.id
           GROUP BY a.id
           ORDER BY a.name COLLATE NOCASE`
        ).all();
    res.json({ items: rows });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/artists/:id/songs", (req, res) => {
  try {
    const artist = db.prepare("SELECT id, name FROM artists WHERE id = ?").get(req.params.id);
    if (!artist) return res.status(404).json({ error: "artist not found" });
    const songs = db.prepare(
      `SELECT s.id, s.title,
              (SELECT COUNT(*) FROM tabs t WHERE t.song_id = s.id) +
              (SELECT COUNT(*) FROM ug_tabs u WHERE u.song_id = s.id) AS tab_count,
              MIN(t.tempo) AS tempo
       FROM songs s
       LEFT JOIN tabs t ON t.song_id = s.id
       WHERE s.artist_id = ?
       GROUP BY s.id
       ORDER BY s.title COLLATE NOCASE`
    ).all(req.params.id);
    console.log(`[artist-songs] id=${req.params.id} artist=${JSON.stringify(artist)} -> ${songs.length} songs`);
    const artistFavorited = !!db
      .prepare("SELECT id FROM favorites WHERE kind = 'artist' AND ref_id = ? AND tab_kind = ''")
      .get(artist.id);
    const favSongs = new Set(
      db.prepare("SELECT ref_id FROM favorites WHERE kind = 'song'").all().map((r) => r.ref_id)
    );
    res.json({
      artist: { ...artist, favorited: artistFavorited },
      items: songs.map((s) => ({ ...s, favorited: favSongs.has(s.id) })),
    });
  } catch (err) {
    console.error(`[artist-songs] ERROR id=${req.params.id}: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/songs/:id", (req, res) => {
  try {
    const song = db.prepare(
      `SELECT s.id, s.title, a.id AS artist_id, a.name AS artist
       FROM songs s
       JOIN artists a ON a.id = s.artist_id
       WHERE s.id = ?`
    ).get(req.params.id);
    if (!song) return res.status(404).json({ error: "song not found" });
    const tabs = db.prepare(
      `SELECT t.id, t.title, t.album, t.tempo, t.gp_version, t.measures,
              t.capo, t.tunings, t.tracks, f.id AS file_id, f.filename,
              f.ext, f.size, 'gp' AS kind
       FROM tabs t
       JOIN files f ON f.id = t.file_id
       WHERE t.song_id = ?
       ORDER BY t.title COLLATE NOCASE`
    ).all(req.params.id).map((r) => ({
      ...r,
      tunings: r.tunings ? JSON.parse(r.tunings) : [],
      tracks: r.tracks ? JSON.parse(r.tracks) : [],
    }));
    const ugTabs = db.prepare(
      `SELECT u.id, u.title, u.ug_type, u.rating, u.votes, u.version,
              u.difficulty, u.url, 'ug' AS kind
       FROM ug_tabs u
       WHERE u.song_id = ?
       ORDER BY u.rating DESC`
    ).all(req.params.id).map((r) => ({
      ...r,
      filename: null,
      ext: null,
      size: null,
      album: null,
      tempo: null,
      gp_version: null,
      measures: null,
      capo: 0,
      tunings: [],
      tracks: [],
    }));
    const favorited = !!db
      .prepare("SELECT id FROM favorites WHERE kind = 'song' AND ref_id = ? AND tab_kind = ''")
      .get(song.id);
    res.json({ song: { ...song, favorited }, items: attachTabFlags([...ugTabs, ...tabs]) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tabs/all", (req, res) => {
  try {
    res.json({ items: fetchAllTabItems() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tabs/:id", (req, res) => {
  try {
    const row = db.prepare(
      `SELECT t.id, t.title, t.album, t.tempo, t.gp_version, t.measures,
              t.capo, t.tunings, t.tracks, t.created_at,
              f.id AS file_id, f.filename, f.ext, f.size, f.path,
              a.id AS artist_id, a.name AS artist,
              s.id AS song_id, s.title AS song_title
       FROM tabs t
       JOIN files f ON f.id = t.file_id
       JOIN songs s ON s.id = t.song_id
       JOIN artists a ON a.id = s.artist_id
       WHERE t.id = ?`
    ).get(req.params.id);
    if (!row) return res.status(404).json({ error: "tab not found" });
    const flagged = attachTabFlags([
      {
        ...row,
        kind: "gp",
        tunings: row.tunings ? JSON.parse(row.tunings) : [],
        tracks: row.tracks ? JSON.parse(row.tracks) : [],
      },
    ])[0];
    res.json(flagged);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tabs/:id/file", (req, res) => {
  try {
    const row = db.prepare(
      "SELECT f.path, f.filename FROM tabs t JOIN files f ON f.id = t.file_id WHERE t.id = ?"
    ).get(req.params.id);
    if (!row || !row.path) return res.status(404).json({ error: "tab not found" });
    const full = path.join(ROOT_DIR, row.path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: "file missing on disk" });
    res.download(full, row.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/tabs/:id/text", (req, res) => {
  try {
    const row = db.prepare(
      "SELECT f.path FROM tabs t JOIN files f ON f.id = t.file_id WHERE t.id = ?"
    ).get(req.params.id);
    if (!row || !row.path) return res.status(404).json({ error: "tab not found" });
    const full = path.join(ROOT_DIR, row.path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: "file missing on disk" });
    const { parseScore } = require("./indexer");
    const score = parseScore(fs.readFileSync(full));
    res.type("text/plain").send(renderTextTab(score));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ug/search", async (req, res) => {
  try {
    const page = parseInt(req.query.page, 10) || 1;
    const result = await searchUg(req.query.q || "", page);
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.post("/api/ug/import", async (req, res) => {
  try {
    const url = (req.body && req.body.url || "").trim();
    if (!url) return res.status(400).json({ error: "url is required" });
    const ug = await fetchUgTab(url);
    const artistId = upsertArtist(db, ug.artist);
    const songId = upsertSong(db, artistId, ug.song);
    const existing = db.prepare("SELECT id FROM ug_tabs WHERE ug_id = ?").get(ug.id);
    if (existing) {
      return res.json({ id: existing.id, kind: "ug", duplicate: true, song_id: songId });
    }
    const result = db.prepare(
      `INSERT INTO ug_tabs (ug_id, song_id, title, ug_type, rating, votes, version, difficulty, url, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(ug.id, songId, ug.title, ug.type, ug.rating, ug.votes, ug.version, ug.difficulty, ug.url, ug.content);
    res.json({ id: result.lastInsertRowid, kind: "ug", duplicate: false, song_id: songId });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

app.get("/api/ug/tabs/:id", (req, res) => {
  try {
    const row = db.prepare(
      `SELECT u.id, u.title, u.ug_type, u.rating, u.votes, u.version,
              u.difficulty, u.url, u.content, u.created_at,
              a.id AS artist_id, a.name AS artist,
              s.id AS song_id, s.title AS song_title
       FROM ug_tabs u
       JOIN songs s ON s.id = u.song_id
       JOIN artists a ON a.id = s.artist_id
       WHERE u.id = ?`
    ).get(req.params.id);
    if (!row) return res.status(404).json({ error: "tab not found" });
    res.json(attachTabFlags([{ ...row, kind: "ug" }])[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/ug/tabs/:id/text", (req, res) => {
  try {
    const row = db.prepare("SELECT content FROM ug_tabs WHERE id = ?").get(req.params.id);
    if (!row) return res.status(404).json({ error: "tab not found" });
    res.type("text/plain").send(row.content);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/folders", (req, res) => {
  try {
    const items = db.prepare(
      `SELECT f.id, f.name,
              (SELECT COUNT(*) FROM folder_items fi WHERE fi.folder_id = f.id) AS tab_count
       FROM folders f
       ORDER BY f.name COLLATE NOCASE`
    ).all();
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/folders", (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const existing = db.prepare("SELECT id FROM folders WHERE name = ?").get(name);
    if (existing) return res.status(409).json({ error: "folder already exists" });
    const result = db.prepare("INSERT INTO folders (name) VALUES (?)").run(name);
    res.json({ id: result.lastInsertRowid, name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.patch("/api/folders/:id", (req, res) => {
  try {
    const name = String((req.body && req.body.name) || "").trim();
    if (!name) return res.status(400).json({ error: "name is required" });
    const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(req.params.id);
    if (!folder) return res.status(404).json({ error: "folder not found" });
    const clash = db.prepare("SELECT id FROM folders WHERE name = ? AND id != ?").get(name, folder.id);
    if (clash) return res.status(409).json({ error: "folder already exists" });
    db.prepare("UPDATE folders SET name = ? WHERE id = ?").run(name, folder.id);
    res.json({ id: Number(folder.id), name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/folders/:id", (req, res) => {
  try {
    const result = db.prepare("DELETE FROM folders WHERE id = ?").run(req.params.id);
    if (!result.changes) return res.status(404).json({ error: "folder not found" });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/folders/:id", (req, res) => {
  try {
    const folder = db.prepare(
      `SELECT f.id, f.name,
              (SELECT COUNT(*) FROM folder_items fi WHERE fi.folder_id = f.id) AS tab_count
       FROM folders f WHERE f.id = ?`
    ).get(req.params.id);
    if (!folder) return res.status(404).json({ error: "folder not found" });
    res.json({ folder, items: fetchFolderTabItems(folder.id) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/folders/:id/items", (req, res) => {
  try {
    const folder = db.prepare("SELECT id FROM folders WHERE id = ?").get(req.params.id);
    if (!folder) return res.status(404).json({ error: "folder not found" });
    const kind = req.body && req.body.kind === "ug" ? "ug" : "gp";
    const tabId = Number(req.body && req.body.tab_id);
    if (!tabId) return res.status(400).json({ error: "tab_id is required" });
    db.prepare("INSERT OR IGNORE INTO folder_items (folder_id, kind, tab_id) VALUES (?, ?, ?)").run(
      folder.id, kind, tabId
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/api/folders/:id/items/:kind/:tabId", (req, res) => {
  try {
    const kind = req.params.kind === "ug" ? "ug" : "gp";
    db.prepare("DELETE FROM folder_items WHERE folder_id = ? AND kind = ? AND tab_id = ?").run(
      req.params.id, kind, Number(req.params.tabId)
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/favorites", (req, res) => {
  try {
    const artists = db.prepare(
      `SELECT a.id, a.name
       FROM favorites f JOIN artists a ON a.id = f.ref_id
       WHERE f.kind = 'artist'
       ORDER BY a.name COLLATE NOCASE`
    ).all();
    const songs = db.prepare(
      `SELECT s.id, s.title, a.id AS artist_id, a.name AS artist,
              (SELECT GROUP_CONCAT(f.name, '||') FROM (
                 SELECT DISTINCT f2.name AS name FROM folders f2
                 WHERE EXISTS (
                   SELECT 1 FROM folder_items fi
                   WHERE fi.folder_id = f2.id AND fi.kind = 'gp'
                     AND fi.tab_id IN (SELECT t.id FROM tabs t WHERE t.song_id = s.id)
                 )
                 OR EXISTS (
                   SELECT 1 FROM folder_items fi
                   WHERE fi.folder_id = f2.id AND fi.kind = 'ug'
                     AND fi.tab_id IN (SELECT u.id FROM ug_tabs u WHERE u.song_id = s.id)
                 )
               ) f) AS folders
       FROM favorites fv
       JOIN songs s ON s.id = fv.ref_id
       JOIN artists a ON a.id = s.artist_id
       WHERE fv.kind = 'song'
       ORDER BY a.name COLLATE NOCASE, s.title COLLATE NOCASE`
    ).all().map((r) => ({
      ...r,
      folders: r.folders ? r.folders.split("||") : [],
    }));
    res.json({ artists, songs, tabs: fetchFavoriteTabItems() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/favorites", (req, res) => {
  try {
    const kind = req.body && req.body.kind;
    if (!["artist", "song", "tab"].includes(kind)) {
      return res.status(400).json({ error: "kind must be artist, song or tab" });
    }
    const refId = Number(req.body && req.body.ref_id);
    if (!refId) return res.status(400).json({ error: "ref_id is required" });
    const tabKind = kind === "tab" ? (req.body.tab_kind === "ug" ? "ug" : "gp") : "";
    const existing = db
      .prepare("SELECT id FROM favorites WHERE kind = ? AND ref_id = ? AND tab_kind = ?")
      .get(kind, refId, tabKind);
    if (existing) {
      db.prepare("DELETE FROM favorites WHERE id = ?").run(existing.id);
      return res.json({ active: false });
    }
    db.prepare("INSERT INTO favorites (kind, ref_id, tab_kind) VALUES (?, ?, ?)").run(
      kind, refId, tabKind
    );
    res.json({ active: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/favorites/ids", (req, res) => {
  try {
    const rows = db.prepare(
      "SELECT kind, ref_id, tab_kind FROM favorites"
    ).all();
    const artists = rows.filter((r) => r.kind === "artist").map((r) => r.ref_id);
    const songs = rows.filter((r) => r.kind === "song").map((r) => r.ref_id);
    const tabs = rows
      .filter((r) => r.kind === "tab")
      .map((r) => ({ id: r.ref_id, kind: r.tab_kind }));
    res.json({ artists, songs, tabs });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/search", (req, res) => {
  try {
    const q = (req.query.q || "").trim();
    if (!q) return res.json({ items: [] });
    const rows = db.prepare(
      `SELECT f.rank, t.id, t.title, a.name AS artist, t.album, a.id AS artist_id,
              a.slug AS artist_slug, s.id AS song_id
       FROM tabs_fts f
       JOIN tabs t ON t.id = f.rowid
       JOIN songs s ON s.id = t.song_id
       JOIN artists a ON a.id = s.artist_id
       WHERE tabs_fts MATCH ?
       ORDER BY f.rank
       LIMIT 50`
    ).all(q.replace(/"/g, "") + "*").map((r) => ({
      ...r,
      artist: r.artist,
    }));
    const ugRows = db.prepare(
      `SELECT u.id, u.title, u.ug_type, u.rating, u.votes,
              a.name AS artist, a.id AS artist_id, s.id AS song_id
       FROM ug_tabs u
       JOIN songs s ON s.id = u.song_id
       JOIN artists a ON a.id = s.artist_id
       WHERE s.title LIKE ? OR a.name LIKE ?
       LIMIT 20`
    ).all(`%${q}%`, `%${q}%`).map((r) => ({
      id: r.id,
      title: r.title,
      artist: r.artist,
      album: r.ug_type,
      rank: 0,
      artist_id: r.artist_id,
      artist_slug: "",
      song_id: r.song_id,
      kind: "ug",
      ug_rating: r.rating,
      ug_votes: r.votes,
    }));
    res.json({ items: [...ugRows, ...rows] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import/scan", (req, res) => {
  try {
    const dir = (req.body.dir || "").trim();
    if (!dir) return res.status(400).json({ error: "dir is required" });
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
      return res.status(400).json({ error: "dir is not a valid directory" });
    }
    const files = walk(dir, []);
    let added = 0;
    let duplicates = 0;
    for (const f of files) {
      const result = registerFile(f, path.basename(f));
      if (result.duplicate) duplicates++;
      else added++;
    }
    res.json({ scanned: files.length, added, duplicates });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import/upload", upload.array("files"), (req, res) => {
  try {
    const files = req.files || [];
    const results = [];
    for (const f of files) {
      if (!isTabExt(f.originalname)) continue;
      const safe = path.basename(f.originalname);
      const rel = path.join("data", "uploads", safe);
      const full = path.join(ROOT_DIR, rel);
      let n = 1;
      let target = full;
      while (fs.existsSync(target)) {
        const ext = path.extname(safe);
        target = path.join(ROOT_DIR, "data", "uploads", `${path.basename(safe, ext)} (${n})${ext}`);
        n++;
      }
      fs.writeFileSync(target, f.buffer);
      const digest = sha256(f.buffer);
      const existing = db.prepare("SELECT id, status FROM files WHERE sha256 = ?").get(digest);
      if (existing) {
        fs.unlinkSync(target);
        results.push({ filename: safe, duplicate: true, status: existing.status });
        continue;
      }
      const relTarget = path.relative(ROOT_DIR, target);
      const result = db
        .prepare(
          "INSERT INTO files (sha256, filename, ext, path, size, status) VALUES (?, ?, ?, ?, ?, 'pending')"
        )
        .run(digest, safe, path.extname(safe), relTarget, f.size);
      results.push({ filename: safe, id: result.lastInsertRowid, status: "pending", duplicate: false });
    }
    res.json({ uploaded: results.length, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/import/index", (req, res) => {
  try {
    const batch = req.body && req.body.limit ? Math.min(parseInt(req.body.limit, 10), 5000) : BATCH_SIZE;
    const folderId = req.body && req.body.folder_id ? Number(req.body.folder_id) : 0;
    if (folderId && !db.prepare("SELECT id FROM folders WHERE id = ?").get(folderId)) {
      return res.status(404).json({ error: "folder not found" });
    }
    const pending = db.prepare("SELECT * FROM files WHERE status = 'pending' LIMIT ?").all(batch);
    let ok = 0;
    let failed = 0;
    const errors = [];
    const addToFolder = folderId
      ? db.prepare("INSERT OR IGNORE INTO folder_items (folder_id, kind, tab_id) VALUES (?, 'gp', ?)")
      : null;
    for (const fileRow of pending) {
      try {
        const full = path.join(ROOT_DIR, fileRow.path);
        if (!fs.existsSync(full)) throw new Error("file missing on disk");
        const indexed = indexFile(db, fileRow, fs.readFileSync(full));
        if (addToFolder) addToFolder.run(folderId, indexed.tabId);
        ok++;
      } catch (err) {
        failed++;
        errors.push({ filename: fileRow.filename, error: err.message });
        db.prepare("UPDATE files SET status = 'error', error = ? WHERE id = ?").run(
          err.message, fileRow.id
        );
      }
    }
    res.json({ processed: pending.length, ok, failed, remaining: db.prepare("SELECT COUNT(*) AS c FROM files WHERE status = 'pending'").get().c, errors: errors.slice(0, 20) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/import/status", (_req, res) => {
  try {
    const count = (status) =>
      db.prepare("SELECT COUNT(*) AS c FROM files WHERE status = ?").get(status).c;
    res.json({
      pending: count("pending"),
      indexed: count("indexed"),
      error: count("error"),
      total: db.prepare("SELECT COUNT(*) AS c FROM files").get().c,
      artists: db.prepare("SELECT COUNT(*) AS c FROM artists").get().c,
      songs: db.prepare("SELECT COUNT(*) AS c FROM songs").get().c,
      tabs: db.prepare("SELECT COUNT(*) AS c FROM tabs").get().c,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

app.get("/api/chords/qualities", (_req, res) => {
  res.json(db.prepare(`SELECT DISTINCT quality FROM chords ORDER BY id`).all().map((r) => r.quality));
});

app.get("/api/chords", (req, res) => {
  const { q, quality } = req.query;
  let sql = `SELECT id, root, quality, name, notes, base_fret, frets FROM chords WHERE 1=1`;
  const params = [];
  if (quality) {
    sql += ` AND quality = ?`;
    params.push(String(quality));
  }
  if (q) {
    sql += ` AND (name LIKE ? OR notes LIKE ?)`;
    params.push(`%${q}%`, `%${q}%`);
  }
  sql += ` ORDER BY id`;
  res.json(db.prepare(sql).all(...params));
});

app.listen(PORT, () => {
  console.log(`Tabs API listening on http://localhost:${PORT}`);
});
