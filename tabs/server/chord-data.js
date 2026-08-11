const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const QUALITIES = {
  major: { intervals: [0, 4, 7], label: "" },
  minor: { intervals: [0, 3, 7], label: "m" },
  "7": { intervals: [0, 4, 7, 10], label: "7" },
  maj7: { intervals: [0, 4, 7, 11], label: "maj7" },
  m7: { intervals: [0, 3, 7, 10], label: "m7" },
  sus2: { intervals: [0, 2, 7], label: "sus2" },
  sus4: { intervals: [0, 5, 7], label: "sus4" },
  dim: { intervals: [0, 3, 6], label: "dim" },
  aug: { intervals: [0, 4, 8], label: "aug" },
};

const OPEN_MIDI = [40, 45, 50, 55, 59, 64]; // low E .. high E
const MUTE = -100;

const OPEN_SHAPES = {
  C: { major: "x32010", "7": "x32310", maj7: "x32000", sus2: "x30010", sus4: "x33010" },
  D: { major: "xx0232", "7": "xx0212", maj7: "xx0222", sus2: "xx0230", sus4: "xx0233", minor: "xx0231", m7: "xx0211" },
  E: { major: "022100", "7": "020100", maj7: "021100", sus2: "024400", sus4: "022200", minor: "022000", m7: "020000" },
  G: { major: "320003", "7": "320001", maj7: "320002", sus4: "330013" },
  A: { major: "x02220", "7": "x02020", maj7: "x02120", sus2: "x02200", sus4: "x02230", minor: "x02210", m7: "x02010" },
  F: { major: "133211", "7": "131211", maj7: "133210", sus4: "133311", minor: "133111", m7: "131111" },
  B: { "7": "x21202" },
};

// E-form barre: root on the 6th string at fret p, offsets added to p.
const E_FORM = {
  major: [0, 2, 2, 1, 1, 1],
  minor: [0, 2, 2, 0, 1, 1],
  "7": [0, 2, 0, 1, 1, 1],
  maj7: [0, 2, 2, 1, 0, -1],
  m7: [0, 2, 0, 0, 0, 0],
  sus2: [0, 2, 2, -1, 0, 0],
  sus4: [0, 2, 2, 2, 0, 0],
};

// A-form barre: root on the 5th string at fret q, offsets added to q.
const A_FORM = {
  major: [MUTE, 0, 2, 2, 2, 0],
  minor: [MUTE, 0, 2, 2, 1, 0],
  "7": [MUTE, 0, -1, 0, -2, 0],
  maj7: [MUTE, 0, 2, 1, 2, 0],
  m7: [MUTE, 0, 2, 0, 1, 0],
  sus2: [MUTE, 0, 2, 2, 0, 0],
  sus4: [MUTE, 0, 2, 2, 3, 0],
};

function noteClass(note) {
  return ((note % 12) + 12) % 12;
}

function parseFrets(str) {
  return str.split("").map((c) => (c === "x" ? -1 : parseInt(c, 10)));
}

function voicesFor(frets) {
  return frets.map((f, i) => ({ note: OPEN_MIDI[i] + (f > 0 ? f : 0), f, i }));
}

function validateShape(root, quality, frets) {
  const intervals = QUALITIES[quality].intervals;
  const set = new Set(intervals.map((i) => noteClass(root + i)));
  const voices = voicesFor(frets);
  const played = voices.filter((v) => v.f >= 0);
  const classes = new Set(played.map((v) => noteClass(v.note)));
  return classes.size >= Math.min(3, set.size);
}

