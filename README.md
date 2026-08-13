# grok-talks

Live Grok TUI sessions on **this machine** can see each other, talk, and stop overwriting the same file. You can also run a **squad**: one lead you talk to, plus short-lived workers that do one slice and leave.

Same machine only. The plugin never starts a second writer on a live session. Workers attach in their own terminal. Product UI/engine slices wait for **you** to type `/approve` — the model cannot approve them.

---

## Two ways to use it

| Mode | What it is | When to use it |
|---|---|---|
| **Office** | Any two (or more) Grok TUIs become coworkers | You already have two sessions in the same repo and they keep stepping on each other |
| **Squad** | One **lead** you talk to. Workers spawn for one slice, hand the result back, and retire | You want roles (planner, frontend, QA, …) without talking to each of them |

Office is the radio. Squad is the factory on top of that radio. You can use office with no squad at all.

```
  you ──► lead TUI ──► spawn worker ──► you attach that worker in another terminal
                ▲                         │
                └──── handoff (retires) ──┘
```

---

## Install

You need **Node 20+** and the **Grok CLI** (`grok` on your `PATH`).

```bash
git clone https://github.com/stdevMac/grok-talks.git
cd grok-talks
npm install
npm test          # optional, 80 tests
npm run build
grok plugin install . --trust
```

Then:

1. Enable it: `grok plugin enable grok-talks`, or open `/plugins` in a TUI and press Space on **grok-talks**.
2. **Restart every Grok TUI** you want in the office. Sessions that were already open do not load the plugin.

Optional, from this repo, so `talks` works in any shell:

```bash
npm link
```

Check it worked: open a new TUI in a project and type `/board`. You should see yourself. If the command is missing, the plugin is not enabled in that session — restart it.

---

## Office — two sessions, five minutes

Open **two** terminals in the **same repo**.

```bash
# terminal A
grok

# terminal B
grok
```

In **A**:

```
/board
```

You should see both sessions (names are the session title, or `reponame·abcd1234`).

In **A**, message B by name:

```
/talks <B's-name> I am in src/auth.ts
```

The first time A’s turn ends, the plugin asks A to start `/loop 60s` with the inbox prompt. Do that **once**. After that, an idle session hears mail within about a minute.

If both try to edit the same file while the other is *working*, the second write is **denied once**. The denied session DMs the owner, then retries. After they have talked, the retry is allowed.

Mute when you want quiet:

```
/mute
/unmute
```

That is the whole office. No lead, no roles, no approval.

### What the office is doing

```
TUI A                         TUI B
  │ hooks                       │ hooks
  │  join roster                │  join roster
  │  claim files on write       │  claim files on write
  │  deny-once on overlap       │
  └────────── MCP / files ──────┘
              ~/.grok/plugin-data/grok-talks/
                roster/   inbox/   claims/   mutes/
```

- **Board** = live sessions (pid still up, heartbeat < 2 minutes). Default: same project. `/board all` shows every project on this machine.
- **DM** = a line in the peer’s inbox. Busy peers get it at the end of their turn. Idle peers get it on the next `/loop 60s` tick.
- **Collision** = same project, same file, the other session is *working* and just touched it. Denied once. Talk, then retry.
- **Mute** = you stop hearing them. They can still write.

This plugin will not inject a prompt into another live TUI (`grok -p --resume`, tmux, ACP). Two writers on one session is unsafe. They ask each other to stop. They do not kill a turn.

---

## Squad — one lead, transient workers

You stay in **one** session: the lead. The lead does not write product code. Workers do one named slice, hand it back, and disappear.

### Roles

| Role | Job | Needs `/approve`? |
|---|---|---|
| **lead** | You talk to this one. Splits work, spawns, merges answers. | — |
| planner | Breaks the job into ordered slices. Does not implement. | no |
| explorer | Reads the repo and reports what exists. Does not edit. | no |
| frontend | Markup, motion, what the human sees. | **yes** |
| backend | Engine, state, how pieces stitch. | **yes** |
| qa | Checks that more than one role actually shipped. | no |
| validator | Rejects broken contrast, structure, names. | no |
| adversarial | Tries to break the result. | no |
| security | Keeps secrets off the bus; locks down markup. | no |

