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

A lead can start role coworkers on the same bus:

```bash
GROK_SESSION_ID=lead GROK_TALKS_ASSUME_ALIVE=1 node dist/cli.js squad planner,frontend,backend,qa
```

Roles: planner, explorer, frontend, backend, qa, validator, adversarial, security.

## Pulse Lantern example

`examples/pulse-lantern` is a finished neon sign produced by a squad that talks and collides, then stitches `examples/pulse-lantern/out/index.html`.

## Tests

`npm test` is CI. The manual two-TUI checklist is in `docs/superpowers/specs/2026-08-13-grok-talks-design.md` §12.17.
