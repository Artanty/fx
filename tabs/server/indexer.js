const { importer, Settings } = require("@coderline/alphatab");

const ScoreLoader = importer.ScoreLoader;

function detectGpVersion(bytes) {
  const head = Buffer.from(bytes.slice(0, 80)).toString("latin1");
  const m = /FICHIER GUITAR PRO v(\d+\.\d+)/i.exec(head);
  if (m) return "gp" + m[1];
  if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
    const zipName = /[ -~]*(?:\.gpx|\.gp)[ -~]*/.exec(head);
    return zipName && zipName[0] ? "gp6+" : "gp7/8";
  }
  return null;
}

function parseScore(bytes) {
  return ScoreLoader.loadScoreFromBytes(new Uint8Array(bytes), new Settings());
}

function extractMetadata(bytes) {
  const score = parseScore(bytes);
  const tracks = score.tracks.map((t) => {
    const staves = t.staves || [];
    const tunings = staves
      .filter((s) => !s.isPercussion)
      .map((s) => (s.tuning ? Array.from(s.tuning) : []));
    const capo = staves.length ? staves[0].capo || 0 : 0;
    return {
      name: t.name,
      shortName: t.shortName,
      program: t.playbackInfo ? t.playbackInfo.program : undefined,
      isPercussion: staves.some((s) => s.isPercussion),
      tunings,
      capo,
    };
  });
  const mb = score.masterBars || [];
  const tempo =
    mb[0] && mb[0].tempoAutomations && mb[0].tempoAutomations.length
      ? mb[0].tempoAutomations[0].value
      : score.tempo;
  return {
    title: score.title || null,
    artist: score.artist || null,
    album: score.album || null,
    tempo: tempo || null,
    measures: mb.length,
    tracks,
    capo: tracks.length ? Math.max(...tracks.map((t) => t.capo)) : 0,
  };
}

function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function upsertArtist(db, name) {
  const clean = String(name || "Unknown Artist").trim();
  const slug = slugify(clean) || "unknown-artist";
  db.prepare("INSERT OR IGNORE INTO artists (name, slug) VALUES (?, ?)").run(clean, slug);
  return db.prepare("SELECT id FROM artists WHERE slug = ?").get(slug).id;
}

function upsertSong(db, artistId, title) {
  const clean = String(title || "Untitled").trim();
  db.prepare(
    "INSERT OR IGNORE INTO songs (artist_id, title) VALUES (?, ?)"
  ).run(artistId, clean);
  return db.prepare(
    "SELECT id FROM songs WHERE artist_id = ? AND title = ?"
  ).get(artistId, clean).id;
}

function indexFile(db, fileRow, bytes) {
  const meta = extractMetadata(bytes);
  const artistId = upsertArtist(db, meta.artist);
  const songId = upsertSong(db, artistId, meta.title);

  db.prepare(
    `INSERT OR IGNORE INTO tabs
      (file_id, song_id, title, album, tempo, gp_version, measures, capo, tunings, tracks)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    fileRow.id,
    songId,
    meta.title,
    meta.album,
    meta.tempo,
    detectGpVersion(bytes),
    meta.measures,
    meta.capo,
    JSON.stringify(meta.tracks.map((t) => t.tunings)),
    JSON.stringify(meta.tracks)
  );

  db.prepare(
    `INSERT INTO tabs_fts (rowid, title, artist, album) VALUES (?, ?, ?, ?)`
  ).run(
    db.prepare("SELECT id FROM tabs WHERE file_id = ?").get(fileRow.id).id,
    meta.title || "",
    meta.artist || "",
    meta.album || ""
  );

  db.prepare("UPDATE files SET status = 'indexed', error = NULL WHERE id = ?").run(fileRow.id);
  return { tabId: db.prepare("SELECT id FROM tabs WHERE file_id = ?").get(fileRow.id).id, meta };
}

module.exports = { extractMetadata, detectGpVersion, indexFile, upsertArtist, upsertSong, slugify, parseScore };
