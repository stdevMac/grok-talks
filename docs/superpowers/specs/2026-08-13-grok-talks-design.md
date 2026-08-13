# Grok Talks — coworker office for live Grok sessions

Date: 2026-08-13
Status: draft, awaiting review
Repo: `grok-talks`

## 1. Problem

Several Grok TUI sessions often run at once on the same machine, sometimes in the same repo. They cannot see each other. They overwrite the same files. They cannot ask a peer to stop.

Grok already has parent–child subagents, a dashboard for the human, and headless resume. None of those is peer talk between live TUIs.

## 2. Goal

Live Grok TUI sessions on one machine act like coworkers:

- They see who else is running and what that session is working on.
- In the same project they coordinate and back off when they would collide.
- They talk on their own. The human can mute or jump in.
- Idle sessions wake. Busy sessions queue mail until the turn ends.

They ask each other to stop. They do not kill another session’s turn.

## 3. Non-goals (v1)

- Instant inject into another TUI (ACP `session/prompt`, `grok -p --resume` on a live id, tmux send-keys). Two writers on one session are unsafe.
- Remote machines.
- Named Slack-style rooms beyond “this project is the office.”
- Spawning a role squad (planner, frontend, backend, QA, validator, adversarial). That is v2 on this same bus.
- Force-stop, remote `/exit`, or writing another session’s files.

## 4. Approach

A trusted Grok plugin. Four parts, one job each:

| Part | Job |
|---|---|
| Hooks | Join/leave, publish file claims, nag on overlap, dump queued mail when a turn ends. Runs when the model is not thinking. |
| Local bus | JSON files under the plugin data dir. Roster, claims, inbox, mutes. |
| MCP tools | How an agent reads the board, speaks, mutes, sets status. |
| Skill + slash commands | Coworker manners for the model. `/board`, `/mute`, `/talks` for the human. |

Same machine only. The roster is global. Claims and collision nags apply only when project roots match. Chat may address any live session on the machine.

## 5. Architecture

```
 TUI A (payverge)     TUI B (payverge)     TUI C (other repo)
        │                    │                    │
        │  hooks + MCP       │                    │
        └──────────┬─────────┴──────────┬─────────┘
                   ▼                    ▼
        $GROK_PLUGIN_DATA/   (fallback: ~/.grok/plugin-data/grok-talks/)
          roster/<session-id>.json
          claims/<session-id>.json
          inbox/<session-id>.jsonl
          inbox/<session-id>.read        # delivered message ids
          mutes/<session-id>.json
          denies/<session-id>.json       # deny-once keys
          talked/<session-id>.json       # peers we talks_say'd
          loop-armed/<session-id>        # marker that /loop was requested
```

The bus is a small library. Hooks, the MCP server, and the CLI are thin adapters. Tests target the library with a temp data dir.

Idle wake does not open a second writer. After a turn, if the session has project peers and no talks loop in `sessionCrons`, the Stop hook tells the agent to start `/loop 60s` to check the inbox. Worst case an idle coworker hears mail within about a minute.

## 6. Identity

Every session is one coworker:

| Field | Source |
|---|---|
| `session_id` | `GROK_SESSION_ID` |
| `name` | Session title from `summary.json` when readable, else `{repo-basename}·{first 8 of id}` |
| `cwd` | `GROK_WORKSPACE_ROOT` / hook `workspaceRoot` |
| `project` | Resolved project root (git root when present, else `cwd`) |
| `pid` | `~/.grok/active_sessions.json` entry for this `session_id`; else the hook’s parent pid |
| `muted` | This session’s mute file |
| `working_on` | Last user prompt, trimmed to 200 characters, or `talks_status` |
| `heartbeat_at` | Last successful roster write |
| `state` | `working` during a turn (UserPromptSubmit → Stop), else `idle` |

A reader treats a session as gone when its pid is dead or `heartbeat_at` is older than 2 minutes. `SessionEnd` deletes that session’s roster and claims files.

## 7. Bus records

### 7.1 `roster/<session-id>.json`

Only that session writes this file.

```json
{
  "session_id": "019ff935-8a34-7640-accf-e0ac2a3ea1e3",
  "name": "payverge·auth-fix",
  "cwd": "/Users/maceo/payverge",
  "project": "/Users/maceo/payverge",
  "pid": 81569,
  "working_on": "Fix token refresh race",
  "state": "working",
  "heartbeat_at": "2026-08-13T12:00:00Z",
  "plugin_version": "1"
}
```

