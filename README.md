# grok-talks

A Grok plugin so live TUI sessions on this machine can see each other, talk, and stop overwriting the same file.

## Install

```bash
npm install
npm test
npm run build
grok plugin install . --trust
```

Enable the plugin (`grok plugin enable grok-talks` or Space in `/plugins`). Restart every TUI you want in the office.

## Use

- `/board` — who is live
- `/talks <name> <message>` — DM
- `/mute` / `/unmute` — silence a peer
- Same-project writes to a file another *working* session just touched are denied once; talk, then retry.

Idle peers hear mail within about a minute after they arm `/loop 60s`. This plugin never starts a second writer on a live session.

## Squad (v2)

Role cards live in `squad/` (constitution + one file per role). The plugin ships matching `agents/` so a role is a real Grok agent.

```bash
# this session is the lead
grok --agent grok-talks:lead
# /squad   or talks_squad_start
```

Default: the lead stays up. Workers are **spawned for one slice** and **auto-retired** when they hand back to the lead. Frontend/backend need a human `/approve <task>` first (the model cannot approve). Attach a worker with the spawn launch line (a fresh UUID — do not reuse a live session id):

```bash
# lead only
GROK_SESSION_ID=lead node dist/cli.js squad

# later
GROK_SESSION_ID=lead node dist/cli.js request-approval slice-auth
# in the lead TUI: /approve slice-auth
# or:
GROK_SESSION_ID=lead node dist/cli.js approve slice-auth
GROK_SESSION_ID=lead node dist/cli.js spawn frontend slice-auth "own the glass"
# spawn prints: frontend	<uuid>	grok --session-id <uuid> --agent grok-talks:frontend
```

Optional project overrides live in `.grok/talks-pack.json` (`maxTransient`, `perRole`). Handoffs may include `--commit <sha>`.

Roles: lead, planner, explorer, frontend, backend, qa, validator, adversarial, security.

## Pulse Lantern example

`examples/pulse-lantern` is a finished neon sign produced by a squad that talks and collides, then stitches `examples/pulse-lantern/out/index.html`.

## Tests

`npm test` is CI. The manual two-TUI checklist is in `docs/superpowers/specs/2026-08-13-grok-talks-design.md` §12.17.
