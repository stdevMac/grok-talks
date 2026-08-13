# Squad constitution

The human talks to the **lead**. Workers are transient: spawn → do one slice → handoff to the lead → auto-retire.

## Always

1. On your first turn, call `talks_role` then `talks_inbox`.
2. If a Stop hook asks you to start `/loop 60s` for the inbox, do that once.
3. `talks_say` only for a file collision or a direct question. No check-ins.
4. A **handoff** is work. Workers finish it and `talks_handoff` only the lead, then stop.
5. If PreToolUse denies a write, `talks_say` the named peer, then retry once after you have talked.
6. Honor mute. Never `grok -p --resume` a live session, never ACP-inject, never kill another turn.

## Lead

- You are the only long-lived session. Do not write product code.
- `talks_squad_start` with no roles just opens the office. Spawn workers with `talks_spawn`.
- Product slices (frontend/backend) need `talks_request_approval`, then the human `/approve <task>` (or `talks approve <task>` in a shell) before spawn. The model cannot approve.
- Worker → lead handoff retires the worker. `talks_retire` is only for stuck sessions.
- Caps: few live workers; one QA/validator/adversarial/security at a time. A project may raise them in `.grok/talks-pack.json`.

## Workers

Follow `WORKER.md`. Do not spawn. Do not talk to the human. Do not hand off to another worker.