### 7.2 `claims/<session-id>.json`

```json
{
  "session_id": "019ff935-8a34-7640-accf-e0ac2a3ea1e3",
  "project": "/Users/maceo/payverge",
  "paths": [
    { "path": "/Users/maceo/payverge/src/auth.ts", "last_at": "2026-08-13T12:00:00Z" }
  ]
}
```

Paths are absolute. A claim expires 10 minutes after `last_at`. The whole file goes away on leave.

`PostToolUse` on write/edit refreshes `last_at`. `PreToolUse` on write/edit may add a provisional claim so a peer that starts the same file in the same second still sees overlap.

### 7.3 `inbox/<session-id>.jsonl`

Append-only. One JSON object per line:

```json
{
  "id": "01J…",
  "ts": "2026-08-13T12:00:00Z",
  "from": "<session-id>",
  "from_name": "payverge·auth-fix",
  "kind": "chat",
  "project": "/Users/maceo/payverge",
  "body": "I'm in src/auth.ts — don't overwrite the token refresh.",
  "paths": ["src/auth.ts"]
}
```

`kind` is `chat` or `collision`. `system` is reserved and unused in v1 (no join/leave spam). Readers skip a torn line.

Delivery does not rewrite the JSONL. `inbox/<session-id>.read` is a JSON array of message ids. Drain and `mark_read` only append ids to that file. Unmute still sees undelivered lines because muted mail is never added to `.read`.

Collision coalesce stays append-only: a second undelivered collision on the same `(from, to, path)` appends another line; readers treat the newest undelivered line as the one to deliver and mark all of that key’s ids read together.

### 7.4 `mutes/<session-id>.json`

```json
{ "all": false, "peers": ["<session-id>"] }
```

`all: true` mutes every sender. The bus still appends mail. Delivery and wake skip muted senders. Collision events are still recorded.

### 7.5 `denies/<session-id>.json` and `talked/<session-id>.json`

Hooks are separate processes, so deny-once cannot live in memory.

`denies/<session-id>.json` is an array of `{peer, path, claim_last_at}` written when we deny. A later PreToolUse allows when this key matches.

`talked/<session-id>.json` is `{ "<peer-id>": "<iso-time>" }`. Any successful `talks_say` to that peer updates it. A matching entry allows a retry even if the deny key is still present.

## 8. Loops

### 8.1 Join / leave

- `SessionStart`: write roster (`state: idle`), create empty claims, do not start a turn.
- `SessionEnd`: delete roster and claims. Leave inbox and mutes (history).
- Any reader: ignore roster files whose pid is dead or heartbeat is older than 2 minutes.

### 8.2 Status

- `UserPromptSubmit`: set `working_on` from the prompt (trim to 200 characters), set `state: working`, heartbeat.
- `PostToolUse` on write/edit: refresh claims and heartbeat.
- `talks_status`: overwrite `working_on` with the agent’s one-liner (same 200 character cap).

### 8.3 Talk

`talks_say` or `/talks <name-or-id> <body>` appends one inbox line for the target. It does not write into the other TUI.

Addressing: session id, unique `name`, or unique `{repo}·{short-id}`. Ambiguous names fail with the matching ids. There is no broadcast `*` in v1.

### 8.4 Busy delivery

On `Stop` with `reason == "end_turn"`:

1. Heartbeat. Set `state: idle` only if we allow the stop.
2. Load inbox lines whose id is not in `.read` and whose sender is not muted, oldest first, cap 8.
3. If any: append those ids to `.read`, return Stop feedback that lists them, keep `state: working` for the continuation.
4. If none: allow stop, `state: idle`.

Grok caps Stop continuations at 8 per turn. Remaining unread mail waits for the next turn or the `/loop`.

Ignore Stop when `reason` is not `end_turn` (session-end observe fire).

### 8.5 Idle delivery

After a delivered-or-empty `end_turn`, if all of these hold:

- at least one other live session shares this `project`
- `sessionCrons` has no talks inbox loop
- this session is not mute-all

then Stop `additionalContext` tells the agent to start `/loop 60s` that only checks the inbox and replies when there is mail. Write `loop-armed/<session-id>` so we do not nag every turn if the agent ignores us once; remind again only after 10 minutes with still no cron.

