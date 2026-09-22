# AGENTS.md

## Commit message convention

Every commit message must start with a `[project]` prefix identifying the
feature/project area, because different users contribute different projects to
this repository.

Current projects:

- `[h90]` — Eventide H90 control reverse-engineering / import protocol (`back/h90`)
- `[pedal-app]` — pedal/app prototyping (L.A. Lady, source-audio) (`back/lalady`)
- `[web]` — web frontends / shared web tooling (`web`)
- `[server]` — shared server work (proxy, captures, fx)

Add new prefixes as new projects are introduced.

Examples:

```
[h90] Reconstruct import write JSON from captured deflate stream
[pedal-app] Fix MIDI frame capture over-read bug
[web] Refresh package-lock after dependency resolution
[server] Validate DEFLATE decoder LENGTH table
```

## Layout

- `web/` — Angular frontend (`npm start`, dev port 4211). Top header links
  both `/dist` (L.A. Lady) and `/h90`.
- `back/` — backends. `back/h90` (Express :3000), `back/lalady` (Express :3111).
- From `back/` run `npm run start:la` for the L.A. Lady backend or
  `npm run start:h90` (or `npm start`) for the H90 backend.

## DECISIONS.md workflow

Before any code write, append a plan entry to `DECISIONS.md` describing the
planned further work. After any code action (edit, create, refactor, fix),
append a status entry to `DECISIONS.md` recording what was done and the result.

This keeps a living log of intent and outcome for every change.

## Backend server
- Do not spawn nodemon/npm/node processes for the backend. Only edit code; the user handles running it.

## norns deployment
- The c4synth script on the norns lives **flat** at
  `/home/we/dust/code/c4synth/` (`c4synth.lua` + `lib/` directly under it).
  Never push/create a nested `code/c4synth/c4synth/` — it appears in the norns
  script menu as a spurious `c4synth/c4synth/c4synth` entry (seen 2026-09-22)
  and shadows the real script. Verify after every push: exactly one
  `code/c4synth/c4synth.lua` and `test ! -e code/c4synth/c4synth`.
- `scp -r dir host:/home/we/dust/code/c4synth` re-nests on later pushes (existing
  target dir → scp copies the dir *into* it). Push contents (`dir/.`) or use a
  temp name + `rm -rf`/`mv`. Preserve `rndgroups.json` (norns-only user groups).
- Reach the norns with `node back/c4/norns/connect.js` (profiles helper).
  Details: `back/c4/docs/norns-port.md` -> "Deploy".

## Do exactly what is asked
- Do exactly what the user asks, nothing redundant. Before doing anything else (extra checks, extra exports, file moves, side tasks) — ask the user first.

## Long-running sessions
- If a single continuous task chain exceeds ~30 minutes, STOP, post a short
  status (what's done, what remains, next step), and wait for the user to say
  continue. Never spin on background verification loops (repeat runs, server
  polls, waits) past that point without a check-in.
