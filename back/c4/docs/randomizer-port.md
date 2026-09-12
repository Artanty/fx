# C4 Synth — randomizer port checklist

Port the L.A. Lady randomizer to the C4 Synth pedal. The reference design is
fully documented in `back/lalady/docs/randomizer.md`; this file is the C4-side
checklist: what already exists, what to copy, and every constant/name that must
change. Work is deliberately backend→frontend, server-callable before any UI.

## What already exists on C4 (no need to build)

| Area | Location |
| ---- | -------- |
| Control spec map (same `ControlSpec` shape as L.A. Lady) | `back/c4/src/c4Model.js` `WORKBENCH_CONTROL_SPECS` (l.612), exposed as `GET /api/control-map` in `back/c4/server.js` (l.141) |
| Read presets (body + name) | `back/c4/src/c4Protocol.js`: `readSlotBody(idx)` (l.115), `readSlotName(idx)` (l.119), `getPresetName(idx)` (l.98) |
| **Write a preset + name, verify, then recall** | `c4Protocol.commitRawPreset(idx, data, name)` (l.201) — already handles ACTIVE_STORE blocks + ACTIVE_WRITE with name + read-back verify + `setActivePreset`. This is C4's `persistBody` |
| Backend endpoints | `back/c4/server.js` (port 3222): `/api/control-map`, `/api/controls` (live), `/api/presets` (`?idx=` single read, list), `/api/presets/save` (overrides patch), `/api/activate`, `/api/eeprom`, `/api/midimap`, `/api/log` |
| Frontend knobs workbench | `web/src/app/c4/c4.component.ts` (1008 lines) + `.html`/`.scss`: controlMap, `slotParams` (128 `SlotParam` in `params`), `editedOverrides`, `paramsSnapshot`, `slotsDirty` (l.36-40), `queueLive(spec, value)` (l.687), 128-preset picker (`presetOptions`) |

## C4 vs L.A. Lady — the deltas

| Aspect | L.A. Lady | C4 Synth |
| ------ | --------- | -------- |
| Body size | 53 bytes | **128 bytes** (`C4_DATA_SIZE = 0x80`) |
| Presets | 6 pedal slots | **128 preset locations** (`C4_PRESET_COUNT=128`) |
| Preset index | raw slot index ≠ display order (`SLOT_DISPLAY_ORDER=[3,4,5,0,1,2]`) | idx IS the user-facing preset number (0..127) — no display mapping |
| bodyHex length | 106 hex chars | **256 hex chars** |
| Write path | `writePreset(page,{name,params,idx})` + `setActivePreset` | `commitRawPreset(idx, data, name)` |
| saveToSlot range | int 0..5 | **int 0..127** |
| persistence dir | `back/lalady/randomizer-data/` | **`back/c4/randomizer-data/`** (`groups.json`, `presets.json`) |
| frontend prefix | `rand*` in lalady.component | rename to `c4` prefix; keep `rand` state names |

## Step 1 — backend (`back/c4/server.js`)

Copy from `back/lalady/server.js` (l.717-795): `randLoad`, `randSave`,
`randUuid`, `normalizeGroup`, `normalizePreset`, `claimPresetSlot`,
`bodyOfHex`, plus the 8 endpoints (`/api/randomize/groups` GET/POST/PUT/DELETE,
`/api/randomize/presets` GET/POST/PUT/DELETE). Adjust:

- `RAND_DATA_DIR = path.join(__dirname, 'randomizer-data')`;
  `RAND_GROUPS_FILE` / `RAND_PRESETS_FILE`.
- `normalizePreset`: bodyHex regex → `/^[0-9a-fA-F]{256}$/`;
  `saveToSlot` int 0..127.
- Add a `persistBodyC4(rawIdx, body, nameOverride)` wrapper:
  `const name = nameOverride ?? p.getPresetName(rawIdx);` then
  `p.commitRawPreset(rawIdx, body, name)` (it recalls the preset itself, so no
  separate `setActivePreset`). Return `{ page: (C4_PRESET_BASE + rawIdx *
  C4_PRESET_PITCH).toString(16), name }` for a match with L.A. Lady.
- The POST/PUT preset handlers do `persistBody` (with `bodyOfHex`),
  then `claimPresetSlot(list, id/d, null, saveToSlot)` as in L.A. Lady.
- GET groups backfill `{ mode: 'include', enabled: true }` for old rows.
- Also ship the mini-device lifecycle: an existing helper on C4 must open the
  HID device before any randomize call (the control-map is static; writes need
  the device — reuse the same device-open gate the other write endpoints use).

