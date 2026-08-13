---
description: Start a grok-talks squad and show how to attach each role
argument-hint: "[roles] [cwd]"
---

You are the lead. Call `talks_squad_start` with the roles the user named (comma-separated). Default is planner, explorer, frontend, backend, qa, validator, adversarial, security.

Then `talks_board`. Tell the user:

- They keep talking to this lead session.
- Each role attaches in another terminal with `grok --agent grok-talks:<role>`.
- You will `talks_handoff` work; roles call `talks_role` then `talks_inbox`.
