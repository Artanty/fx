const express = require("express");
const Database = require("better-sqlite3");
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

let midi = null;
try {
  midi = require("midi");
} catch (e) {
  midi = null;
}

const PORT = process.env.PORT || 3000;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, "presets.db");
const ROOT_DIR = __dirname;

const db = new Database(DB_PATH, { readonly: true });

const app = express();
app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const SORTS = {
  downloads: "p.download_count DESC",
  views: "p.view_count DESC",
  likes: "p.like_count DESC",
  updated: "p.updated_at DESC",
  created: "p.created_at DESC",
  title: "p.title ASC",
};

function splitList(value) {
  if (!value) return [];
  return String(value).split(",").map((s) => s.trim()).filter(Boolean);
}

function buildQuery(q) {
  const where = [];
  const params = [];

  const families = splitList(q.family);
  if (families.length) {
    where.push(`f.effect_family IN (${families.map(() => "?").join(",")})`);
    params.push(...families);
  }
  const algorithms = splitList(q.algorithm);
  if (algorithms.length) {
    where.push(`f.algorithm IN (${algorithms.map(() => "?").join(",")})`);
    params.push(...algorithms);
  }
  const categories = splitList(q.category);
  if (categories.length) {
    where.push(`EXISTS (
      SELECT 1 FROM patch_categories pc JOIN categories c ON c.id = pc.category_id
      WHERE pc.patch_id = p.id AND c.slug IN (${categories.map(() => "?").join(",")}))`);
    params.push(...categories);
  }
  const tags = splitList(q.tag);
  if (tags.length) {
    where.push(`EXISTS (
      SELECT 1 FROM patch_tags pt JOIN tags t ON t.id = pt.tag_id
      WHERE pt.patch_id = p.id AND t.slug IN (${tags.map(() => "?").join(",")}))`);
    params.push(...tags);
  }
  const extensions = splitList(q.ext);
  if (extensions.length) {
    where.push(`f.extension IN (${extensions.map(() => "?").join(",")})`);
    params.push(...extensions);
  }
  if (q.q) {
    where.push(`(p.title LIKE ? OR f.preset_name LIKE ? OR f.algorithm LIKE ? OR p.author LIKE ?)`);
    const like = `%${q.q}%`;
    params.push(like, like, like, like);
  }
  return { where, params };
}

const COLUMNS = `
  f.id AS file_id, p.id AS patch_id, p.slug, p.title, p.url, p.author, p.revision,
  p.updated_at, p.download_count, p.view_count, p.like_count, p.license, p.artwork_url,
  f.filename, f.extension, f.preset_name, f.algorithm, f.secondary_algorithm,
  f.effect_family, f.path, f.filesize, f.notes,
  (SELECT GROUP_CONCAT(c.name, '|') FROM patch_categories pc
     JOIN categories c ON c.id = pc.category_id WHERE pc.patch_id = p.id) AS categories,
  (SELECT GROUP_CONCAT(t.name, '|') FROM patch_tags pt
     JOIN tags t ON t.id = pt.tag_id WHERE pt.patch_id = p.id) AS tags`;

