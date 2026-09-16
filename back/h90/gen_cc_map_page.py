#!/usr/bin/env python3
"""Generate midi_cc_map.html from midi_cc_map.db."""

import datetime
import html
import json
import os
import sqlite3

ROOT = os.path.dirname(__file__)
DB_PATH = os.path.join(ROOT, "midi_cc_map.db")
OUT_PATH = os.path.join(ROOT, "midi_cc_map.html")

PAGE_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>H90 CC Mapping</title>
<style>
:root {
  color-scheme: light dark;
  --border: #444;
  --head-bg: #222;
  --head-fg: #eee;
  --zebra: rgba(127,127,127,0.08);
  --gen-bg: rgba(64,120,255,0.15);
}
* { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        margin: 0; padding: 16px; background: #f5f5f5; }
main { max-width: 1200px; margin: 0 auto; }
h1 { font-size: 1.3rem; }
h1 span { font-weight: 400; color: #888; }
.controls { display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
             margin: 12px 0; }
.controls label { font-size: 0.85rem; }
table { width: 100%; border-collapse: collapse; background: #fff;
        box-shadow: 0 1px 3px rgba(0,0,0,.15); }
th, td { border: 1px solid var(--border); padding: 6px 10px; text-align: left;
          font-size: 0.85rem; }
thead th { position: sticky; top: 0; background: var(--head-bg); color: var(--head-fg);
            cursor: pointer; user-select: none; }
thead th.sorted::after { content: " \\2193"; }
tbody tr:nth-child(even) { background: var(--zebra); }
td.cc, td.num { text-align: right; font-variant-numeric: tabular-nums; }
tr.general td { background: var(--gen-bg); }
tr.general:nth-child(even) td { background: var(--gen-bg); }
td.ok { color: #0a7a0a; }
td.no { color: #a00; }
tfoot td { font-weight: 600; background: #eee; }
a { color: inherit; }
@media (prefers-color-scheme: dark) {
  body { background: #1a1a1a; color: #ddd; }
  table { background: #222; }
  tfoot td { background: #333; }
}
</style>
</head>
<body>
<main>
<h1>H90 CC Mapping <span id="meta"></span></h1>
<div class="controls">
  <label>Filter:
    <select id="filter">
      <option value="">All effects</option>
    </select>
  </label>
  <label>Search:
    <input id="search" type="search" placeholder="control / value / library">
  </label>
  <label><input type="checkbox" id="only-unverified"> only unverified</label>
  <label><input type="checkbox" id="show-general" checked> show General rows</label>
  <label><input type="checkbox" id="only-saved"> only saved to library</label>
</div>
<table id="map">
<thead>
<tr>
  <th data-k="effect">Effect</th>
  <th data-k="cc">CC</th>
  <th data-k="section">Sec</th>
  <th data-k="control">Control</th>
  <th data-k="type">Type</th>
  <th data-k="values">Value / range</th>
  <th data-k="verified">Verified</th>
</tr>
</thead>
<tbody>__ROWS__</tbody>
<tfoot>
<tr><td colspan="6">Total assignments</td><td id="total"></td></tr>
</tfoot>
</table>
</main>
<script>
"use strict";
const ROWS = __ROWS_JSON__;
const meta = __META_JSON__;
function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
  })[c]);
}
const tbody = document.querySelector("#map tbody");
const total = document.getElementById("total");
const filter = document.getElementById("filter");
const search = document.getElementById("search");
const onlyUnverified = document.getElementById("only-unverified");
const showGeneral = document.getElementById("show-general");
const onlySaved = document.getElementById("only-saved");

const effectsByKey = new Map();
for (const e of ROWS) {
  if (!effectsByKey.has(e.effect)) {
    effectsByKey.set(e.effect, e.library_name);
    const opt = document.createElement("option");
    opt.value = e.effect;
    opt.dataset.saved = e.lib_saved ? "1" : "0";
    opt.textContent = e.effect + " (" + e.library_name + ")" + (e.lib_saved ? "+" : "");
    filter.appendChild(opt);
  }
}
let sortKey = "effect";
let sortAsc = true;

function render() {
  let rows = ROWS.filter(r => {
    if (filter.value && r.effect !== filter.value) return false;
    const q = search.value.trim().toLowerCase();
    if (q) {
      const hay = [r.effect, r.control, r.values, r.type, r.library_name, String(r.cc)]
        .join(" ").toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (onlyUnverified.checked && r.verified) return false;
    if (!showGeneral.checked && r.section === "general") return false;
    if (onlySaved.checked && !r.lib_saved) return false;
    return true;
  });
  rows.sort((a, b) => {
    let va, vb;
    if (sortKey === "cc") {
      va = a[sortKey]; vb = b[sortKey];
    } else {
      va = String(a[sortKey] == null ? "" : a[sortKey]).toLowerCase();
      vb = String(b[sortKey] == null ? "" : b[sortKey]).toLowerCase();
    }
    return (va < vb ? -1 : va > vb ? 1 : 0) * (sortAsc ? 1 : -1);
  });
  tbody.innerHTML = rows.map(r => {
    const cls = r.section === "general" ? "general" : "";
    const ok = r.verified ? "yes" : "no";
    const okCls = r.verified ? "ok" : "no";
    return '<tr class="' + cls + '">' +
      '<td>' + esc(r.effect) + '<br><small>' + esc(r.library_name) + '</small></td>' +
      '<td class="cc">' + r.cc + '</td>' +
      '<td>' + esc(r.section) + '</td>' +
      '<td>' + esc(r.control) + '</td>' +
      '<td>' + esc(r.type) + '</td>' +
      '<td>' + esc(r.values) + '</td>' +
      '<td class="' + okCls + '">' + ok + '</td>' +
      '</tr>';
  }).join("");
  total.textContent = rows.length;
}

filter.addEventListener("change", render);
search.addEventListener("input", render);
onlyUnverified.addEventListener("change", render);
showGeneral.addEventListener("change", render);
onlySaved.addEventListener("change", render);
document.querySelectorAll("thead th").forEach(th => {
  th.addEventListener("click", () => {
    const k = th.dataset.k;
    if (sortKey === k) sortAsc = !sortAsc;
    else { sortKey = k; sortAsc = true; }
    document.querySelectorAll("thead th").forEach(t => t.classList.remove("sorted"));
    th.classList.add("sorted");
    render();
  });
});
document.querySelector("#meta").textContent =
  "\u2012 " + effectsByKey.size + " effects, " + ROWS.length + " assignments \u2012 " + meta;
render();
</script>
</body>
</html>
"""


def main():
    con = sqlite3.connect(DB_PATH)
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute(
        """
        SELECT e.name AS effect, e.library_name, a.cc, a.section, a.control,
               a.type, a."values", a.verified, e.lib_saved
        FROM effects e
        JOIN assignments a ON a.effect_id = e.id
        ORDER BY e.name, a.cc
        """
    )
    rows = [dict(r) for r in cur.fetchall()]
    con.close()

    created = os.path.getmtime(DB_PATH)
    meta = "generated from %s" % datetime.datetime.fromtimestamp(created).strftime("%Y-%m-%d %H:%M")

    page = (
        PAGE_TEMPLATE
        .replace("__ROWS__", "")
        .replace("__ROWS_JSON__", json.dumps(rows))
        .replace("__META_JSON__", json.dumps(meta))
    )
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        f.write(page)
    print(f"Wrote {OUT_PATH} with {len(rows)} assignment rows.")


if __name__ == "__main__":
    main()