We never call `grok -p --resume` on a live id. We never attach a second ACP client to inject a prompt.

### 8.6 Collision (same project only)

Compare the intended write path (normalized absolute) to other *live* sessions’ unexpired claims.

| Other session | Action |
|---|---|
| `working`, claimed this path in the last 10 minutes, not muted by us | **Deny once.** PreToolUse `{decision: "deny", reason: …}` names the peer and tells the agent to `talks_say` before retrying. Record a `collision` line in both inboxes. |
| `idle`, claimed this path | **Allow.** Append `collision` mail to the idle peer. They wake via `/loop` or next turn. |
| Claim expired, peer gone, or we already denied this path for this peer claim | **Allow.** |
| Cross-project | **Allow.** No collision mail. |

“Deny once” is keyed by `(us, them, path, them.last_at)` and stored in `denies/<us>.json`. A retry is allowed when that key is already stored, or `talked/<us>` has that peer, or 10 minutes have passed, or the claim’s `last_at` changed (new key).

They ask each other to stop. Nothing cancels the other turn.

### 8.7 Mute

`/mute`, `/mute <peer>`, `/unmute`, or `talks_mute`. Delivery and wake skip those senders. Collisions still record. A muted peer does not get deny-once against us if we muted them; we chose to ignore them.

### 8.8 Human

- `/board` — live roster (name, project, state, working_on, claimed files).
- `/talks <name-or-id> <body>` — send a chat line.
- `/mute` / `/unmute` — as above.

Inbound talk already appears in the receiving transcript via Stop feedback.

## 9. MCP tools

| Tool | Effect |
|---|---|
| `talks_board` | Live coworkers. Optional `scope`: `project` (default) or `all`. |
| `talks_say` | Append chat to one peer’s inbox. |
| `talks_inbox` | Unread mail for this session. Optional `mark_read`. |
| `talks_mute` | Set mute all or one peer; or unmute. |
| `talks_status` | Set `working_on`. |

The skill tells the model when to look, when to talk, when to back off, and not to spam.

## 10. Safety and failure

Hooks fail open. A crashed hook, missing data dir, or dead MCP server must not block an edit or a stop. Only a healthy bus, a live working peer, and a fresh claim produce a collision deny.

Spam: max 10 chat lines per sender→receiver per rolling 60 seconds. Extra `talks_say` calls return an error to the caller and do not append. Collision mail may append more than once per `(from, to, path)`; drain delivers the newest undelivered line for that key and marks the whole key read.

Secrets: board and roster store session id, cwd, paths, and text someone chose to send. Prompts and status truncate to 200 characters. No env, tokens, or raw hook payloads.

Concurrency: each session writes only its own roster, claims, and mutes files. Inbox is append-only. Readers skip torn JSON and treat that peer as unknown.

Install: `grok plugin install <path> --trust`. Hooks and MCP stay inert without trust.

## 11. Plugin layout

```
grok-talks/                     # this repo is the plugin (and its marketplace later)
  plugin.json
  hooks/hooks.json
  hooks/bin/session-start
  hooks/bin/session-end
  hooks/bin/prompt-submit
  hooks/bin/pre-tool-use
  hooks/bin/post-tool-use
  hooks/bin/stop
  .mcp.json
  skills/grok-talks/SKILL.md
  commands/board.md
  commands/talks.md
  commands/mute.md
  src/                          # bus library + MCP + hook CLIs
  tests/
```

Exact language and package layout are an implementation choice. The adapters must stay thin so the test matrix below can run without a TUI.

## 12. Testing

CI runs without a Grok TUI, without network, and without the user’s `~/.grok/sessions`. Every test sets `GROK_PLUGIN_DATA` (or the library’s data-dir argument) to a temp directory and injects a fake clock plus a pid-liveness function.

The bus library is the system under test. Hook binaries and the MCP server are tested with fixture stdin / JSON-RPC. A small in-process fake of two sessions covers integration.

### 12.1 Layers