app.get("/api/patches", (req, res) => {
  try {
    const { where, params } = buildQuery(req.query);
    const whereSql = where.length ? "WHERE " + where.join(" AND ") : "";
    const sort = SORTS[req.query.sort] || SORTS.downloads;

    let countSql = `SELECT COUNT(*) AS total FROM files f JOIN patches p ON p.id = f.patch_id ${whereSql}`;
    const total = db.prepare(countSql).get(...params).total;

    const perPage = Math.min(parseInt(req.query.per_page, 10) || 24, 100);
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);

    let sql = `SELECT ${COLUMNS} FROM files f JOIN patches p ON p.id = f.patch_id ${whereSql}
               ORDER BY ${sort} LIMIT ? OFFSET ?`;
    const values = [...params, perPage, (page - 1) * perPage];
    const rows = db.prepare(sql).all(...values).map((r) => ({
      ...r,
      categories: r.categories ? r.categories.split("|") : [],
      tags: r.tags ? r.tags.split("|") : [],
    }));

    res.json({
      total,
      page,
      per_page: perPage,
      pages: Math.ceil(total / perPage),
      items: rows,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/filters", (req, res) => {
  const families = db.prepare(
    `SELECT effect_family AS name, COUNT(*) AS count FROM files
     WHERE effect_family IS NOT NULL GROUP BY effect_family ORDER BY count DESC`
  ).all();
  const algorithms = db.prepare(
    `SELECT algorithm AS name, COUNT(*) AS count FROM files
     WHERE algorithm IS NOT NULL GROUP BY algorithm ORDER BY count DESC`
  ).all();
  const categories = db.prepare(
    `SELECT c.slug, c.name, COUNT(pc.patch_id) AS count FROM categories c
     LEFT JOIN patch_categories pc ON pc.category_id = c.id
     GROUP BY c.id HAVING count > 0 ORDER BY count DESC`
  ).all();
  const tags = db.prepare(
    `SELECT t.slug, t.name, COUNT(pt.patch_id) AS count FROM tags t
     LEFT JOIN patch_tags pt ON pt.tag_id = t.id
     GROUP BY t.id HAVING count > 0 ORDER BY count DESC`
  ).all();
  const extensions = db.prepare(
    `SELECT extension AS name, COUNT(*) AS count FROM files GROUP BY extension ORDER BY count DESC`
  ).all();
  res.json({ families, algorithms, categories, tags, extensions });
});

app.get("/api/patches/:slug", (req, res) => {
  try {
    const row = db.prepare(`
      SELECT p.id, p.slug, p.title, p.url, p.excerpt, p.content, p.revision, p.author,
             p.created_at, p.updated_at, p.view_count, p.like_count, p.download_count,
             p.comment_count, p.license, p.artwork_url,
             f.id AS file_id, f.filename, f.extension, f.preset_name, f.algorithm,
             f.secondary_algorithm, f.effect_family, f.path, f.filesize, f.notes,
             (SELECT GROUP_CONCAT(c.name, '|') FROM patch_categories pc
                JOIN categories c ON c.id = pc.category_id WHERE pc.patch_id = p.id) AS categories,
             (SELECT GROUP_CONCAT(t.name, '|') FROM patch_tags pt
                JOIN tags t ON t.id = pt.tag_id WHERE pt.patch_id = p.id) AS tags,
             (SELECT GROUP_CONCAT(t.slug, '|') FROM patch_tags pt
                JOIN tags t ON t.id = pt.tag_id WHERE pt.patch_id = p.id) AS tag_slugs
      FROM patches p
      LEFT JOIN files f ON f.patch_id = p.id
      WHERE p.slug = ?
      ORDER BY f.id LIMIT 1`).get(req.params.slug);
    if (!row) return res.status(404).json({ error: "patch not found" });
    res.json({
      ...row,
      categories: row.categories ? row.categories.split("|") : [],
      tags: row.tags ? row.tags.split("|") : [],
      tag_slugs: row.tag_slugs ? row.tag_slugs.split("|") : [],
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/files/:id/download", (req, res) => {
  try {
    const row = db.prepare("SELECT path, filename FROM files WHERE id = ?").get(req.params.id);
    if (!row || !row.path) return res.status(404).json({ error: "file not found" });
    const full = path.join(ROOT_DIR, row.path);
    if (!fs.existsSync(full)) return res.status(404).json({ error: "file missing on disk" });
    res.download(full, row.filename);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

function h90Outputs() {
  if (!midi) return [];
  const out = new midi.Output();
  const ports = [];
  for (let i = 0; i < out.getPortCount(); i++) {
    ports.push({ index: i, name: out.getPortName(i) });
  }
  return ports;
}

const H90_NAME_RE = /XC-05987|Eventide|H90/;

app.get("/api/h90/ports", (_req, res) => {
  try {
    res.json({ available: !!midi, outputs: h90Outputs() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/h90/preset", (req, res) => {
  try {
    if (!midi) return res.status(500).json({ error: "midi library not available" });
    const program = parseInt(req.body.program, 10);
    const channel = parseInt(req.body.channel, 10) || 1;
    const rawPort = req.body.port;
    const portIndex =
      rawPort === undefined || rawPort === null || rawPort === "" ? null : parseInt(rawPort, 10);
    if (!Number.isInteger(program) || program < 1 || program > 100) {
      return res.status(400).json({ error: "program must be an integer 1-100" });
    }
    if (channel < 1 || channel > 16) {
      return res.status(400).json({ error: "channel must be an integer 1-16" });
    }
    const pcOffset = !!req.body.pc_offset;

    const outputs = h90Outputs();
    let index = portIndex;
    if (index === null) {
      index = outputs.findIndex((p) => H90_NAME_RE.test(p.name));
    }
    if (index < 0 || index >= outputs.length) {
      return res.status(404).json({ error: "no H90 MIDI output found", outputs });
    }

    const out = new midi.Output();
    out.openPort(index);
    const pcByte = pcOffset ? program : program - 1;
    const msg = [0xc0 + (channel - 1), pcByte & 0x7f];
    out.sendMessage(msg);
    setTimeout(() => {
      try { out.closePort(); } catch (e) {}
    }, 200);

    res.json({ ok: true, port: outputs[index], channel, program, pc_offset: pcOffset, bytes: msg });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/health", (_req, res) => res.json({ ok: true }));

const SX_DIR = path.join(__dirname, "sikulix");
const SX_JRE = path.join(SX_DIR, "jre", "bin", "java.exe");
const SX_JAR = path.join(SX_DIR, "sikulixide-2.0.5-win.jar");
const KNOB_PROJECT = path.join(SX_DIR, "projects", "knob-driver.sikuli");
const KNOB_SCRIPT = path.join(KNOB_PROJECT, "knob-driver.py");
const KNOB_RE = /^KNOB: (.+?) @ \d+,\d+,\d+,\d+$/;

let sikulixBusy = false;

function sikulixAvailable() {
  return fs.existsSync(SX_JRE) && fs.existsSync(SX_JAR) && fs.existsSync(KNOB_SCRIPT);
}

function runSikulix(args, timeoutMs) {
  return new Promise((resolve) => {
    const child = spawn(
      SX_JRE,
      ["-Xms256m", "-Xmx1024m", "-XX:+UseG1GC", "-jar", SX_JAR, "-r", KNOB_PROJECT, "--", ...args],
      { cwd: SX_DIR, windowsHide: true }
    );
    let out = "";
    let err = "";
    let timer = null;
    const finish = (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, out, err });
    };
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("close", finish);
    child.on("error", (e) => {
      err += e.message;
      finish(-1);
    });
    timer = setTimeout(() => {
      try { child.kill(); } catch (e) {}
      err += " (timed out)";
      finish(-2);
    }, timeoutMs || 90000);
  });
}

app.post("/api/h90/knob/scan", async (_req, res) => {
  try {
    if (!sikulixAvailable()) {
      return res.status(503).json({
        error:
          "SikuliX runtime not set up here (needs the visible desktop running H90 Control). Run back/h90/sikulix/setup.ps1.",
      });
    }
    if (sikulixBusy) return res.status(409).json({ error: "another knob action is still running" });
    sikulixBusy = true;
    try {
      const r = await runSikulix(["--scan"]);
      const knobs = r.out
        .split(/\r?\n/)
        .filter((l) => l.startsWith("KNOB: "))
        .map((l) => {
          const m = KNOB_RE.exec(l);
          return m ? m[1] : l;
        })
        .filter((v, i, arr) => arr.indexOf(v) === i);
      res.json({ ok: r.code === 0, knobs, log: r.out });
    } finally {
      sikulixBusy = false;
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/h90/knob", async (req, res) => {
  try {
    if (!sikulixAvailable()) {
      return res.status(503).json({
        error:
          "SikuliX runtime not set up here (needs the visible desktop running H90 Control). Run back/h90/sikulix/setup.ps1.",
      });
    }
    const body = req.body || {};
    const preset = typeof body.preset === "string" && body.preset.trim() ? String(body.preset).trim() : null;
    const dy = Number.isInteger(body.dy) ? body.dy : null;
    const above = Number.isInteger(body.above) ? body.above : null;
    const knobs = Array.isArray(body.knobs) ? body.knobs : [];
    if (!knobs.length) {
      return res.status(400).json({ error: "knobs must be a non-empty array of { name, turns }" });
    }
    const cleaned = knobs.map((k, i) => {
      if (!k || typeof k.name !== "string" || !k.name.trim()) {
        throw new Error("knobs[" + i + "].name must be a non-empty string");
      }
      const turns = Number.isInteger(k.turns) ? k.turns : 0;
      if (turns === 0) throw new Error("knobs[" + i + "].turns must be a non-zero integer");
      return { name: k.name.trim(), turns };
    });

    if (sikulixBusy) return res.status(409).json({ error: "another knob action is still running" });
    sikulixBusy = true;
    try {
      const args = [];
      if (preset) args.push("--preset", preset);
      if (dy !== null) args.push("--dy", String(dy));
      if (above !== null) args.push("--above", String(above));
      for (const k of cleaned) args.push("--knob", k.name, "--turns", String(k.turns));
      const r = await runSikulix(args);
      res.json({ ok: r.code === 0, code: r.code, log: r.out, stderr: r.err });
    } finally {
      sikulixBusy = false;
    }
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`H90 API listening on http://localhost:${PORT}`);
});
