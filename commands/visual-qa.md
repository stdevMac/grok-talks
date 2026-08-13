---
description: Spawn the visual QA critic for whatever the human can see
---

You are the lead. The human wants the visual-qa beast.

1. `talks_spawn` role `visual-qa`, task a short name (e.g. `critique-ui`), body: what to open and the intended vibe if they said one. No approval needed.
2. Give them the launch line verbatim: `grok --session-id <uuid> --agent grok-talks:visual-qa`.
3. Do not write the critique yourself. Wait for the handoff punch list, then propose the first frontend slice.
