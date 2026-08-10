function noteName(midi) {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  if (midi === undefined || midi === null) return "?";
  return names[((midi % 12) + 12) % 12] + Math.floor(midi / 12 - 1);
}

function renderTextTab(score) {
  const out = [];
  const title = [score.title, score.artist].filter(Boolean).join(" - ");
  if (title) out.push(title);
  out.push("Tempo: " + (score.tempo || "?"));

  for (const track of score.tracks) {
    const stave = track.staves && track.staves[0];
    if (!stave || stave.isPercussion) continue;
    const tuning = stave.tuning ? Array.from(stave.tuning) : [];
    if (!tuning.length) continue;

    const rows = tuning.map(() => []);
    for (const mb of score.masterBars) {
      const bar = stave.bars[mb.index];
      if (!bar) continue;
      const beats = [];
      for (const v of bar.voices) beats.push(...v.beats);
      beats.sort((a, b) => a.index - b.index);
      for (const beat of beats) {
        const cell = tuning.map(() => "-");
        if (beat.notes && beat.notes.length) {
          for (const n of beat.notes) {
            const s = n.string;
            if (s !== undefined && s >= 0 && s < cell.length) {
              cell[s] = n.isDead ? "x" : String(n.fret);
            }
          }
        }
        for (let i = 0; i < cell.length; i++) rows[i].push(cell[i]);
      }
      for (const r of rows) r.push("|");
    }

    out.push("");
    out.push(track.name + "  (" + tuning.map(noteName).join(" ") + ")");
    for (let i = 0; i < rows.length; i++) {
      out.push(tuning.map(() => "-").join("-") + "  " + rows[i].join(""));
    }
    out.push("=".repeat(60));
  }
  return out.join("\n");
}

module.exports = { renderTextTab };
