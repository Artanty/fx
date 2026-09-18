import argparse
import json
import os
import sqlite3
import sys
import time
import urllib.request

ROOT = os.path.dirname(os.path.abspath(__file__))
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

import build_db

PATCHDIR = build_db.PATCHDIR
DB_PATH = build_db.DB_PATH
CACHE_PATH = build_db.CACHE_PATH
UA = {"User-Agent": "Mozilla/5.0"}

VALID_EXT = build_db.VALID_EXT


def file_url_map(cache):
    """filename -> {url, filesize} for every patchstorage file entry."""
    out = {}
    for p in cache:
        for f in p.get("files") or []:
            fname = f.get("filename")
            if not fname:
                continue
            ext = fname.rsplit(".", 1)[-1].lower() if "." in fname else ""
            if ext not in VALID_EXT:
                continue
            out[fname] = {"url": f.get("url"), "filesize": f.get("filesize")}
    return out


def download(url, dest, log=print):
    """Stream url to dest via dest.part then rename. Raises on HTTP error."""
    part = dest + ".part"
    req = urllib.request.Request(url, headers=UA)
    did_print = False
    with urllib.request.urlopen(req, timeout=120) as r:
        with open(part, "wb") as fh:
            while True:
                chunk = r.read(65536)
                if not chunk:
                    break
                fh.write(chunk)
    os.replace(part, dest)
    log(f"  saved {os.path.basename(dest)} ({os.path.getsize(dest)} B)")


def update_row(con, filename, relpath):
    """Scan one binary file and UPdate the matching files row in place."""
    full = os.path.join(ROOT, relpath)
    data = open(full, "rb").read()
    blobs = build_db.extract_json_blobs(data)
    algs = [b.get("algorithm_name") for b in blobs if b.get("algorithm_name")]
    preset_names = [b.get("preset_name") for b in blobs if b.get("preset_name")]
    ext = filename.rsplit(".", 1)[-1].lower()
    notes = "" if ext == "zip" else build_db.extract_notes(data)

    primary = algs[0] if algs else None
    secondary = algs[1] if len(algs) > 1 else None
    family = None
    if primary:
        family = build_db.ALGORITHM_FAMILIES.get(primary)
        if family is None:
            family = "Unknown"

    cur = con.cursor()
    row = cur.execute("SELECT id FROM files WHERE filename = ?", (filename,)).fetchone()
    if row is None:
        return False
    file_id = row[0]
    cur.execute(
        "UPDATE files SET path=?, filesize=?, preset_name=?, algorithm=?, "
        "secondary_algorithm=?, effect_family=?, notes=? WHERE id=?",
        (relpath, len(data), preset_names[0] if preset_names else None,
         primary, secondary, family, notes, file_id),
    )
    cur.execute("DELETE FROM file_algorithms WHERE file_id = ?", (file_id,))
    for pos, alg in enumerate(algs):
        pname = None
        for b in blobs:
            if b.get("algorithm_name") == alg:
                pname = b.get("preset_name")
                break
        cur.execute(
            "INSERT INTO file_algorithms (file_id, position, algorithm, preset_name) "
            "VALUES (?,?,?,?)",
            (file_id, pos, alg, pname),
        )
    return True


def ensure_cache(log=print):
    if os.path.exists(CACHE_PATH):
        return json.load(open(CACHE_PATH))
    log("cache missing, fetching patchstorage metadata...")
    return build_db.fetch_api()


def fetch_one(filename, log=print):
    cache = ensure_cache(log)
    meta = file_url_map(cache).get(filename)
    if not meta:
        raise RuntimeError(f"no patchstorage file entry for {filename!r}")
    if not meta.get("url"):
        raise RuntimeError(f"file entry for {filename!r} has no download URL")
    os.makedirs(PATCHDIR, exist_ok=True)
    rel = os.path.join("patchstorage", filename)
    full = os.path.join(ROOT, rel)
    if not os.path.exists(full):
        download(meta["url"], full, log)
    else:
        log(f"  already present: {filename}")
    # populate the DB row (re-open writable on each call so the server's
    # read-only handle and long-lived transactions are not disturbed)
    os.makedirs(os.path.dirname(DB_PATH), exist_ok=True)
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.execute("PRAGMA busy_timeout = 60000")
    try:
        updated = update_row(con, filename, rel)
        con.commit()
    finally:
        con.close()
    if not updated:
        log(f"  (no files row for {filename!r} - downloaded but not matched)")
    return rel


def fetch_all(log=print, limit=None):
    cache = ensure_cache(log)
    mapping = file_url_map(cache)
    log(f"patchstorage file entries: {len(mapping)}")
    os.makedirs(PATCHDIR, exist_ok=True)
    total = len(mapping)
    if limit is not None:
        mapping = dict(list(mapping.items())[:limit])
    fetched = skipped = failed = 0
    con = sqlite3.connect(DB_PATH, timeout=60)
    con.execute("PRAGMA busy_timeout = 60000")
    try:
        for i, (filename, meta) in enumerate(mapping.items(), 1):
            rel = os.path.join("patchstorage", filename)
            full = os.path.join(ROOT, rel)
            if not meta.get("url"):
                failed += 1
                log(f"[{i}/{total}] {filename}: no URL")
                continue
            try:
                if not os.path.exists(full):
                    download(meta["url"], full, log)
                    fetched += 1
                else:
                    skipped += 1
                if update_row(con, filename, os.path.relpath(full, ROOT)):
                    updated = True
                con.commit()
            except Exception as e:
                failed += 1
                log(f"[{i}/{total}] {filename}: ERROR {e}")
            if i % 25 == 0:
                log(f"  ... {i}/{total}")
            time.sleep(0.1)
    finally:
        con.close()
    log(f"done: fetched={fetched} skipped={skipped} failed={failed}")


def main(argv=None):
    ap = argparse.ArgumentParser(description="Download H90 presets from patchstorage and fill presets.db")
    ap.add_argument("--only", help="download only this filename (lazy single-file fetch)")
    ap.add_argument("--limit", type=int, help="fetch at most N files (test mode)")
    args = ap.parse_args(argv)
    if args.only:
        rel = fetch_one(args.only)
        print(f"OK {rel}")
    else:
        fetch_all(limit=args.limit)
    return 0


if __name__ == "__main__":
    sys.exit(main())