Verify with the live pedal: `curl` a `POST /api/randomize/presets` with a
256-hex bodyHex + `saveToSlot`, then `GET /api/presets?idx=<slot>` and confirm
the body and name match, and that the preset is heard on the pedal.

## Step 2 — frontend models (`web/src/app/c4/c4.models.ts`)

Add `RandomizeGroup`, `RandomizePreset`, `RandomizePresetCreate`,
`RandomizeList<T>` exactly as in `lalady.models.ts` (same fields). No shape
change — `ControlSpec` already exists in `c4.models.ts` with a `liveIndex`.

## Step 3 — API service (`web/src/app/c4/c4-api.service.ts`)

Add the same 6 methods as `lalady-api.service.ts`
(`randomizeGroups/Create/Update/Delete`, `randomizePresets/Create/Update/
Delete`) against the existing `BASE` (`http://localhost:3222`) and
`api`-prefixed path style (`/api/randomize/*`).

## Step 4 — component (`web/src/app/c4/c4.component.ts`)

Copy the randomizer section from `lalady.component.ts` (~l.1118-1640) and port:

- State: `randScenes`, `randSceneIdx`, `randPlaying`, `randIntervalSec`,
  `randAlgo`, `randCountdown`, `randGroups`, `randPresets`, `randBusy`,
  `randError`, `randAll`, group-editor + group-picker + save state.
- Call `refreshRand()` from `ngOnInit` AND when the new Randomizer tab opens
  (mirror the double-hook at lalady l.295 / l.485).
- **`bodyValues()`** → return the 128-byte `slotParams.params` body
  (each `p.value`, length 128). `hexOfBody`/`bodyOfHex` must round-trip 256
  hex chars.
- **`applyScene(body)`** → same write into `p.value` +
  `this.editedOverrides[p.index] = body[p.index]` + `slotsDirty = true`, then
  per-spec live send with `this.queueLive(spec, val)` for every changed spec.
  (C4 `allParamsZero`, l.400, already shows this exact pattern.)
- **`randomTargets()` / `fieldFor()` / `randomizeBody()`** → copy verbatim;
  they are map-driven off `this.controlMap` and `spec.key`. C4 bodies are 128
  bytes, so `randomizeBody` just indexes a longer array.
- **Preset-to-slot** → `savePresetToSlot` writes `saveToSlot` (0..127); no
  `SLOT_DISPLAY_ORDER` translation; after the PUT, reload preset list +
  `loadPresetParams(idx)` so the name is visible.
- Columns/values that reference "slot display num" in the L.A. Lady UI have no
  equivalent on C4 — show `idx` directly.

## Step 5 — template & styles (`web/src/app/c4/c4.component.html` / `.scss`)

- Add a **"Randomizer" tab** to the `.tabs` nav (l.65-69) and a section like
  L.A. Lady's `.rand-player` + two-column `.rand-cols`.
- Port `.rand-player` (Generate, Play/Pause + interval + algorithm,
  "Randomize all controls" checkbox, Prev/Next, countdown badge), groups editor
  + list, presets table.
- Per-knob group picker: C4's knobs are rendered in `knob-groups`/`knobs`
  grids (l.92-147). Graft the same `grp-btn` + `grp-picker` snippet the L.A.
  Lady uses onto each `it.spec`/`it.p`, keyed by the same `specKey`.
- `randAll` dim handling: apply `.dim` + `[disabled]` to the groups editor/list
  exactly as L.A. Lady (opacity 0.45), and `.rand-all.on` green highlight.
- Port the corresponding `.rand-*`, `.chip.exclude`, `.field-helper` styles
  from `lalady.component.scss` (last ~300 lines) into `c4.component.scss`.

## Step 6 — verification

1. `node --check back/c4/server.js`
2. `npm run build` (web) — expect no new warnings.
3. Backend: POST a random preset with `saveToSlot`, read it back, confirm name.
4. UI: generate scenes while playing audio, verify body changes are heard,
   groups on/off and mode toggles persist across reloads, "→ preset" writes the
   name into the target location.
5. Follow the DECISIONS.md plan/status workflow for each commit.

## Open questions for the user

- Randomize tab vs. inline workbench section? (Tab is cleaner given C4's 19
  control groups.)
- Keep the `rand` state names even though C4 uses a `c4` prefix, or rename to
  `c4Rand*`? Recommend `c4Rand*` for consistency with `c4`-prefixed members.