Cards live in `squad/roles/`. Matching Grok agents live in `agents/`.

### The factory loop

```
 you                lead TUI                         worker TUI
  │                    │                                  │
  │  grok --agent      │                                  │
  │   grok-talks:lead  │                                  │
  │  /squad            │ talks_squad_start (no roles)     │
  │                    │ talks_request_approval glass     │
  │  /approve glass    │  (hook records it; model cannot) │
  │                    │ talks_spawn frontend glass …     │
  │                    │  prints launch line ─────────────┼──► grok --session-id <uuid> \
  │                    │                                  │         --agent grok-talks:frontend
  │                    │                                  │  talks_role, do the slice
  │                    │  inbox: handoff + optional sha   │  talks_handoff lead
  │                    │  worker auto-retires             │  (gone from /board)
  │  see the result    │                                  │
```

Rules that keep this safe:

1. **You** type `/approve <task>` for frontend/backend. `talks_approve` is not a tool the model can call. The Stop hook nags the lead until you approve.
2. Spawn prints a **new UUID**. Attach with that exact line. Do not reuse a live session id (`grok --session-id` errors if the session already exists).
3. A worker may hand off **only to the lead**. That handoff **retires** them. `talks_retire` is only for someone stuck on the board.
4. Caps (defaults): 4 live workers; 1 planner / explorer / qa / validator / adversarial / security; 2 frontend; 2 backend. Override per project in `.grok/talks-pack.json`.

### Worked example

**Terminal 1 — you + the lead**

```bash
cd /path/to/your-project
grok --agent grok-talks:lead
```

Then, in that TUI:

```
/squad
```

The lead opens the office and waits. Ask it to ship something, for example “add a settings page.” It should:

1. Spawn a planner or explorer if it needs a slice list (no approval).
2. Call `talks_request_approval` for the frontend/backend slice.
3. Stop and tell you to approve.

You type:

```
/approve settings-ui
```

The hook records it. The lead then `talks_spawn`s and prints something like:

```
frontend    9c2f0a1b-....    grok --session-id 9c2f0a1b-.... --agent grok-talks:frontend
```

**Terminal 2 — the worker**

Paste that launch line. In that TUI the worker reads `talks_role`, does only that slice, and `talks_handoff`s the lead (add `commit` if they made one). They vanish from `/board`.

Back in terminal 1, the lead’s inbox has the result. Repeat for the next slice. You never talk to the worker.

Same thing from a shell, if you prefer the CLI (session id is the lead’s `GROK_SESSION_ID`, shown in the TUI or `/board`):

```bash
export GROK_SESSION_ID=<lead-session-id>

talks squad
talks request-approval settings-ui
talks approve settings-ui
talks spawn frontend settings-ui "own the settings page"
# → frontend	<uuid>	grok --session-id <uuid> --agent grok-talks:frontend

talks board
talks inbox
```

If you did not `npm link`, use `node /path/to/grok-talks/dist/cli.js` instead of `talks`.

### Standing roles (escape hatch)

Default `/squad` starts **no** workers. That is what you want.

If you really want bodies already on the board:

```
/squad planner,qa
# or
/squad all
```

Those sessions still need a human to attach each launch line. They stay until they hand back to the lead (or you `talks_retire` them). Prefer spawn-per-slice.

### Project caps

Create `.grok/talks-pack.json` in the project to raise (or tighten) limits. Only positive numbers apply; anything else is ignored.

```json
{
  "maxTransient": 6,
  "perRole": {
    "frontend": 3,
    "planner": 1
  }
}
```

---

## Slash commands (in a Grok TUI)

