import base64
import html
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from collections import Counter

BASE = "https://patchstorage.com/api/beta"
PLATFORM = "8271"
ROOT = os.path.dirname(os.path.abspath(__file__))
PATCHDIR = os.path.join(ROOT, "patchstorage")
DB_PATH = os.path.join(ROOT, "presets.db")
CACHE_PATH = os.path.join(ROOT, "api_cache.json")

ALGORITHM_FAMILIES = {
    "Band Delay": "Delay", "Digital Delay": "Delay", "Ducked Delay": "Delay",
    "Filter Pong": "Delay", "Mod Delay": "Delay", "MultiTap": "Delay",
    "Tape Echo": "Delay", "UltraTap": "Delay", "Vintage Delay": "Delay",
    "ModEchoVerb": "Delay+Reverb", "SpaceTime": "Delay+Reverb",
    "Reverse": "Reverse",
    "Blackhole": "Reverb", "DynaVerb": "Reverb", "Hall": "Reverb",
    "MangledVerb": "Reverb", "Plate": "Reverb", "Resonator": "Reverb",
    "Reverse Reverb": "Reverb", "Room": "Reverb", "Shimmer": "Reverb",
    "Spring": "Reverb", "DualVerb": "Reverb",
    "TremoloVerb": "Tremolo+Reverb",
    "TremoloPan": "Tremolo/Pan",
    "Chorus": "Modulation", "Flanger": "Modulation", "Phaser": "Modulation",
    "RingMod": "Modulation", "Rotary": "Modulation", "TriceraChorus": "Modulation",
    "Undulator": "Modulation", "Vibrato": "Modulation",
    "Crystals": "Pitch", "Diatonic": "Pitch", "H910 H949": "Pitch",
    "HarModulator": "Pitch", "Harmadillo": "Pitch", "MicroPitch": "Pitch",
    "Octaver": "Pitch", "Quadravox": "Pitch",
    "HarPeggiator": "Pitch/Seq",
    "PitchFlex": "Pitch",
    "PitchFuzz": "Distortion+Pitch",
    "CrushStation": "Distortion", "Sculpt": "Distortion",
    "EQ Compressor": "EQ/Comp",
    "ModFilter": "Filter", "Q-Wah": "Filter",
    "HotSawz": "Synth", "HeadSpace": "Synth", "PolySynth": "Synth", "Synthonizer": "Synth",
    "Looper": "Looper",
}

B64 = set(b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
UUID_RE = re.compile(rb"^[0-9a-fA-F]{8}-[0-9a-fA-F-]{20,36}$")


def get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8")), r.headers


def extract_json_blobs(data):
    """Return list of dicts from all embedded base64 JSON blobs."""
    blobs = []
    i = 0
    while True:
        s = data.find(b"eyJ", i)
        if s < 0:
            break
        seg = data[s:s + 200000]
        j = 0
        while j < len(seg) and seg[j] in B64:
            j += 1
        try:
            dec = base64.b64decode(seg[:j])
            obj = json.loads(dec)
            if isinstance(obj, dict):
                blobs.append(obj)
        except Exception:
            pass
        i = s + 1
    return blobs


def extract_notes(data):
    """Pull human-readable program notes out of the raw bytes."""
    strings = re.findall(rb"[\x20-\x7e]{6,}", data)
    notes = []
    for s in strings:
        if s.startswith(b"eyJ"):          # base64 JSON blob
            continue
        if len(s) > 150 and re.fullmatch(rb"[A-Za-z0-9+/=]+", s):  # long b64
            continue
        if UUID_RE.match(s):              # uuid
            continue
        if s.endswith(b"-obj"):           # internal param name
            continue
        if s.startswith(b"tjknobs"):      # knob binding
            continue
        t = s.decode("ascii", "ignore").strip()
        if len(t) < 4:
            continue
        if not (t[0].isalpha() or t[0].isdigit()):
            continue
        if " " not in t and len(t) <= 20:
            continue
        notes.append(t)
    seen = set()
    out = []
    for n in notes:
        if n not in seen:
            seen.add(n)
            out.append(n)
    return "\n".join(out)


VALID_EXT = {"pgm90", "preset90", "lst90", "zip"}


def scan_files():
    files = {}
    for dirpath, _dirs, names in os.walk(PATCHDIR):
        for name in names:
            full = os.path.join(dirpath, name)
            if not os.path.isfile(full):
                continue
            ext = name.rsplit(".", 1)[-1].lower()
            if ext not in VALID_EXT:
                continue
            rel = os.path.relpath(full, ROOT)
            data = open(full, "rb").read()
            blobs = extract_json_blobs(data)
            algs = [b.get("algorithm_name") for b in blobs if b.get("algorithm_name")]
            preset_names = [b.get("preset_name") for b in blobs if b.get("preset_name")]
            files[name] = {
                "filename": name,
                "extension": ext,
                "path": rel,
                "filesize": len(data),
                "algorithms": algs,
                "json_blobs": blobs,
                "preset_name": preset_names[0] if preset_names else None,
                "notes": "" if ext == "zip" else extract_notes(data),
            }
    return files


def fetch_api():
    if os.path.exists(CACHE_PATH):
        return json.load(open(CACHE_PATH))

    patches = []
    page, total_pages = 1, None
    while True:
        url = f"{BASE}/patches/?platforms={PLATFORM}&per_page=100&page={page}"
        data, headers = get_json(url)
        total_pages = int(headers.get("X-WP-TotalPages"))
        if not data:
            break
        patches.extend(data)
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.15)

    out = []
    for i, p in enumerate(patches):
        for attempt in range(4):
            try:
                detail, _ = get_json(f"{BASE}/patches/{p['id']}")
                break
            except Exception:
                if attempt == 3:
                    print(f"  [FAIL] detail {p['id']} ({p['slug']})")
                    detail = None
                else:
                    time.sleep(3)
        if detail is None:
            continue
        out.append(detail)
        if (i + 1) % 50 == 0:
            print(f"  fetched {i + 1}/{len(patches)}")
        time.sleep(0.1)

    json.dump(out, open(CACHE_PATH, "w"))
    return out