function findShape(rootStrIdx, rootFret, set) {
  let best = null;
  const frets = [null, null, null, null, null, null];
  const maxFret = Math.min(15, rootFret + 7);

  function evalShape() {
    const played = frets.map((f) => (f == null ? -1 : f));
    const voices = played.filter((f) => f >= 0);
    if (voices.length < 3) return;
    const position = Math.max(...voices);
    const span = Math.max(...voices) - Math.min(...voices);
    if (span > 7) return;
    const classes = new Set(
      played.map((f, i) => (f >= 0 ? noteClass(OPEN_MIDI[i] + f) : -1)).filter((c) => c >= 0)
    );
    if (classes.size < Math.min(3, set.size)) return;
    const total = played.reduce((a, f) => a + f, 0);
    const score = position * 1000 + span * 100 + total - played.length * 50;
    if (!best || score < best.score) {
      best = { frets: played, score };
    }
  }

  function dfs(i) {
    if (i === 6) return evalShape();
    if (i === rootStrIdx) {
      frets[i] = rootFret;
      dfs(i + 1);
      frets[i] = null;
      return;
    }
    const options = [null];
    for (let f = 0; f <= maxFret; f++) {
      if (set.has(noteClass(OPEN_MIDI[i] + f))) options.push(f);
    }
    for (const f of options) {
      frets[i] = f;
      const voices = frets.filter((x) => x != null && x >= 0);
      if (voices.length) {
        const span = Math.max(...voices) - Math.min(...voices);
        if (span <= 7) dfs(i + 1);
      } else {
        dfs(i + 1);
      }
      frets[i] = null;
    }
  }

  dfs(0);
  return best;
}

function generateShape(root, quality) {
  const intervals = QUALITIES[quality].intervals;
  const set = new Set(intervals.map((i) => noteClass(root + i)));
  let best = null;
  for (let strIdx = 0; strIdx < 6; strIdx++) {
    const fret = noteClass(root - OPEN_MIDI[strIdx]);
    if (fret > 14) continue;
    const shape = findShape(strIdx, fret, set);
    if (shape && (!best || shape.score < best.score)) best = shape;
  }
  return best ? best.frets : null;
}

function barreShape(root, quality, form, position) {
  const pattern = form[quality];
  if (!pattern) return null;
  const frets = pattern.map((o) => (o === MUTE ? -1 : o + position));
  return frets;
}

function buildChord(root, quality) {
  const rootName = NOTES[root];
  let frets = null;

  if (OPEN_SHAPES[rootName] && OPEN_SHAPES[rootName][quality]) {
    frets = parseFrets(OPEN_SHAPES[rootName][quality]);
  } else if (quality === "dim" || quality === "aug") {
    frets = generateShape(root, quality);
  } else {
    const p = noteClass(root - 4); // fret on 6th string
    const q = noteClass(root - 9); // fret on 5th string
    const eForm = p >= 1 ? barreShape(root, quality, E_FORM, p) : null;
    const aForm = q >= 1 ? barreShape(root, quality, A_FORM, q) : null;
    const eBase = eForm ? Math.max(...eForm.filter((f) => f > 0)) : Infinity;
    const aBase = aForm ? Math.max(...aForm.filter((f) => f > 0)) : Infinity;
    frets = eBase <= aBase ? eForm : aForm;
  }

  if (!frets || !validateShape(root, quality, frets)) return null;

  const positive = frets.filter((f) => f > 0);
  const notes = QUALITIES[quality].intervals
    .map((i) => NOTES[noteClass(root + i)])
    .filter((n, i, arr) => arr.indexOf(n) === i);
  return {
    frets,
    baseFret: positive.length ? Math.min(...positive) : 1,
    notes,
  };
}

function chordName(root, quality) {
  return NOTES[root] + QUALITIES[quality].label;
}

function seedChords(db) {
  const { c } = db.prepare("SELECT COUNT(*) AS c FROM chords").get();
  if (c > 0) return;
  const insert = db.prepare(
    `INSERT INTO chords (root, quality, name, notes, base_fret, frets) VALUES (?, ?, ?, ?, ?, ?)`
  );
  const missing = [];
  for (let root = 0; root < 12; root++) {
    for (const quality of Object.keys(QUALITIES)) {
      const shape = buildChord(root, quality);
      if (!shape) {
        missing.push(chordName(root, quality));
        continue;
      }
      insert.run(
        NOTES[root],
        quality,
        chordName(root, quality),
        shape.notes.join(", "),
        shape.baseFret,
        shape.frets.join(",")
      );
    }
  }
  if (missing.length) console.warn(`[chords] skipped invalid shapes: ${missing.join(", ")}`);
}

module.exports = { NOTES, QUALITIES, buildChord, seedChords };
