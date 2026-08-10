const express = require("express");
const { DatabaseSync } = require("node:sqlite");
const multer = require("multer");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { indexFile } = require("./indexer");
const { renderTextTab } = require("./textTab");

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
      `SELECT s.id, s.title, COUNT(t.id) AS tab_count,
              MIN(t.tempo) AS tempo
       FROM songs s
       LEFT JOIN tabs t ON t.song_id = s.id
       WHERE s.artist_id = ?
       GROUP BY s.id
       ORDER BY s.title COLLATE NOCASE`
    ).all(req.params.id);
    console.log(`[artist-songs] id=${req.params.id} artist=${JSON.stringify(artist)} -> ${songs.length} songs`);
    res.json({ artist, items: songs });
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
              f.ext, f.size
       FROM tabs t
       JOIN files f ON f.id = t.file_id
       WHERE t.song_id = ?
       ORDER BY t.title COLLATE NOCASE`
    ).all(req.params.id).map((r) => ({
      ...r,
      tunings: r.tunings ? JSON.parse(r.tunings) : [],
      tracks: r.tracks ? JSON.parse(r.tracks) : [],
    }));
    res.json({ song, items: tabs });
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
    res.json({
      ...row,
      tunings: row.tunings ? JSON.parse(row.tunings) : [],
      tracks: row.tracks ? JSON.parse(row.tracks) : [],
    });
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
    res.json({ items: rows });
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
    const pending = db.prepare("SELECT * FROM files WHERE status = 'pending' LIMIT ?").all(batch);
    let ok = 0;
    let failed = 0;
    const errors = [];
    for (const fileRow of pending) {
      try {
        const full = path.join(ROOT_DIR, fileRow.path);
        if (!fs.existsSync(full)) throw new Error("file missing on disk");
        indexFile(db, fileRow, fs.readFileSync(full));
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

app.listen(PORT, () => {
  console.log(`Tabs API listening on http://localhost:${PORT}`);
});