| Command | Who | What |
|---|---|---|
| `/board` | anyone | Live coworkers in this project |
| `/board all` | anyone | Every live session on this machine |
| `/talks <name> <message>` | anyone | DM a session (name or id) |
| `/mute` / `/unmute` | anyone | Silence everyone, or a peer |
| `/squad` | lead | Open the office (no standing workers) |
| `/squad planner,qa` | lead | Standing escape hatch |
| `/approve <task>` | **you**, in the lead TUI | Unlock a frontend/backend spawn |

The model also gets MCP tools: `talks_board`, `talks_say`, `talks_inbox`, `talks_mute`, `talks_status`, `talks_squad_start`, `talks_role`, `talks_handoff`, `talks_spawn`, `talks_retire`, `talks_request_approval`. There is **no** `talks_approve`.

---

## CLI

Needs `GROK_SESSION_ID` (the session that is “you”).

```bash
export GROK_SESSION_ID=<session-id>
talks board
talks board --all
talks send <name-or-id> hello
talks inbox
talks inbox --drain
talks mute
talks unmute
talks squad
talks squad planner,qa
talks role
talks request-approval <task> [note]
talks approve <task>
talks spawn <role> <task> [body...] [--cwd <dir>]
talks handoff <to> <task> <body...> [--commit <sha>]
talks retire <worker-session-id>
```

`--commit` must be a 7–40 character hex sha.

---

## Pulse Lantern

A dummy neon sign built by a full squad on the bus: spawn, collide on `sign.html`, hand off, auto-retire. The board ends lead-only. The page is `examples/pulse-lantern/out/index.html`.

```bash
npm run demo
open examples/pulse-lantern/out/index.html
```

---

## If something feels stuck

| Symptom | What to do |
|---|---|
| `/board` is missing | Plugin not enabled in **this** session. Enable, then restart that TUI. |
| `/board` is only you | The other TUI was open before install, or it is in another project (`/board all`). |
| Worker never appears | You must attach the **printed** `grok --session-id <uuid> --agent grok-talks:<role>` line in a new terminal. |
| `grok --session-id` errors | That UUID already exists. Use the id spawn just printed, not an old one. |
| Spawn says it needs approval | In the **lead** TUI type `/approve <task>` (same task name). Do not ask the model to approve. |
| Idle peer never hears DMs | On their first Stop, let them start `/loop 60s` with the inbox prompt. Once. |
| Worker still on the board | They have not handed back, or they died. Lead can `talks_retire <id>`. Stale pids/heartbeats are GC’d on the next `/board` or Stop. |
| Writes keep getting denied | DM the named peer (`/talks`), then retry **once**. Deny is once per claim. |
| Want them quiet | `/mute` in your session. |

---

## Limits (by design)

- **This machine only.** The bus is files under `~/.grok/plugin-data/grok-talks/` (or `$GROK_PLUGIN_DATA`).
- **No remote kill.** Sessions ask; they do not SIGKILL each other.
- **No second writer** on a live TUI. Idle wake is `/loop 60s`, not `grok -p --resume`.
- A spawned roster row uses the lead’s pid until that UUID TUI attaches.
- Chat is rate-limited to 10 DMs per peer per minute.

---

## Tests and layout

```bash
npm test          # CI
npm run build
npm run demo      # Pulse Lantern only
```

| Path | What |
|---|---|
| `src/bus/` | Roster, inbox, claims, collisions, squad lifecycle |
| `src/hooks/` | Join, claims, deny-once, `/approve`, Stop drain + loop nag |
| `src/mcp/` | Tools the model calls |
| `src/cli.ts` | `talks` / `grok-talks` |
| `squad/` | Constitution, role cards, contracts, caps |
| `agents/` | Grok agents (`grok --agent grok-talks:lead`, …) |
| `commands/` | `/board` `/talks` `/mute` `/squad` `/approve` |
| `skills/` | Coworker manners for the model |
| `examples/pulse-lantern/` | Dummy factory run |

The long design note is `docs/superpowers/specs/2026-08-13-grok-talks-design.md`. The two-TUI manual checklist is §12.17 there.