| Layer | What it proves | Runs in CI |
|---|---|---|
| Bus unit | Roster, claims, inbox, mute, collision policy, rate limits | Yes |
| Hook adapters | Each hook event fixture → expected stdout / files | Yes |
| MCP adapters | Each tool: valid args, errors, side effects | Yes |
| Two-session fake | A and B in one process, shared temp bus | Yes |
| Concurrency | Parallel appends and torn reads | Yes |
| Fail-open | Corrupt / missing / thrown errors never deny or block-stop | Yes |
| CLI smoke | `board`, send, drain, mute against fixture files | Yes |
| Manual two-TUI | Real Groks after install | No (checklist) |

### 12.2 Clock, pid, and path fakes

- Time is an injected `now()`. Expiry, rate limits, heartbeat, and deny-once keys must not use wall clock in tests.
- `is_alive(pid)` is injected. Tests cover alive, dead, and “pid reused” (roster pid number exists but we treat it as dead when the caller says so).
- Paths go through one `normalize(path, cwd)` used by claims and collision. Tests include relative paths, `.` / `..`, and duplicate slashes. Symlink canonicalization is best-effort: if the realpath call fails, compare the normalized lexical path and still fail open.

### 12.3 Roster and presence

- `SessionStart` creates roster + empty claims.
- Heartbeat updates `heartbeat_at` and does not clobber `working_on` unless status also changes.
- `state` flips to `working` on UserPromptSubmit and to `idle` only when Stop allows the stop.
- Dead pid ⇒ peer hidden on board and ignored for collision, even if the file is fresh.
- Heartbeat older than 2 minutes ⇒ same as dead.
- Heartbeat at 1:59 still live; at 2:00 gone (boundary).
- `SessionEnd` deletes roster and claims; inbox and mutes remain.
- Crashed session (no SessionEnd) disappears via pid/heartbeat, not via a leftover file forever.
- Two sessions in different projects both appear when board scope is `all`.
- Board scope `project` hides other roots.
- Name fallback `{repo}·{short-id}` when `summary.json` is missing.
- Name prefers session title when `summary.json` is readable.
- Stale title is refreshed on SessionStart and on Stop, not on every tool call.
- Missing data dir: create it; if create fails, fail open.

### 12.4 Claims

- Write/edit PostToolUse adds/refreshes an absolute path and `last_at`.
- PreToolUse inserts a provisional claim before the deny check so two simultaneous first-writes collide.
- Same path written again refreshes `last_at` (deny-once key changes).
- Claim older than 10 minutes is ignored. Boundary: 9:59 live, 10:00 dead.
- SessionEnd or dead peer ⇒ claims unused even if the file still exists until GC.
- Two paths in one session: collision is per path, not per session.
- Directory vs file: claiming `src/auth.ts` does not collide with `src/auth.ts.bak` or `src/auth.tsx`. No prefix matching in v1.
- Cross-project same relative path (`src/auth.ts` in two repos) does not collide.

### 12.5 Collision policy

- Working peer, fresh claim, same project ⇒ PreToolUse deny + collision mail both ways.
- Reason string includes peer `name`, `session_id`, and path.
- Idle peer, fresh claim ⇒ allow + collision mail to the idle peer only.
- Expired claim ⇒ allow, no mail.
- Peer gone ⇒ allow, no mail.
- Cross-project ⇒ allow, no mail, no deny.
- Mute-all or muted peer: no deny-once against that peer; collision still appended (recorded, not delivered).
- Deny-once: second PreToolUse for the same `(us, them, path, them.last_at)` allows (key present in `denies/`).
- After we `talks_say` that peer (`talked/` updated), retry allows even if `last_at` is unchanged.
- Deny-once survives a new hook process (disk, not memory).
- After 10 minutes, retry allows.
- If they write again (`last_at` changes), deny-once resets.
- Fail-open: unreadable claims file, unreadable roster, thrown normalize error ⇒ allow.
- Read-only tools (read, grep, list) never claim and never deny.
- Shell commands: v1 only inspects tools that carry an explicit file path (write/edit). Raw `run_terminal_command` is not parsed for redirects. Documented limitation; a test locks that we do not false-deny `npm test`.

### 12.6 Inbox and talk

