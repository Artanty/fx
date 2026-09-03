# AGENTS.md

## Commit message convention

Every commit message must start with a `[project]` prefix identifying the
feature/project area, because different users contribute different projects to
this repository.

Current projects:

- `[h90]` — Eventide H90 control reverse-engineering / import protocol
- `[pedal-app]` — pedal/app prototyping (L.A. Lady, source-audio)
- `[web]` — web frontends / shared web tooling
- `[server]` — shared server work (proxy, captures, fx)

Add new prefixes as new projects are introduced.

Examples:

```
[h90] Reconstruct import write JSON from captured deflate stream
[pedal-app] Fix MIDI frame capture over-read bug
[web] Refresh package-lock after dependency resolution
[server] Validate DEFLATE decoder LENGTH table
```

## DECISIONS.md workflow

Before any code write, append a plan entry to `DECISIONS.md` describing the
planned further work. After any code action (edit, create, refactor, fix),
append a status entry to `DECISIONS.md` recording what was done and the result.

This keeps a living log of intent and outcome for every change.

## Backend server
- Do not spawn nodemon/npm/node processes for the backend. Only edit code; the user handles running it.
