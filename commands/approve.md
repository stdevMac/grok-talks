---
description: Human-only approval for a squad product slice
argument-hint: "<task>"
---

The human just submitted `/approve <task>`. The UserPromptSubmit hook already recorded it. Do **not** call `talks_approve`. If that task was blocking a spawn, call `talks_spawn` now.