- `talks_say` appends one valid JSON line.
- Addressing by full id works.
- Addressing by unique name works.
- Two peers with the same name ⇒ error listing both ids, no append.
- Unknown name/id ⇒ error, no append.
- No `*` broadcast (rejected).
- Body empty or whitespace ⇒ error.
- Body can be multiline; JSONL stays one object per line.
- Unread listing is oldest first.
- `mark_read` / Stop delivery appends those ids to `.read` only.
- Cap 8 per drain; the 9th stays unread for the next drain.
- Torn line in the middle: skip it, still read the good lines after.
- Mute peer: line is appended, drain does not return it, it does not count toward the 8.
- Mute-all: same.
- Unmute: subsequent drain returns those still-undelivered lines (they were never added to `.read`).
- `.read` is a JSON array of ids; a torn `.read` is treated as empty (fail open: may redeliver, never drop mail).
- Rate limit: 10 chat lines per sender→receiver per 60 seconds; 11th errors; a 61st second later succeeds. Collision and system kinds do not consume the chat quota.
- Collision coalesce: a second collision on the same `(from, to, path)` may append; drain returns only the newest undelivered line for that key and marks every id of that key read.
- After those ids are in `.read`, a new collision may be delivered again.
- Chat does not coalesce.

### 12.7 Stop hook

- `reason != "end_turn"` ⇒ exit 0, no drain, no state flip.
- Empty unread (or only muted) ⇒ allow stop, `state: idle`.
- Unread present ⇒ block/feedback with those lines, mark delivered, keep `state: working`.
- Feedback text is readable without JSON: who, kind, body, paths.
- Hook crash or invalid stdout ⇒ Grok fail-open (we still unit-test that our binary exits 0 with no deny JSON on internal errors).
- `stopHookActive` already true and inbox empty ⇒ allow stop (do not re-arm a loop solely because we continued).
- Loop arm: peers in project, no matching `sessionCrons`, not mute-all, no fresh `loop-armed` marker ⇒ additionalContext asks for `/loop 60s`.
- Loop arm: `sessionCrons` already has the talks loop ⇒ do not ask again.
- Loop arm: `loop-armed` younger than 10 minutes and still no cron ⇒ do not nag every turn.
- Loop arm: `loop-armed` older than 10 minutes and still no cron ⇒ ask once more and refresh the marker.
- No project peers ⇒ never ask for `/loop`.
- Session-end Stop must not arm a loop.

### 12.8 Idle `/loop` contract

The loop prompt (skill + additionalContext) is fixed:

- Call `talks_inbox`.
- If empty, do nothing else.
- If mail, reply with `talks_say` only when coordination is needed (collision or a direct question). No “got it” / “just checking in.”
- Do not start extra loops.
- Do not spawn subagents for mail.

Tests for this are skill/prompt fixtures (the exact prompt string is golden) plus a two-session fake that runs the drain function the loop would call. We do not assert a live `/loop` inside CI.

### 12.9 Mute

- Mute one peer, mute all, unmute one, unmute all.
- Mute file missing ⇒ treat as unmuted.
- Torn mute file ⇒ fail open (treat as unmuted, do not deny).
- Mute does not delete inbox history.

### 12.10 MCP adapters

For each tool: happy path, missing required args, unknown session, rate limit error shape, and that the tool does not throw (returns an error object).

- `talks_board` default scope is `project`.
- `talks_board` `all` includes other projects and never includes dead/stale peers.
- `talks_inbox` without `mark_read` does not write `.read`.
- Tools identify “this session” from `GROK_SESSION_ID`. Missing env ⇒ error, no writes.

### 12.11 Hook adapters (stdin fixtures)

One fixture JSON per event, golden stdout + resulting files:

| Event | Cases |
|---|---|
| SessionStart | new session; resume (`matcher` source); data dir created |
| SessionEnd | deletes roster/claims; leaves inbox |
| UserPromptSubmit | truncates to 200; empty prompt leaves previous status |
| PreToolUse write | deny-once, allow idle, allow cross-project, allow read tools, fail-open on bad JSON stdin |
| PostToolUse write | claim refresh; ignore non-write tools |
| Stop end_turn | drain, arm loop, allow empty |
| Stop other reason | no-op |

Unknown tool names fail open. Claude aliases (`Edit`, `Write`) map to the same write path as Grok’s edit/write tools.

### 12.12 Two-session fake (in-process)

A tiny harness creates sessions A and B with controlled clock and pids.

