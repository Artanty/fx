#!/usr/bin/env python3
"""Build midi_cc_map.db from the per-effect JSON state files."""

import json
import os
import sqlite3

ROOT = os.path.dirname(__file__)
LEGACY = os.path.join(ROOT, "midi_cc_state.json")
STATES_DIR = os.path.join(ROOT, "midi_cc_states")
DB_PATH = os.path.join(ROOT, "midi_cc_map.db")
LIB_SAVED_PATH = os.path.join(ROOT, "library_saved.json")

SCHEMA = """
CREATE TABLE IF NOT EXISTS effects (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  slot TEXT,
  slug TEXT,
  cc_layout TEXT,
  library_name TEXT,
  lib_saved INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS assignments (
  id INTEGER PRIMARY KEY,
  effect_id INTEGER NOT NULL REFERENCES effects(id),
  cc INTEGER NOT NULL,
  control TEXT NOT NULL,
  type TEXT,
  "values" TEXT,
  verified INTEGER DEFAULT 0,
  section TEXT DEFAULT 'effect',
  UNIQUE(effect_id, cc)
);
"""


def library_name(slot, slug, effect, cap=23):
    eff = effect.replace(" ", "_")
    name = "%s %s %s" % (slot, slug, eff)
    if len(name) > cap:
        prefix = "%s %s " % (slot, slug)
        keep = cap - len(prefix)
        eff = eff[:keep].rstrip("_")
        name = "%s%s" % (prefix, eff)
    return name


def upsert_effect(cur, name, slot, slug, cc_layout, lib_name, lib_saved=0):
    cur.execute(
        "INSERT INTO effects(name, slot, slug, cc_layout, library_name, lib_saved) "
        "VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(name) DO UPDATE SET "
        "slot=excluded.slot, slug=excluded.slug, "
        "cc_layout=excluded.cc_layout, library_name=excluded.library_name, "
        "lib_saved=excluded.lib_saved",
        (name, slot, slug, cc_layout, lib_name, 1 if lib_saved else 0),
    )
    return cur.execute("SELECT id FROM effects WHERE name=?", (name,)).fetchone()[0]


def insert_assignments(cur, effect_id, assignments):
    for a in assignments:
        section = "general" if a.get("effect", "").lower() == "general" else "effect"
        cur.execute(
            "INSERT INTO assignments(effect_id, cc, control, type, \"values\", verified, section) "
            "VALUES(?,?,?,?,?,?,?) "
            "ON CONFLICT(effect_id, cc) DO UPDATE SET "
            "control=excluded.control, type=excluded.type, "
            "\"values\"=excluded.\"values\", verified=excluded.verified, "
            "section=excluded.section",
            (
                effect_id,
                a["cc"],
                a.get("control", ""),
                a.get("type", ""),
                a.get("values", ""),
                1 if a.get("verified") else 0,
                section,
            ),
        )


def load_json(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def load_lib_saved():
    try:
        data = load_json(LIB_SAVED_PATH)
    except Exception:
        return {}
    if isinstance(data, dict) and "saved" in data:
        data = data["saved"]
    return {k: bool(v) for k, v in data.items() if isinstance(v, (bool, int))}


def main():
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DROP TABLE IF EXISTS assignments")
    cur.execute("DROP TABLE IF EXISTS effects")
    con.executescript(SCHEMA)
    lib_saved = load_lib_saved()

    # Legacy file (Band Delay)
    if os.path.exists(LEGACY):
        data = load_json(LEGACY)
        assignments = data.get("assignments", [])
        eff_name = assignments[0]["effect"] if assignments else "Band Delay"
        lib_name = library_name("m1", "delay", eff_name)
        eid = upsert_effect(cur, eff_name, "m1", "delay",
                            "effect 0..N-1, General N..N+6", lib_name,
                            lib_saved.get(eff_name, False))
        insert_assignments(cur, eid, assignments)

    # Per-effect JSONs in midi_cc_states/
    if os.path.isdir(STATES_DIR):
        for fname in sorted(os.listdir(STATES_DIR)):
            if not fname.endswith(".json"):
                continue
            data = load_json(os.path.join(STATES_DIR, fname))
            eff_name = data.get("effect", fname.replace(".json", ""))
            disp = data.get("display", eff_name)
            slot = data.get("slot", "m1")
            slug = data.get("slug", "delay")
            cc_layout = data.get("cc_layout", "effect 0..N-1, General N..N+6")
            lib_name = library_name(slot, slug, eff_name)
            eid = upsert_effect(cur, disp, slot, slug, cc_layout, lib_name,
                                lib_saved.get(disp, False))
            insert_assignments(cur, eid, data.get("assignments", []))

    con.commit()

    # Print summary
    effects = cur.execute(
        "SELECT id, name, library_name, lib_saved FROM effects ORDER BY name"
    ).fetchall()
    print(f"Effects: {len(effects)}")
    for eid, name, lib, saved in effects:
        count = cur.execute(
            "SELECT COUNT(*) FROM assignments WHERE effect_id=?", (eid,)
        ).fetchone()[0]
        print(f"  [{'+' if saved else '-'}] {name:20s}  {count:2d} CCs  {lib}")
    total = cur.execute("SELECT COUNT(*) FROM assignments").fetchone()[0]
    print(f"Total assignments: {total}")
    con.close()


if __name__ == "__main__":
    main()
