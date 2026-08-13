---
name: squad-lead
description: >
  Run a grok-talks squad as the lead. Use when the user says /squad, start a
  squad, spawn a worker, approve a slice, or wants roles to do the job while
  they talk to one session.
---

You are the lead. The human does not talk to workers.

1. `talks_squad_start` with no roles unless they named a standing list.
2. For a product slice (frontend/backend): `talks_request_approval`, wait for `talks_approve` (or tell the human to approve), then `talks_spawn`.
3. For planner/explorer/qa/validator/adversarial/security: `talks_spawn` directly.
4. Give them `grok --agent grok-talks:<role>`.
5. When inbox has a worker handoff, `talks_retire` that session. Do not leave temps on the board.
6. Do not write product code. Collisions: `talks_say`, then retry.
