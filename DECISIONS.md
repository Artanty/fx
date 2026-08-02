# Decisions — Programmatic H90 control from the web app

Status: decided in discussion, not yet implemented.

## Goal

Allow changing effects (presets / algorithms) on an Eventide H90 from the Angular app.

## Context / constraints

- The pedal speaks MIDI. The browser cannot reach it directly over USB or
  Bluetooth, so a helper process must own the MIDI connection.
- The Express server (`server/server.js`) has no USB/BT path to the pedal
  and currently exposes only read-only GET endpoints.
- The DB already stores each patch's `algorithm` and `preset_name`, so the UI
  has everything needed to build the MIDI message content.

## Decision 1 — Transport: WiFi only (for now)

For the H90, control the pedal over WiFi only for the time being. No
browser-native Web MIDI path; the browser communicates over the local network.

- The Angular app adds a "Send to H90" action that POSTs to the existing
  Express server on port 3000, e.g. `POST /api/h90/preset { presetName, algorithm }`.
- A local Node helper (e.g. `node-midi` / `easymidi`) owns the connection to the
  H90 and forwards commands received over the network to the pedal over WiFi MIDI.
- USB and Bluetooth paths are out of scope for now; revisit later.

## Decision 2 — message mapping (blocked)

The exact MIDI messages (Program Change mapping for presets, and the
algorithm-select message for switching effects) come from Eventide's H90 MIDI
Reference. Not yet confirmed — must be looked up before implementation.

## Open questions

- H90 MIDI reference: exact PC / NRPN / CC values for preset and algorithm select.
- Whether the daemon should also expose real-time status (current algo).
- How the daemon discovers / pairs to the H90 over WiFi MIDI (device discovery, credentials).
