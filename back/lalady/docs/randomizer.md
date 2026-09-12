# L.A. Lady Randomizer — reference implementation

This is the canonical randomizer implementation. It is the thing to copy when
porting the same feature to the **C4 Synth** pedal — see
`back/c4/docs/randomizer-port.md` for the port checklist. This doc describes
exactly how the current L.A. Lady randomizer works: data model, backend API,
persistence, frontend state, algorithms, and UI.

## Feature summary

Generate random scenes from the currently loaded workbench sound and hear them
instantly (realtime). Step backward/forward through the scene history
(`‹ Prev` / `Next ›`), run an *auto-randomize* loop every 3/5/7/10 s with a
live countdown, and save the good scenes as named presets or write them to a
pedal slot.

Groups control *which* controls get randomized:

- **include** group — its controls are randomized; `props` limits how many of
  its controls change per scene (0 = all).
- **exclude** group — its controls are *locked* (never randomized, even under
  "Randomize all controls").
- **enabled** — a per-group on/off switch. Disabled groups are ignored entirely
  (an excluded group that is off stops locking its controls).
- **priority** — orders groups (lower = first).

## Data model

| Type | File | Fields |
| ---- | ---- | ------ |
| `RandomizeGroup` | `web/src/app/dist/lalady/lalady.models.ts` | `id`, `name`, `priority`, `props`, `mode: 'include'\|'exclude'`, `enabled: boolean`, `specKeys: string[]` (`"index:name"`), `createdAt`, `updatedAt` |
| `RandomizePreset` | same file | `id`, `name`, `bodyHex` (106 hex chars = 53-byte body), `source`, `slot?: number\|null` (last pedal slot written to), `createdAt`, `updatedAt` |
| `RandomizePresetCreate` | same file | `name?`, `source?`, `saveToSlot?`, `bodyHex` |
| `RandomizeList<T>` | same file | `ok`, `count`, `groups?`, `presets?` |

Control references are `specKey(spec) = spec.index + ':' + spec.name` because a
single body byte can host several packed sub-fields (e.g. the packed bytes
26/30/32/38).

### Backend persistence

JSON files under `back/lalady/randomizer-data/` (a "local DB" — swappable for a
real DB later without touching the API):

```
back/lalady/randomizer-data/
├── groups.json     # array of RandomizeGroup
└── presets.json    # array of RandomizePreset
```

## Backend API (`back/lalady/server.js`)

Base path `/api/randomize/*`. Helper functions at `server.js:717-795`:

| Helper | Purpose |
| ------ | ------- |
| `randLoad(file)` | read+parse a JSON array (missing/corrupt → `[]`) |
| `randSave(file, list)` | atomic write (`.tmp` + rename), `mkdir -p` the data dir |
| `randUuid()` | `r` + base36 time + random suffix |
| `normalizeGroup(body)` | validate/default `name`, `priority`, `props`, `mode`, `enabled`, `specKeys` (`/^\d+:.+/`, cap 200) |
| `normalizePreset(body)` | validate `bodyHex` (`/^[0-9a-fA-F]{106}$/`), `name`, `source`, `saveToSlot` (int 0..5) |
| `persistBody(rawIdx, body, nameOverride?)` | write a 53-byte body + name to a pedal slot via `writePreset` (ACTIVE_STORE/ACTIVE_WRITE/ACTIVE_SET), then make it active. Returns `{ page, name }` or `{ error }` |
| `bodyOfHex(hex)` | hex string → `number[]` |
| `claimPresetSlot(list, id, rawIdx)` | clear `slot` on every preset *other than* `id` that still points at `rawIdx` (one preset per displayed slot) |

### Endpoints

| Method | Path | Notes |
| ------ | ---- | ----- |
| GET | `/api/randomize/groups` | returns all groups; backfills `{ mode: 'include', enabled: true }` for old records |
| POST | `/api/randomize/groups` | create (`id`/timestamps added server-side) |
| PUT | `/api/randomize/groups/:id` | partial update (`Object.assign`); bumps `updatedAt` |
| DELETE | `/api/randomize/groups/:id` | 404 if unknown |
| GET | `/api/randomize/presets` | returns all presets |
| POST | `/api/randomize/presets` | create. If `saveToSlot` set: `persistBody` first, `claimPresetSlot` clears stale pointers, then persist |
| PUT | `/api/randomize/presets/:id` | partial update. If `saveToSlot` set: re-writes body+name to that slot with `persistBody`, clears stale pointers |
| DELETE | `/api/randomize/presets/:id` | 404 if unknown |

## Frontend

### API service — `web/src/app/dist/lalady/lalady-api.service.ts`

One method per endpoint, e.g. `randomizeGroups()`, `randomizeGroupCreate(body)`,
`randomizeGroupUpdate(id, body)`, `randomizeGroupDelete(id)`,
`randomizePresets()`, `randomizePresetCreate(body)`,
`randomizePresetUpdate(id, body)` (typed to allow `saveToSlot`), deletion.

### Component — `web/src/app/dist/lalady/lalady.component.ts`

The whole randomizer lives in one section starting ~line 1118. State:

