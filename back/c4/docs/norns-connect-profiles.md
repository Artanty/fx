# norns — connect profiles (plan)

Status: **implemented** (2026-09-22; `connect.js` + `profiles.json` live in
`back/c4/norns/`, verified offline + mDNS resolve). The norns moves between
networks (e.g. home wifi `192.168.1.x`,
studio LAN `10.0.0.x`, travel), so its DHCP IP changes per location and the
hardcoded `we@192.168.1.70` from `norns-port.md` only works at one site. This
document specifies a small repo-side helper that turns that into switchable
named profiles, usable from any computer.

## Goal

- Define named **profiles** (one per location/situation) for reaching the
  norns, e.g. `home`, `studio`, `anywhere`.
- **Switch** the active profile per situation with one command.
- All connection flows (`ssh`, `scp`) then use the active profile's target,
  on any client OS (the helper runs on the client, not the norns).

## Design

- Helper: `back/c4/norns/connect.js` — zero-dependency Node CLI (node
  built-ins only: `fs`, `path`, `child_process`, `net`, `dns`). Runs on any
  machine the user pulls the repo to.
- Config: `back/c4/norns/profiles.json` — committed, edited in place.
- Universal fallback: `norns.local` (mDNS). It follows the norns across any
  network automatically, so it is the default target when a profile has no
  concrete IP. mDNS fails only on networks with mDNS isolation (guest/corporate
  wifi); there a known-IP profile or `discover` is used.
- Credentials: SSH user `we` (password `sleep` on this image). The `key`
  command installs the client's public key so the password prompt goes away.

## config shape (`profiles.json`)

```json
{
  "user": "we",
  "defaultHost": "norns.local",
  "nornsMac": "b8:27:eb:00:00:00",
  "active": "home",
  "profiles": {
    "home":    { "host": "192.168.1.70" },
    "studio":  { "host": null },
    "anywhere": { "host": "norns.local" }
  }
}
```

- `profiles.<name>.host` — known IP at that location; `null` falls back to
  `defaultHost`.
- `active` — the current profile (set by `use`), plus optional `hostOverride`
  filled by `discover`.
- `nornsMac` — optional; the norns (RPi CM3) MAC address prefix used by
  `discover` to find it via `arp -a` when mDNS is unavailable.

## command surface (`node connect.js …`)

| command | behaviour |
|---|---|
| `list` | print profiles, active marker, resolved target per profile |
| `use <name>` | set `active`, persist to `profiles.json` |
| `resolve` | print current target + TCP-22 probe result |
| `ssh [args…]` | `ssh <user>@<target> args…` |
| `scp <src…> <dest>` | `scp` wrapper; bare `norns:→…`/`:` dest is expanded to `<user>@<target>:…` |
| `discover` | try `norns.local` first; else scan `arp -a` for `nornsMac` and store the found IP into the active profile (`hostOverride`) |
| `key` | install the local SSH public key onto the norns (ssh-copy-id equivalent) |

### resolution order

1. active profile `hostOverride` (from `discover`), else
2. active profile `host`, else
3. `defaultHost` (`norns.local`).

## files

- new `back/c4/norns/connect.js`
- new `back/c4/norns/profiles.json`
- this file documents the plan; `norns-port.md` section 142 will be updated to
  reference the helper once implemented.

## verification (on the target device)

1. `node connect.js list` — targets resolve per profile.
2. `node connect.js use studio` → `connect.js ssh -- echo ok` reaches the norns
   on that network (or `resolve` shows the mDNS fallback answer).
3. `connect.js discover` against a real norns MAC finds the DHCP IP and stores
   it; a second `resolve` uses it.
4. `connect.js scp back/c4/norns/c4hid.c norns:→~/dust/c4hid/` pushes a file.
5. `connect.js key` — subsequent ssh/scp are passwordless.

## housekeeping

- AGENTS.md workflow: this plan entry is mirrored in `DECISIONS.md`; a
  Progress entry must be appended after implementation.
- Commit prefix for this work: `[pedal-app]` (matches the existing C4 norns
  randomizer commits).