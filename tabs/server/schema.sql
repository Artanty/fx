PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  artist_id INTEGER NOT NULL REFERENCES artists(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  UNIQUE (artist_id, title)
);

CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  sha256 TEXT NOT NULL UNIQUE,
  filename TEXT NOT NULL,
  ext TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS tabs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL UNIQUE REFERENCES files(id) ON DELETE CASCADE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  title TEXT,
  album TEXT,
  tempo INTEGER,
  gp_version TEXT,
  measures INTEGER,
  capo INTEGER,
  tunings TEXT,
  tracks TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tabs_song ON tabs(song_id);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

CREATE TABLE IF NOT EXISTS ug_tabs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ug_id INTEGER NOT NULL UNIQUE,
  song_id INTEGER NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  title TEXT,
  ug_type TEXT NOT NULL,
  rating REAL,
  votes INTEGER,
  version INTEGER,
  difficulty TEXT,
  url TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ug_tabs_song ON ug_tabs(song_id);

CREATE VIRTUAL TABLE IF NOT EXISTS tabs_fts USING fts5(
  title, artist, album,
  content = ''
);