- Playback: `randScenes: number[][]`, `randSceneIdx`, `randPlaying`,
  `randIntervalSec` (3/5/7/10), `randAlgo` (uniform/center/extremes/drift),
  `randCountdown` (s before next change), private `randTimer` (1 s tick).
- Group list/editor: `randGroups`, `randEditingId`, `randNewName`,
  `randNewPriority` (default 10), `randNewProps` (0 = all), `randNewMode`,
  `randKeysChecked` (record of checked spec keys), `groupEditMode`.
- Per-knob group picker: `groupPickerSpec`, `groupPickerNewName`.
- Preset save: `randSaveName`, `randPresetSlots`.
- `randAll` — "Randomize all controls" checkbox (UI dims groups when on).
- `randBusy` / `randError` for async state.

Core algorithm methods:

| Method | What it does |
| ------ | ------------ |
| `specKey(spec)` | `index:name` key |
| `randSpecTag(spec)` | `sel`/`tog`/`seg`/`knb` tag label |
| `bodyValues()` | current 53-byte body from the loaded slot (source of truth) |
| `randInt(min, maxExcl)` | uniform integer |
| `fieldFor(spec, current)` | a randomized field value under `randAlgo`. select/segmented → a legal option; toggle → 0/1; knob → uniform/center/extremes/drift |
| `randomTargets()` | the set of `ControlSpec`s this scene touches. Skips disabled groups; exclude groups form the lock set (applies even under `randAll`); include groups pick `props` random members each |
| `randomizeBody(base, targets)` | compose a new 53-byte body by OR-ing each target's `(field << shift) & mask` into the base byte |
| `pushScene(body)` | append to scene history (truncates redo tail) |
| `applyScene(body)` | write the body into workbench params + `editedOverrides` (dirty flag) and fire per-spec live `CTRL_SET` via `queueLive()` for every changed spec (@:1293) |
| `generateScene()` | `randomTargets()` → `randomizeBody(bodyValues())` → `pushScene` → `applyScene` |
| `stepScene(dir)` | prev/next scene |
| `togglePlay()` | starts auto-play (generates immediately, then a 1 s interval decrements the countdown; at 0, generate again) |

Group CRUD (+picker): `startAddGroup`, `editGroup`, `cancelEditGroup`,
`saveGroup` (POST or PUT), `toggleSpecInEditGroup` (group-edit mode on the knobs),
`openGroupPicker` / `grpPickerIs` / `specOfExclude` / `groupsOf` / `specInGroup`
/ `setSpecInGroup` / `createGroupWithSpec`, `toggleGroupEnabled` (PUT `enabled`),
`toggleGroupMode` (PUT `mode`), `deleteGroup`.

Preset CRUD: `hexOfBody`/`bodyOfHex` (53 bytes ⇄ hex),
`savePreset` (POST → name auto `rand-N`), `loadPreset` (apply scene),
`savePresetToSlot` (PUT with `saveToSlot` + name; then reloads slots + the
written slot so the name is visible), `renamePreset`, `deletePreset`.

**Important lifecycle detail:** groups/presets are loaded on session start by
`refreshRand()` called from `ngOnInit` (@:295) — NOT only when opening the
Workbench tab — and `openWorkbench()` also calls it (@:485). Every mutation
(create/edit/delete/enable) ends with `refreshRand()`.

### Template — `web/src/app/dist/lalady/lalady.component.html` (~line 331+)

- `.rand-player`: Generate, Play/Pause, interval select, algorithm select,
  "Randomize all controls" checkbox, Prev/Next, countdown badge (`.rand-count`,
  amber `.low` in the last 3 s).
- `.rand-cols` → two columns:
  - **Groups**: `.rand-editor` (name/priority/props inputs + `?` helper,
    include/exclude toggle, controls grid). `.rand-group-list` rows show
    name, on/off checkbox, included/excluded chip, priority, ctl count, props,
    and include/exclude/Edit/Delete buttons. When `randAll` is on both the
    editor and list get `.dim` and every control is `[disabled]`.
  - **Presets**: save row (name + "Save as preset"), table with name/created/
    actions; actions = Load/Rename/Delete + a target preset dropdown + "→ slot".

### SCSS — `web/src/app/dist/lalady/lalady.component.scss`

Randomizer styles live in the last ~300 lines: `.rand-player`, `.rand-count`,
`.rand-inline.rand-all.on` (green highlight when `randAll`), `.rand-editor.dim`
and `.rand-group-list.dim` (opacity 0.45), `.rand-specs/.rand-spec/.rand-tag*`,
`.rand-group-list`, `.rand-g-on`, `.chip.exclude`, `.rand-save-row`,
`.slots.rand-presets`, `.field-helper` (`?` badge).

## Randomization semantics (be precise)

- `randAll` = every control in the map except those locked by enabled exclude
  groups.
- Without `randAll`, only include-group members get randomized, `props` members
  per group per scene.
- Disabled (`enabled === false`) groups are skipped for BOTH include and exclude
  purposes; the per-knob "excluded" lock styling (`specOfExclude`) also ignores
  disabled groups.
- Multi-spec packed bytes are handled by each spec's own `shift`/`mask`; the
  live send is per-spec (never the whole byte), so sibling bits are never
  clobbered.

## Porting

See `back/c4/docs/randomizer-port.md`.