def build():
    print("scanning local files...")
    local_files = scan_files()
    print(f"  {len(local_files)} files")

    print("fetching patchstorage metadata...")
    patches = fetch_api()
    print(f"  {len(patches)} patches")

    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.executescript("""
    PRAGMA foreign_keys = ON;

    CREATE TABLE patches (
        id INTEGER PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        url TEXT,
        excerpt TEXT,
        content TEXT,
        revision TEXT,
        author TEXT,
        created_at TEXT,
        updated_at TEXT,
        view_count INTEGER DEFAULT 0,
        like_count INTEGER DEFAULT 0,
        download_count INTEGER DEFAULT 0,
        comment_count INTEGER DEFAULT 0,
        license TEXT,
        artwork_url TEXT
    );
    CREATE TABLE files (
        id INTEGER PRIMARY KEY,
        patch_id INTEGER REFERENCES patches(id) ON DELETE CASCADE,
        filename TEXT UNIQUE NOT NULL,
        extension TEXT NOT NULL,
        path TEXT,
        filesize INTEGER,
        preset_name TEXT,
        algorithm TEXT,
        secondary_algorithm TEXT,
        effect_family TEXT,
        notes TEXT
    );
    CREATE TABLE algorithms (
        name TEXT PRIMARY KEY,
        family TEXT NOT NULL
    );
    CREATE TABLE file_algorithms (
        file_id INTEGER REFERENCES files(id) ON DELETE CASCADE,
        position INTEGER NOT NULL,
        algorithm TEXT NOT NULL,
        preset_name TEXT
    );
    CREATE TABLE tags (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        slug TEXT UNIQUE NOT NULL
    );
    CREATE TABLE patch_tags (
        patch_id INTEGER REFERENCES patches(id) ON DELETE CASCADE,
        tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (patch_id, tag_id)
    );
    CREATE TABLE categories (
        id INTEGER PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        slug TEXT UNIQUE NOT NULL
    );
    CREATE TABLE patch_categories (
        patch_id INTEGER REFERENCES patches(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES categories(id) ON DELETE CASCADE,
        PRIMARY KEY (patch_id, category_id)
    );
    CREATE INDEX idx_files_algorithm ON files(algorithm);
    CREATE INDEX idx_files_family ON files(effect_family);
    CREATE INDEX idx_file_algorithms ON file_algorithms(algorithm);
    CREATE INDEX idx_files_patch ON files(patch_id);
    """)

    for name, family in sorted(ALGORITHM_FAMILIES.items()):
        cur.execute("INSERT OR IGNORE INTO algorithms (name, family) VALUES (?, ?)", (name, family))

    tag_ids, cat_ids = {}, {}
    patch_count = 0
    for p in patches:
        slug = p["slug"]
        if slug in tag_ids or slug in cat_ids:
            continue
        author = p.get("author") or {}
        lic = p.get("license") or {}
        art = p.get("artwork") or {}
        cur.execute("""
            INSERT INTO patches (id, slug, title, url, excerpt, content, revision, author,
                                 created_at, updated_at, view_count, like_count,
                                 download_count, comment_count, license, artwork_url)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        """, (p["id"], slug, html.unescape(p["title"]), p.get("url"),
              html.unescape(p.get("excerpt") or ""), html.unescape(p.get("content") or ""),
              p.get("revision"), author.get("name"), p.get("created_at"), p.get("updated_at"),
              p.get("view_count", 0), p.get("like_count", 0), p.get("download_count", 0),
              p.get("comment_count", 0), lic.get("name"), art.get("url")))
        patch_count += 1

        for t in p.get("tags") or []:
            if t["id"] not in tag_ids:
                cur.execute("INSERT INTO tags (id, name, slug) VALUES (?,?,?)", (t["id"], t["name"], t["slug"]))
                tag_ids[t["id"]] = t["id"]
            cur.execute("INSERT OR IGNORE INTO patch_tags (patch_id, tag_id) VALUES (?,?)", (p["id"], t["id"]))
        for c in p.get("categories") or []:
            if c["id"] not in cat_ids:
                cur.execute("INSERT INTO categories (id, name, slug) VALUES (?,?,?)", (c["id"], c["name"], c["slug"]))
                cat_ids[c["id"]] = c["id"]
            cur.execute("INSERT OR IGNORE INTO patch_categories (patch_id, category_id) VALUES (?,?)", (p["id"], c["id"]))

    file_count = 0
    matched = 0
    unknown_algs = Counter()
    for p in patches:
        for f in p.get("files") or []:
            fname = f["filename"]
            local = local_files.get(fname)
            cur.execute("INSERT INTO files (patch_id, filename, extension, path, filesize, preset_name, notes) "
                        "VALUES (?,?,?,?,?,?,?)",
                        (p["id"], fname, fname.rsplit(".", 1)[-1].lower(), None,
                         f.get("filesize"), None, None))
            file_id = cur.lastrowid
            if local:
                matched += 1
                cur.execute("UPDATE files SET path=?, filesize=?, preset_name=?, notes=? WHERE id=?",
                            (local["path"], local["filesize"], local["preset_name"], local["notes"], file_id))
                algs = local["algorithms"]
                if algs:
                    primary = algs[0]
                    family = ALGORITHM_FAMILIES.get(primary)
                    if family is None:
                        unknown_algs[primary] += 1
                        cur.execute("INSERT OR IGNORE INTO algorithms (name, family) VALUES (?, 'Unknown')", (primary,))
                    secondary = algs[1] if len(algs) > 1 else None
                    cur.execute("UPDATE files SET algorithm=?, secondary_algorithm=?, effect_family=? WHERE id=?",
                                (primary, secondary, family, file_id))
                    blobs = local.get("json_blobs", [])
                    for pos, alg in enumerate(algs):
                        pname = None
                        for b in local.get("json_blobs", []):
                            if b.get("algorithm_name") == alg:
                                pname = b.get("preset_name")
                                break
                        cur.execute("INSERT INTO file_algorithms (file_id, position, algorithm, preset_name) "
                                    "VALUES (?,?,?,?)", (file_id, pos, alg, pname))
            file_count += 1

    con.commit()

    print("\nsummary:")
    print(f"  patches: {patch_count}")
    print(f"  files:   {file_count} (local matched: {matched})")
    print(f"  files with algorithm: {cur.execute('SELECT COUNT(*) FROM files WHERE algorithm IS NOT NULL').fetchone()[0]}")
    print(f"  files with notes:     {cur.execute('SELECT COUNT(*) FROM files WHERE notes IS NOT NULL AND notes != \"\"').fetchone()[0]}")
    if unknown_algs:
        print(f"  unknown algorithms: {dict(unknown_algs)}")
    con.close()


if __name__ == "__main__":
    build()
