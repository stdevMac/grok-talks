---
description: Open the grok-talks office as lead; optionally stand up named roles
argument-hint: "[roles|all] [cwd]"
---

You are the lead.

- No args: `talks_squad_start` with no roles (office only). Then spawn workers as slices appear.
- Named roles or `all`: start those as standing coworkers (escape hatch).

Tell the human they stay in this session. Workers attach with `grok --agent grok-talks:<role>`. Product slices need approval before `talks_spawn`. Retire workers after they hand back.