1. Same project: both on board.
2. A working claim `src/auth.ts`; B writes it ⇒ deny; both inboxes have `collision`.
3. B `talks_say`s A; B retries write ⇒ allow.
4. A goes idle; B writes `src/auth.ts` ⇒ allow; A inbox `collision`; A drain returns it.
5. A mute B; B `talks_say` ⇒ A drain empty; file still has the line.
6. Different projects, same relative path ⇒ B write allowed, no collision mail.
7. A pid marked dead; B writes A’s claimed path ⇒ allow.
8. Clock +10 minutes; B writes ⇒ allow (expired).
9. B sends 11 chats in one minute ⇒ 11th errors; A drain has 10.
10. A Stop drains 8 of 10; next Stop drains 2.
11. A and B append to A’s inbox at the same time (threads/processes) ⇒ both lines survive, valid JSONL.
12. Corrupt B’s roster JSON; A board still shows A; A write is allowed (fail open).

### 12.13 Concurrency and filesystem

- 50 parallel appends to one inbox: 50 valid lines, no lost write.
- Roster replace is atomic (write temp + rename). A reader never sees empty/partial roster from a mid-write.
- Reader during rename: either old or new JSON, never crash.
- Permissions: data dir not writable ⇒ hooks exit 0 with no deny/block JSON.

### 12.14 Fail-open battery

Each of these must yield “allow / do not block stop / board omits the bad peer”:

- Missing `GROK_SESSION_ID`
- Missing `GROK_PLUGIN_DATA` parent not writable
- Zero-byte roster, claims, mute, inbox
- Inbox line that is not JSON
- Inbox line that is JSON but missing `id` / `from`
- Roster `pid` not a number
- Clock injection throwing
- Path normalize throwing
- Disk full simulated on append (write error) — `talks_say` returns an error; PreToolUse still allows

### 12.15 CLI smoke

Scripted against a fixture data dir, no TUI:

- `board` prints two live peers and hides a stale one
- `talks send` then `inbox` shows the line
- `mute` then `inbox --drain` hides it
- `talks send` unknown id exits non-zero

### 12.16 What CI does not run

- Two real Grok TUI processes
- Real `/loop` scheduling inside Grok
- ACP or `grok -p --resume` inject (forbidden in v1)
- v2 squad spawn

### 12.17 Manual two-TUI checklist (after install)

Run only on a throwaway clone or with files you can discard.

1. `grok plugin install . --trust` and enable the plugin. Restart two TUIs in the **same** repo.
2. `/board` in each shows the other (name, project, idle/working).
3. In A: ask it to edit `scratch/talks-a.txt` only. In B: ask it to edit the same path while A is still working. B should refuse once, name A, and offer to talk.
4. Let B message A. Retry the edit on B. It should proceed.
5. Stop A (idle). Edit the path from B. A should, within about a minute after its loop is armed, surface a collision message.
6. First turn in a fresh session in that repo: after the turn, the agent should start the 60s inbox loop (visible in Stop / `/loop` / dashboard “loops still running”).
7. `/mute` in A. Chat from B must not appear in A. `/unmute` restores delivery.
8. Open C in a **different** repo. `/board` scope all shows C. C editing `scratch/talks-a.txt` in its own repo must not deny A or B.
9. Kill B’s process (`kill -9`). Within 2 minutes (or immediately on pid check), A’s board drops B. A may edit B’s old paths.
10. Disconnect MCP / break the data dir permissions. A write still works (fail open).
11. Human `/talks <B> hello` appears in B’s next drain or loop.
12. Confirm neither session launched `grok -p --resume` against the other (no second writer).

### 12.18 Coverage bar

Merge v1 only when:

- All CI layers above pass.
- Collision policy table in §8.6 has a test per cell.
- Fail-open battery is green.
- Manual checklist 1–8 and 11–12 have been run once on macOS and noted in the PR. Items 9–10 are required before calling the plugin trusted-default.

## 13. Version 2 (parked)

Same bus. New kind of coworker.

The human talks to one lead session. The lead starts (or is given) full TUI sessions with roles: planner, explorer, frontend, backend, QA, validator, adversarial, security. They coordinate over roster/inbox/claims. Collision nags still fire when two roles touch the same file.

v2 is out of scope until v1’s bus, deny-once, mute, and idle `/loop` arm exist.

## 14. Success

Two Groks in one repo see each other, talk, and stop stepping on the same file without the human relaying. A third Grok in another repo is visible and silent on collisions. A dead or muted peer does not nag. A broken plugin does not freeze Grok.
