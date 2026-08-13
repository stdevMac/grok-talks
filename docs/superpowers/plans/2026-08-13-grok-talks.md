# Grok Talks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a trusted Grok plugin so live TUI sessions on one machine see each other, talk, and deny-once when they would overwrite the same file.

**Architecture:** A TypeScript bus library owns roster, claims, inbox, mute, deny-once, and collision policy. Hook binaries, an MCP server, and a CLI are thin adapters over `TalksBus`. Idle wake is a Stop-hook request to start `/loop 60s`, never a second writer on a live session.

**Tech Stack:** TypeScript, Node 20+, vitest, `@modelcontextprotocol/sdk`, zod. `tsc` emits `dist/` for hooks and MCP. Tests run TypeScript directly via vitest.

**Spec:** `docs/superpowers/specs/2026-08-13-grok-talks-design.md`

---

## File map

| Path | Responsibility |
|---|---|
| `src/bus/types.ts` | Shared types and constants |
| `src/bus/clock.ts` | `Clock`, `PidCheck`, production defaults |
| `src/bus/paths.ts` | Data-dir layout |
| `src/bus/fs.ts` | Atomic JSON write, JSONL append, torn-safe reads |
| `src/bus/normalize.ts` | Path normalize + project root |
| `src/bus/names.ts` | Display name + `summary.json` title |
| `src/bus/roster.ts` | Presence read/write, liveness |
| `src/bus/claims.ts` | File claims + TTL |
| `src/bus/inbox.ts` | JSONL mail + `.read` cursor |
| `src/bus/mutes.ts` | Mute all / one peer |
| `src/bus/denies.ts` | Deny-once keys |
| `src/bus/talked.ts` | Peers we already messaged |
| `src/bus/rateLimit.ts` | 10 chats / 60s per pair |
| `src/bus/collision.ts` | Policy table |
| `src/bus/loop.ts` | Loop prompt + arm decision |
| `src/bus/talks.ts` | `TalksBus` facade |
| `src/hooks/events.ts` | Hook stdin types + write-tool detection |
| `src/hooks/handle.ts` | Dispatch + fail-open wrapper |
| `src/hook.ts` | Hook CLI entry |
| `src/mcp.ts` | MCP stdio server |
| `src/cli.ts` | `board` / `send` / `inbox` / `mute` |
| `hooks/hooks.json` | Plugin hook registration |
| `.mcp.json` | Plugin MCP server |
| `plugin.json` | Plugin manifest |
| `skills/grok-talks/SKILL.md` | Coworker manners |
| `commands/board.md` | `/board` |
| `commands/talks.md` | `/talks` |
| `commands/mute.md` | `/mute` |
| `tests/helpers.ts` | Fake clock, temp bus |
| `tests/bus/*.test.ts` | Library tests |
| `tests/hooks/*.test.ts` | Hook fixtures |
| `tests/mcp/*.test.ts` | Tool adapters |
| `tests/fake/*.test.ts` | Two-session scenarios |
| `tests/failopen/*.test.ts` | Fail-open battery |
| `tests/cli/*.test.ts` | CLI smoke |

Do not implement v2 squad spawn. Do not call `grok -p --resume` on a live session.

---

### Task 1: Scaffold the package

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`
- Create: `src/bus/types.ts`

- [ ] **Step 1: Write package files**

`package.json`:

```json
{
  "name": "grok-talks",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "grok-talks": "dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.12.1",
    "zod": "^3.24.2"
  },
  "devDependencies": {
    "@types/node": "^22.13.10",
    "typescript": "^5.8.2",
    "vitest": "^3.0.9"
  }
}
```

`tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "Node16",
    "moduleResolution": "Node16",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "declaration": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
});
```

`.gitignore`:

```
node_modules/
dist/
coverage/
.DS_Store
```

`src/bus/types.ts`:

```ts
export type SessionId = string;
export type IsoTime = string;
export type MailKind = "chat" | "collision";
export type SessionState = "working" | "idle";
export type BoardScope = "project" | "all";

export const PLUGIN_VERSION = "1" as const;
export const HEARTBEAT_MS = 2 * 60 * 1000;
export const CLAIM_TTL_MS = 10 * 60 * 1000;
export const CHAT_RATE = 10;
export const CHAT_WINDOW_MS = 60 * 1000;
export const DRAIN_CAP = 8;
export const STATUS_MAX = 200;
export const LOOP_NAG_MS = 10 * 60 * 1000;

export interface RosterEntry {
  session_id: SessionId;
  name: string;
  cwd: string;
  project: string;
  pid: number;
  working_on: string;
  state: SessionState;
  heartbeat_at: IsoTime;
  plugin_version: typeof PLUGIN_VERSION;
}

export interface ClaimPath {
  path: string;
  last_at: IsoTime;
}

export interface ClaimsFile {
  session_id: SessionId;
  project: string;
  paths: ClaimPath[];
}

export interface Mail {
  id: string;
  ts: IsoTime;
  from: SessionId;
  from_name: string;
  kind: MailKind;
  project: string;
  body: string;
  paths: string[];
}

export interface MuteFile {
  all: boolean;
  peers: SessionId[];
}

export interface DenyKey {
  peer: SessionId;
  path: string;
  claim_last_at: IsoTime;
}

export type TalkedFile = Record<SessionId, IsoTime>;

export interface Clock {
  now(): Date;
}

export interface PidCheck {
  isAlive(pid: number): boolean;
}

export interface BusDeps {
  dataDir: string;
  clock: Clock;
  pid: PidCheck;
  grokHome?: string;
}

export interface SessionCron {
  id?: string;
  schedule?: string;
  prompt?: string;
}
```

- [ ] **Step 2: Install and typecheck**

Run:

```bash
cd /Users/maceo/blockvantage/grok-talks
npm install
npx tsc -p tsconfig.json --noEmit
```

Expected: `tsc` exits 0 (or only complains if `src` is empty of imports — `types.ts` has no errors).

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json tsconfig.json vitest.config.ts .gitignore src/bus/types.ts
git commit -m "chore: scaffold grok-talks TypeScript package"
```

---

### Task 2: Filesystem helpers and path layout

**Files:**
- Create: `src/bus/clock.ts`
- Create: `src/bus/paths.ts`
- Create: `src/bus/fs.ts`
- Create: `tests/helpers.ts`
- Create: `tests/bus/fs.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/helpers.ts`:

```ts
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BusDeps, Clock, PidCheck } from "../src/bus/types.js";

export function iso(d: Date): string {
  return d.toISOString();
}

export function tempDir(prefix = "talks-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function fakeClock(start = new Date("2026-08-13T12:00:00.000Z")): Clock & {
  time: Date;
  advance: (ms: number) => void;
} {
  const clock = {
    time: start,
    now: () => clock.time,
    advance: (ms: number) => {
      clock.time = new Date(clock.time.getTime() + ms);
    },
  };
  return clock;
}

export function fakePid(alive: Iterable<number> = [100, 200, 300]): PidCheck & {
  alive: Set<number>;
} {
  const set = new Set(alive);
  return {
    alive: set,
    isAlive: (pid: number) => set.has(pid),
  };
}

export function deps(overrides: Partial<BusDeps> = {}): BusDeps & {
  clock: ReturnType<typeof fakeClock>;
  pid: ReturnType<typeof fakePid>;
} {
  const clock = (overrides.clock as ReturnType<typeof fakeClock>) ?? fakeClock();
  const pid = (overrides.pid as ReturnType<typeof fakePid>) ?? fakePid();
  return {
    dataDir: overrides.dataDir ?? tempDir(),
    clock,
    pid,
    grokHome: overrides.grokHome,
  };
}
```

`tests/bus/fs.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../../src/bus/fs.js";
import { tempDir } from "../helpers.js";

describe("fs helpers", () => {
  it("writes json atomically and reads it back", () => {
    const dir = tempDir();
    const file = path.join(dir, "roster", "a.json");
    writeJsonAtomic(file, { n: 1 });
    expect(readJson<{ n: number }>(file)).toEqual({ n: 1 });
  });

  it("returns undefined for missing or torn json", () => {
    const dir = tempDir();
    const file = path.join(dir, "bad.json");
    expect(readJson(file)).toBeUndefined();
    fs.writeFileSync(file, "{");
    expect(readJson(file)).toBeUndefined();
    fs.writeFileSync(file, "");
    expect(readJson(file)).toBeUndefined();
  });

  it("appends jsonl and skips torn lines", () => {
    const dir = tempDir();
    const file = path.join(dir, "inbox", "a.jsonl");
    appendJsonl(file, { id: "1" });
    fs.appendFileSync(file, "not-json\n");
    appendJsonl(file, { id: "2" });
    expect(readJsonl<{ id: string }>(file).map((x) => x.id)).toEqual(["1", "2"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bus/fs.test.ts`

Expected: FAIL — `Cannot find module '../../src/bus/fs.js'`

- [ ] **Step 3: Write minimal implementation**

`src/bus/clock.ts`:

```ts
import type { Clock, PidCheck } from "./types.js";

export const systemClock: Clock = {
  now: () => new Date(),
};

export const systemPid: PidCheck = {
  isAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

export function toIso(d: Date): string {
  return d.toISOString();
}
```

`src/bus/paths.ts`:

```ts
import path from "node:path";
import type { SessionId } from "./types.js";

export function busPaths(dataDir: string, sessionId?: SessionId) {
  return {
    dataDir,
    rosterDir: path.join(dataDir, "roster"),
    claimsDir: path.join(dataDir, "claims"),
    inboxDir: path.join(dataDir, "inbox"),
    mutesDir: path.join(dataDir, "mutes"),
    deniesDir: path.join(dataDir, "denies"),
    talkedDir: path.join(dataDir, "talked"),
    loopDir: path.join(dataDir, "loop-armed"),
    roster: sessionId ? path.join(dataDir, "roster", `${sessionId}.json`) : "",
    claims: sessionId ? path.join(dataDir, "claims", `${sessionId}.json`) : "",
    inbox: sessionId ? path.join(dataDir, "inbox", `${sessionId}.jsonl`) : "",
    read: sessionId ? path.join(dataDir, "inbox", `${sessionId}.read`) : "",
    mutes: sessionId ? path.join(dataDir, "mutes", `${sessionId}.json`) : "",
    denies: sessionId ? path.join(dataDir, "denies", `${sessionId}.json`) : "",
    talked: sessionId ? path.join(dataDir, "talked", `${sessionId}.json`) : "",
    loopArmed: sessionId ? path.join(dataDir, "loop-armed", sessionId) : "",
  };
}

export function defaultDataDir(env = process.env): string {
  return (
    env.GROK_PLUGIN_DATA ??
    path.join(env.GROK_HOME ?? path.join(env.HOME ?? ".", ".grok"), "plugin-data", "grok-talks")
  );
}
```

`src/bus/fs.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | undefined {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
}

export function readJsonl<T>(file: string): T[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip torn line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // missing is fine
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bus/fs.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/clock.ts src/bus/paths.ts src/bus/fs.ts tests/helpers.ts tests/bus/fs.test.ts
git commit -m "feat: add atomic json and jsonl bus filesystem helpers"
```

---

### Task 3: Path normalize and display names

**Files:**
- Create: `src/bus/normalize.ts`
- Create: `src/bus/names.ts`
- Create: `tests/bus/normalize.test.ts`
- Create: `tests/bus/names.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/bus/normalize.test.ts`:

```ts
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePath, projectRoot } from "../../src/bus/normalize.js";

describe("normalizePath", () => {
  it("resolves relative segments against cwd", () => {
    expect(normalizePath("src/../src/auth.ts", "/repo")).toBe(
      path.resolve("/repo", "src/auth.ts"),
    );
  });

  it("collapses duplicate slashes and dots", () => {
    expect(normalizePath("/repo//src/./auth.ts", "/repo")).toBe(
      path.resolve("/repo/src/auth.ts"),
    );
  });

  it("returns lexical resolve when given an absolute path", () => {
    expect(normalizePath("/abs/foo.ts", "/repo")).toBe(path.resolve("/abs/foo.ts"));
  });
});

describe("projectRoot", () => {
  it("returns cwd when no git root exists above it", () => {
    const isolated = path.join(os.tmpdir(), "talks-no-git-" + process.pid);
    expect(projectRoot(isolated)).toBe(path.resolve(isolated));
  });
});
```

`tests/bus/names.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayName, readSessionTitle } from "../../src/bus/names.js";
import { tempDir } from "../helpers.js";

describe("displayName", () => {
  it("uses title when present", () => {
    expect(displayName("auth-fix", "/Users/maceo/payverge", "abcdef12zzzz")).toBe("auth-fix");
  });

  it("falls back to repo·short-id", () => {
    expect(displayName(undefined, "/Users/maceo/payverge", "abcdef12zzzz")).toBe(
      "payverge·abcdef12",
    );
  });
});

describe("readSessionTitle", () => {
  it("reads generated_title from summary.json when present", () => {
    const home = tempDir();
    const cwd = "/Users/maceo/payverge";
    const id = "sess-1";
    const dir = path.join(home, "sessions", encodeURIComponent(cwd), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "summary.json"),
      JSON.stringify({ generated_title: "Fix login" }),
    );
    expect(readSessionTitle(home, cwd, id)).toBe("Fix login");
  });

  it("returns undefined when summary is missing", () => {
    expect(readSessionTitle(tempDir(), "/x", "nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bus/normalize.test.ts tests/bus/names.test.ts`

Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

`src/bus/normalize.ts`:

```ts
import fs from "node:fs";
import path from "node:path";

export function normalizePath(input: string, cwd: string): string {
  try {
    const resolved = path.resolve(cwd, input);
    try {
      return fs.realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  } catch {
    return path.resolve(cwd, input);
  }
}

export function projectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}
```

`src/bus/names.ts`:

```ts
import path from "node:path";
import { readJson } from "./fs.js";
import type { SessionId } from "./types.js";

export function displayName(
  title: string | undefined,
  project: string,
  sessionId: SessionId,
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  const repo = path.basename(project) || "session";
  return `${repo}·${sessionId.slice(0, 8)}`;
}

export function readSessionTitle(
  grokHome: string,
  cwd: string,
  sessionId: SessionId,
): string | undefined {
  const encoded = encodeURIComponent(cwd);
  const file = path.join(grokHome, "sessions", encoded, sessionId, "summary.json");
  const summary = readJson<{ generated_title?: string; session_summary?: string; title?: string }>(
    file,
  );
  const title = summary?.generated_title ?? summary?.title;
  return title?.trim() || undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bus/normalize.test.ts tests/bus/names.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/normalize.ts src/bus/names.ts tests/bus/normalize.test.ts tests/bus/names.test.ts
git commit -m "feat: normalize paths and build coworker display names"
```

---

### Task 4: Roster presence

**Files:**
- Create: `src/bus/roster.ts`
- Create: `tests/bus/roster.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/bus/roster.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isLive, listRoster, readRoster, removeRoster, writeRoster } from "../../src/bus/roster.js";
import { HEARTBEAT_MS, type RosterEntry } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    session_id: "aaa",
    name: "payverge·aaa",
    cwd: "/repo",
    project: "/repo",
    pid: 100,
    working_on: "first",
    state: "idle",
    heartbeat_at: "2026-08-13T12:00:00.000Z",
    plugin_version: "1",
    ...over,
  };
}

describe("roster", () => {
  it("writes and reads a roster file", () => {
    const d = deps();
    writeRoster(d, entry());
    expect(readRoster(d, "aaa")?.name).toBe("payverge·aaa");
  });

  it("heartbeat updates time and does not clobber working_on", () => {
    const d = deps();
    writeRoster(d, entry());
    d.clock.advance(1000);
    writeRoster(d, { ...readRoster(d, "aaa")!, heartbeat_at: d.clock.now().toISOString() });
    expect(readRoster(d, "aaa")?.working_on).toBe("first");
  });

  it("treats dead pid as not live", () => {
    const d = deps();
    const e = entry({ pid: 999 });
    expect(isLive(d, e)).toBe(false);
  });

  it("treats heartbeat at 2:00 as stale and 1:59 as live", () => {
    const d = deps();
    const e = entry();
    d.clock.advance(HEARTBEAT_MS - 1);
    expect(isLive(d, e)).toBe(true);
    d.clock.advance(1);
    expect(isLive(d, e)).toBe(false);
  });

  it("hides stale peers from listRoster", () => {
    const d = deps();
    writeRoster(d, entry({ session_id: "aaa", pid: 100 }));
    writeRoster(d, entry({ session_id: "bbb", pid: 999, name: "dead" }));
    expect(listRoster(d).map((x) => x.session_id)).toEqual(["aaa"]);
  });

  it("removeRoster deletes the file", () => {
    const d = deps();
    writeRoster(d, entry());
    removeRoster(d, "aaa");
    expect(readRoster(d, "aaa")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bus/roster.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/bus/roster.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { readJson, removeFile, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import { HEARTBEAT_MS, type BusDeps, type RosterEntry, type SessionId } from "./types.js";

export function writeRoster(deps: BusDeps, entry: RosterEntry): void {
  writeJsonAtomic(busPaths(deps.dataDir, entry.session_id).roster, entry);
}

export function readRoster(deps: BusDeps, sessionId: SessionId): RosterEntry | undefined {
  return readJson<RosterEntry>(busPaths(deps.dataDir, sessionId).roster);
}

export function removeRoster(deps: BusDeps, sessionId: SessionId): void {
  removeFile(busPaths(deps.dataDir, sessionId).roster);
}

export function isLive(deps: BusDeps, entry: RosterEntry): boolean {
  if (!Number.isFinite(entry.pid) || !deps.pid.isAlive(entry.pid)) return false;
  const hb = Date.parse(entry.heartbeat_at);
  if (!Number.isFinite(hb)) return false;
  return deps.clock.now().getTime() - hb < HEARTBEAT_MS;
}

export function listRoster(deps: BusDeps): RosterEntry[] {
  const dir = busPaths(deps.dataDir).rosterDir;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RosterEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const entry = readJson<RosterEntry>(path.join(dir, name));
    if (entry && isLive(deps, entry)) out.push(entry);
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bus/roster.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/roster.ts tests/bus/roster.test.ts
git commit -m "feat: persist live coworker roster with heartbeat and pid checks"
```

---

### Task 5: Claims

**Files:**
- Create: `src/bus/claims.ts`
- Create: `tests/bus/claims.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/bus/claims.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { liveClaims, removeClaims, touchClaim } from "../../src/bus/claims.js";
import { CLAIM_TTL_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("claims", () => {
  it("records an absolute path and refreshes last_at", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    d.clock.advance(1000);
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    const rows = liveClaims(d, "aaa");
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/repo/src/auth.ts");
    expect(rows[0].last_at).toBe(d.clock.now().toISOString());
  });

  it("expires claims at 10 minutes", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    d.clock.advance(CLAIM_TTL_MS - 1);
    expect(liveClaims(d, "aaa")).toHaveLength(1);
    d.clock.advance(1);
    expect(liveClaims(d, "aaa")).toHaveLength(0);
  });

  it("keeps two paths independent", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/a.ts");
    touchClaim(d, "aaa", "/repo", "/repo/b.ts");
    expect(liveClaims(d, "aaa").map((c) => c.path).sort()).toEqual([
      "/repo/a.ts",
      "/repo/b.ts",
    ]);
  });

  it("removeClaims clears the file", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/a.ts");
    removeClaims(d, "aaa");
    expect(liveClaims(d, "aaa")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bus/claims.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/bus/claims.ts`:

```ts
import { toIso } from "./clock.js";
import { readJson, removeFile, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import {
  CLAIM_TTL_MS,
  type BusDeps,
  type ClaimPath,
  type ClaimsFile,
  type SessionId,
} from "./types.js";

export function readClaims(deps: BusDeps, sessionId: SessionId): ClaimsFile | undefined {
  return readJson<ClaimsFile>(busPaths(deps.dataDir, sessionId).claims);
}

export function touchClaim(
  deps: BusDeps,
  sessionId: SessionId,
  project: string,
  absPath: string,
): void {
  const now = toIso(deps.clock.now());
  const current = readClaims(deps, sessionId);
  const paths = current?.paths.filter((p) => p.path !== absPath) ?? [];
  paths.push({ path: absPath, last_at: now });
  const next: ClaimsFile = { session_id: sessionId, project, paths };
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).claims, next);
}

export function liveClaims(deps: BusDeps, sessionId: SessionId): ClaimPath[] {
  const file = readClaims(deps, sessionId);
  if (!file) return [];
  const now = deps.clock.now().getTime();
  return file.paths.filter((p) => {
    const t = Date.parse(p.last_at);
    return Number.isFinite(t) && now - t < CLAIM_TTL_MS;
  });
}

export function removeClaims(deps: BusDeps, sessionId: SessionId): void {
  removeFile(busPaths(deps.dataDir, sessionId).claims);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bus/claims.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/claims.ts tests/bus/claims.test.ts
git commit -m "feat: track per-session file claims with a 10 minute ttl"
```

---

### Task 6: Inbox, mute, denies, talked, rate limit

**Files:**
- Create: `src/bus/inbox.ts`
- Create: `src/bus/mutes.ts`
- Create: `src/bus/denies.ts`
- Create: `src/bus/talked.ts`
- Create: `src/bus/rateLimit.ts`
- Create: `tests/bus/inbox.test.ts`
- Create: `tests/bus/mutes.test.ts`
- Create: `tests/bus/denies.test.ts`
- Create: `tests/bus/rateLimit.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/bus/inbox.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appendMail, drainInbox, listUnread } from "../../src/bus/inbox.js";
import type { Mail } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

function mail(over: Partial<Mail> = {}): Omit<Mail, "id" | "ts"> & Partial<Pick<Mail, "id" | "ts">> {
  return {
    from: "bbb",
    from_name: "b",
    kind: "chat",
    project: "/repo",
    body: "hi",
    paths: [],
    ...over,
  };
}

describe("inbox", () => {
  it("appends and lists unread oldest first", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ body: "one" }));
    d.clock.advance(1000);
    appendMail(d, "aaa", mail({ body: "two" }));
    expect(listUnread(d, "aaa").map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("drain marks only returned ids read and caps at 8", () => {
    const d = deps();
    for (let i = 0; i < 10; i++) appendMail(d, "aaa", mail({ body: String(i) }));
    const first = drainInbox(d, "aaa", 8);
    expect(first.map((m) => m.body)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    const second = drainInbox(d, "aaa", 8);
    expect(second.map((m) => m.body)).toEqual(["8", "9"]);
  });

  it("skips muted senders without marking them read", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ from: "bbb", body: "hidden" }));
    appendMail(d, "aaa", mail({ from: "ccc", body: "shown" }));
    const got = drainInbox(d, "aaa", 8, new Set(["bbb"]));
    expect(got.map((m) => m.body)).toEqual(["shown"]);
    expect(listUnread(d, "aaa", new Set()).map((m) => m.body)).toEqual(["hidden"]);
  });

  it("coalesces collision keys to the newest undelivered line", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ kind: "collision", paths: ["/repo/a.ts"], body: "old" }));
    d.clock.advance(1000);
    appendMail(d, "aaa", mail({ kind: "collision", paths: ["/repo/a.ts"], body: "new" }));
    const got = drainInbox(d, "aaa", 8);
    expect(got.map((m) => m.body)).toEqual(["new"]);
    expect(listUnread(d, "aaa")).toEqual([]);
  });
});
```

`tests/bus/mutes.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { isMuted, readMutes, setMute } from "../../src/bus/mutes.js";
import { deps } from "../helpers.js";

describe("mutes", () => {
  it("mutes one peer and unmute restores", () => {
    const d = deps();
    expect(isMuted(d, "aaa", "bbb")).toBe(false);
    setMute(d, "aaa", { all: false, peers: ["bbb"] });
    expect(isMuted(d, "aaa", "bbb")).toBe(true);
    setMute(d, "aaa", { all: false, peers: [] });
    expect(isMuted(d, "aaa", "bbb")).toBe(false);
  });

  it("mute all blocks every sender", () => {
    const d = deps();
    setMute(d, "aaa", { all: true, peers: [] });
    expect(isMuted(d, "aaa", "zzz")).toBe(true);
  });

  it("missing or torn mute file is unmuted", () => {
    const d = deps();
    expect(readMutes(d, "aaa")).toEqual({ all: false, peers: [] });
  });
});
```

`tests/bus/denies.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { addDeny, hasDeny } from "../../src/bus/denies.js";
import { markTalked, hasTalked } from "../../src/bus/talked.js";
import { deps } from "../helpers.js";

describe("denies and talked", () => {
  it("persists a deny key", () => {
    const d = deps();
    addDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t1" });
    expect(hasDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t1" })).toBe(true);
    expect(hasDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t2" })).toBe(false);
  });

  it("records talked peers", () => {
    const d = deps();
    expect(hasTalked(d, "aaa", "bbb")).toBe(false);
    markTalked(d, "aaa", "bbb");
    expect(hasTalked(d, "aaa", "bbb")).toBe(true);
  });
});
```

`tests/bus/rateLimit.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { allowChat } from "../../src/bus/rateLimit.js";
import { CHAT_RATE, CHAT_WINDOW_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("rate limit", () => {
  it("allows 10 chats and rejects the 11th until the window passes", () => {
    const d = deps();
    for (let i = 0; i < CHAT_RATE; i++) {
      expect(allowChat(d, "bbb", "aaa")).toBe(true);
    }
    expect(allowChat(d, "bbb", "aaa")).toBe(false);
    d.clock.advance(CHAT_WINDOW_MS);
    expect(allowChat(d, "bbb", "aaa")).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bus/inbox.test.ts tests/bus/mutes.test.ts tests/bus/denies.test.ts tests/bus/rateLimit.test.ts`

Expected: FAIL — modules not found

- [ ] **Step 3: Write minimal implementation**

`src/bus/inbox.ts`:

```ts
import { randomUUID } from "node:crypto";
import { toIso } from "./clock.js";
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import { DRAIN_CAP, type BusDeps, type Mail, type SessionId } from "./types.js";

export function appendMail(
  deps: BusDeps,
  to: SessionId,
  mail: Omit<Mail, "id" | "ts"> & Partial<Pick<Mail, "id" | "ts">>,
): Mail {
  const full: Mail = {
    id: mail.id ?? randomUUID(),
    ts: mail.ts ?? toIso(deps.clock.now()),
    from: mail.from,
    from_name: mail.from_name,
    kind: mail.kind,
    project: mail.project,
    body: mail.body,
    paths: mail.paths,
  };
  appendJsonl(busPaths(deps.dataDir, to).inbox, full);
  return full;
}

function readSet(deps: BusDeps, sessionId: SessionId): Set<string> {
  const arr = readJson<string[]>(busPaths(deps.dataDir, sessionId).read) ?? [];
  return new Set(Array.isArray(arr) ? arr : []);
}

function writeSet(deps: BusDeps, sessionId: SessionId, ids: Set<string>): void {
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).read, [...ids]);
}

function collisionKey(m: Mail): string | undefined {
  if (m.kind !== "collision") return undefined;
  return `${m.from}\0${m.paths[0] ?? ""}`;
}

export function listUnread(
  deps: BusDeps,
  sessionId: SessionId,
  muted: Set<SessionId> = new Set(),
): Mail[] {
  const read = readSet(deps, sessionId);
  const rows = readJsonl<Mail>(busPaths(deps.dataDir, sessionId).inbox).filter(
    (m) => m?.id && m.from && !read.has(m.id) && !muted.has(m.from),
  );
  const latestCollision = new Map<string, string>();
  for (const m of rows) {
    const key = collisionKey(m);
    if (key) latestCollision.set(key, m.id);
  }
  return rows.filter((m) => {
    const key = collisionKey(m);
    if (!key) return true;
    return latestCollision.get(key) === m.id;
  });
}

export function drainInbox(
  deps: BusDeps,
  sessionId: SessionId,
  cap = DRAIN_CAP,
  muted: Set<SessionId> = new Set(),
): Mail[] {
  const unread = listUnread(deps, sessionId, muted).slice(0, cap);
  if (unread.length === 0) return [];
  const read = readSet(deps, sessionId);
  const all = readJsonl<Mail>(busPaths(deps.dataDir, sessionId).inbox);
  for (const m of unread) {
    read.add(m.id);
    const key = collisionKey(m);
    if (!key) continue;
    for (const other of all) {
      if (collisionKey(other) === key) read.add(other.id);
    }
  }
  writeSet(deps, sessionId, read);
  return unread;
}

export function markRead(deps: BusDeps, sessionId: SessionId, ids: string[]): void {
  const read = readSet(deps, sessionId);
  for (const id of ids) read.add(id);
  writeSet(deps, sessionId, read);
}
```

`src/bus/mutes.ts`:

```ts
import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, MuteFile, SessionId } from "./types.js";

export function readMutes(deps: BusDeps, sessionId: SessionId): MuteFile {
  const file = readJson<MuteFile>(busPaths(deps.dataDir, sessionId).mutes);
  if (!file || typeof file.all !== "boolean" || !Array.isArray(file.peers)) {
    return { all: false, peers: [] };
  }
  return file;
}

export function setMute(deps: BusDeps, sessionId: SessionId, mute: MuteFile): void {
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).mutes, mute);
}

export function isMuted(deps: BusDeps, listener: SessionId, sender: SessionId): boolean {
  const m = readMutes(deps, listener);
  return m.all || m.peers.includes(sender);
}

export function mutedSenders(deps: BusDeps, listener: SessionId): Set<SessionId> {
  const m = readMutes(deps, listener);
  if (m.all) return new Set(["*"]);
  return new Set(m.peers);
}
```

`src/bus/denies.ts`:

```ts
import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, DenyKey, SessionId } from "./types.js";

export function listDenies(deps: BusDeps, sessionId: SessionId): DenyKey[] {
  const rows = readJson<DenyKey[]>(busPaths(deps.dataDir, sessionId).denies);
  return Array.isArray(rows) ? rows : [];
}

export function addDeny(deps: BusDeps, sessionId: SessionId, key: DenyKey): void {
  const rows = listDenies(deps, sessionId);
  if (!hasDeny(deps, sessionId, key)) rows.push(key);
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).denies, rows);
}

export function hasDeny(deps: BusDeps, sessionId: SessionId, key: DenyKey): boolean {
  return listDenies(deps, sessionId).some(
    (k) => k.peer === key.peer && k.path === key.path && k.claim_last_at === key.claim_last_at,
  );
}
```

`src/bus/talked.ts`:

```ts
import { toIso } from "./clock.js";
import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, SessionId, TalkedFile } from "./types.js";

export function readTalked(deps: BusDeps, sessionId: SessionId): TalkedFile {
  return readJson<TalkedFile>(busPaths(deps.dataDir, sessionId).talked) ?? {};
}

export function markTalked(deps: BusDeps, sessionId: SessionId, peer: SessionId): void {
  const file = readTalked(deps, sessionId);
  file[peer] = toIso(deps.clock.now());
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).talked, file);
}

export function hasTalked(deps: BusDeps, sessionId: SessionId, peer: SessionId): boolean {
  return Boolean(readTalked(deps, sessionId)[peer]);
}
```

`src/bus/rateLimit.ts`:

```ts
import path from "node:path";
import { readJson, writeJsonAtomic } from "./fs.js";
import { CHAT_RATE, CHAT_WINDOW_MS, type BusDeps, type SessionId } from "./types.js";

type Stamps = Record<string, number[]>;

function key(from: SessionId, to: SessionId): string {
  return `${from}>${to}`;
}

export function allowChat(deps: BusDeps, from: SessionId, to: SessionId): boolean {
  const file = path.join(deps.dataDir, "rate-limit.json");
  const stamps = readJson<Stamps>(file) ?? {};
  const now = deps.clock.now().getTime();
  const k = key(from, to);
  const recent = (stamps[k] ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_RATE) {
    stamps[k] = recent;
    writeJsonAtomic(file, stamps);
    return false;
  }
  recent.push(now);
  stamps[k] = recent;
  writeJsonAtomic(file, stamps);
  return true;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bus/inbox.test.ts tests/bus/mutes.test.ts tests/bus/denies.test.ts tests/bus/rateLimit.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bus/inbox.ts src/bus/mutes.ts src/bus/denies.ts src/bus/talked.ts src/bus/rateLimit.ts tests/bus/inbox.test.ts tests/bus/mutes.test.ts tests/bus/denies.test.ts tests/bus/rateLimit.test.ts
git commit -m "feat: add inbox, mute, deny-once, talked, and chat rate limits"
```

---

### Task 7: Collision policy and TalksBus facade

**Files:**
- Create: `src/bus/collision.ts`
- Create: `src/bus/loop.ts`
- Create: `src/bus/talks.ts`
- Create: `tests/bus/collision.test.ts`
- Create: `tests/bus/talks.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/bus/collision.test.ts`:

```ts
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

function two(projectA = "/repo", projectB = "/repo") {
  const d = deps();
  const bus = new TalksBus(d);
  bus.sessionStart({ sessionId: "aaa", cwd: projectA, pid: 100 });
  bus.sessionStart({ sessionId: "bbb", cwd: projectB, pid: 200 });
  bus.promptSubmit("aaa", "working on auth");
  bus.touchWrite("aaa", path.join(projectA, "src/auth.ts"));
  return { d, bus };
}

describe("collision policy", () => {
  it("denies once when a working peer claimed the path", () => {
    const { bus } = two();
    const first = bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" });
    expect(first.decision).toBe("deny");
    expect(first.reason).toMatch(/aaa|auth/);
    const second = bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" });
    expect(second.decision).toBe("allow");
  });

  it("allows after talks_say even if last_at is unchanged", () => {
    const { bus } = two();
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "deny",
    );
    bus.say("bbb", "aaa", "I'll wait");
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );
  });

  it("allows when the peer is idle and writes collision mail to them", () => {
    const { bus } = two();
    bus.heartbeat("aaa", "idle");
    const r = bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" });
    expect(r.decision).toBe("allow");
    expect(bus.inbox("aaa").some((m) => m.kind === "collision")).toBe(true);
  });

  it("allows cross-project same relative path with no mail", () => {
    const { bus } = two("/repo-a", "/repo-b");
    const r = bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo-b" });
    expect(r.decision).toBe("allow");
    expect(bus.inbox("aaa")).toEqual([]);
  });

  it("does not deny auth.ts.bak or auth.tsx", () => {
    const { bus } = two();
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts.bak", cwd: "/repo" }).decision).toBe(
      "allow",
    );
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.tsx", cwd: "/repo" }).decision).toBe(
      "allow",
    );
  });

  it("allows when the claimer pid is dead", () => {
    const { d, bus } = two();
    d.pid.alive.delete(100);
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );
  });

  it("does not deny a muted peer", () => {
    const { bus } = two();
    bus.mute("bbb", "aaa");
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );
  });
});
```

`tests/bus/talks.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { LOOP_PROMPT } from "../../src/bus/loop.js";
import { TalksBus } from "../../src/bus/talks.js";
import { STATUS_MAX } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("TalksBus", () => {
  it("sessionEnd removes roster and claims but leaves inbox", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.say("aaa", "aaa", "note");
    bus.sessionEnd("aaa");
    expect(bus.board("aaa", "all")).toEqual([]);
    expect(bus.inbox("aaa").length).toBe(1);
  });

  it("truncates working_on to 200 chars", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.promptSubmit("aaa", "x".repeat(500));
    expect(bus.board("aaa", "project")[0].working_on.length).toBe(STATUS_MAX);
  });

  it("say rejects empty body, unknown target, and *", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    expect(bus.say("aaa", "zzz", "hi").ok).toBe(false);
    expect(bus.say("aaa", "*", "hi").ok).toBe(false);
    expect(bus.say("aaa", "aaa", "   ").ok).toBe(false);
  });

  it("resolves unique names and errors on duplicates", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "twin" });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200, title: "twin" });
    const r = bus.say("aaa", "twin", "hi");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/aaa|bbb/);
  });

  it("rate limits chat but not collision", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200 });
    for (let i = 0; i < 10; i++) expect(bus.say("bbb", "aaa", "n" + i).ok).toBe(true);
    expect(bus.say("bbb", "aaa", "nope").ok).toBe(false);
  });

  it("asks to arm a loop when project peers exist and none is scheduled", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200 });
    const arm = bus.shouldArmLoop("aaa", []);
    expect(arm.arm).toBe(true);
    expect(arm.prompt).toBe(LOOP_PROMPT);
    const again = bus.shouldArmLoop("aaa", []);
    expect(again.arm).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/bus/collision.test.ts tests/bus/talks.test.ts`

Expected: FAIL — `TalksBus` not found

- [ ] **Step 3: Write minimal implementation**

`src/bus/loop.ts`:

```ts
import fs from "node:fs";
import { busPaths } from "./paths.js";
import { LOOP_NAG_MS, type BusDeps, type SessionCron, type SessionId } from "./types.js";

export const LOOP_PROMPT =
  "Check the grok-talks inbox with talks_inbox. If it is empty, do nothing else. If there is mail, reply with talks_say only when coordination is needed (a collision or a direct question). Do not send acknowledgements. Do not start extra loops. Do not spawn subagents.";

export function isTalksLoop(cron: SessionCron): boolean {
  return /talks_inbox|grok-talks inbox/i.test(cron.prompt ?? "");
}

export function shouldArmLoop(
  deps: BusDeps,
  sessionId: SessionId,
  hasProjectPeer: boolean,
  muteAll: boolean,
  crons: SessionCron[],
): { arm: boolean; prompt?: string } {
  if (!hasProjectPeer || muteAll) return { arm: false };
  if (crons.some(isTalksLoop)) return { arm: false };
  const marker = busPaths(deps.dataDir, sessionId).loopArmed;
  try {
    const st = fs.statSync(marker);
    if (deps.clock.now().getTime() - st.mtimeMs < LOOP_NAG_MS) return { arm: false };
  } catch {
    // no marker
  }
  fs.mkdirSync(busPaths(deps.dataDir).loopDir, { recursive: true });
  fs.writeFileSync(marker, deps.clock.now().toISOString());
  return { arm: true, prompt: LOOP_PROMPT };
}
```

`src/bus/collision.ts`:

```ts
import { liveClaims } from "./claims.js";
import { hasDeny } from "./denies.js";
import { isMuted } from "./mutes.js";
import { isLive, listRoster } from "./roster.js";
import { hasTalked } from "./talked.js";
import type { BusDeps, ClaimPath, RosterEntry, SessionId } from "./types.js";

export interface CollisionHit {
  peer: RosterEntry;
  claim: ClaimPath;
}

export function findClaimer(
  deps: BusDeps,
  us: SessionId,
  project: string,
  absPath: string,
): CollisionHit | undefined {
  for (const peer of listRoster(deps)) {
    if (peer.session_id === us) continue;
    if (peer.project !== project) continue;
    if (!isLive(deps, peer)) continue;
    const claim = liveClaims(deps, peer.session_id).find((c) => c.path === absPath);
    if (claim) return { peer, claim };
  }
  return undefined;
}

export function shouldDeny(
  deps: BusDeps,
  us: SessionId,
  hit: CollisionHit,
): boolean {
  if (isMuted(deps, us, hit.peer.session_id)) return false;
  if (hit.peer.state !== "working") return false;
  if (hasTalked(deps, us, hit.peer.session_id)) return false;
  if (
    hasDeny(deps, us, {
      peer: hit.peer.session_id,
      path: hit.claim.path,
      claim_last_at: hit.claim.last_at,
    })
  ) {
    return false;
  }
  return true;
}
```

`src/bus/talks.ts`:

```ts
import path from "node:path";
import { liveClaims, removeClaims, touchClaim } from "./claims.js";
import { toIso } from "./clock.js";
import { findClaimer, shouldDeny } from "./collision.js";
import { addDeny } from "./denies.js";
import { appendMail, drainInbox, listUnread, markRead } from "./inbox.js";
import { shouldArmLoop as armLoop } from "./loop.js";
import { isMuted, readMutes, setMute } from "./mutes.js";
import { displayName } from "./names.js";
import { normalizePath, projectRoot } from "./normalize.js";
import { allowChat } from "./rateLimit.js";
import { listRoster, readRoster, removeRoster, writeRoster } from "./roster.js";
import { markTalked } from "./talked.js";
import {
  PLUGIN_VERSION,
  STATUS_MAX,
  type BoardScope,
  type BusDeps,
  type Mail,
  type RosterEntry,
  type SessionCron,
  type SessionId,
  type SessionState,
} from "./types.js";

export class TalksBus {
  constructor(readonly deps: BusDeps) {}

  sessionStart(input: {
    sessionId: SessionId;
    cwd: string;
    pid: number;
    title?: string;
  }): RosterEntry {
    const project = projectRoot(input.cwd);
    const entry: RosterEntry = {
      session_id: input.sessionId,
      name: displayName(input.title, project, input.sessionId),
      cwd: path.resolve(input.cwd),
      project,
      pid: input.pid,
      working_on: "",
      state: "idle",
      heartbeat_at: toIso(this.deps.clock.now()),
      plugin_version: PLUGIN_VERSION,
    };
    writeRoster(this.deps, entry);
    return entry;
  }

  sessionEnd(sessionId: SessionId): void {
    removeRoster(this.deps, sessionId);
    removeClaims(this.deps, sessionId);
  }

  heartbeat(sessionId: SessionId, state?: SessionState): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    writeRoster(this.deps, {
      ...cur,
      state: state ?? cur.state,
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  promptSubmit(sessionId: SessionId, prompt: string): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    const trimmed = prompt.trim();
    writeRoster(this.deps, {
      ...cur,
      state: "working",
      working_on: trimmed ? trimmed.slice(0, STATUS_MAX) : cur.working_on,
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  setStatus(sessionId: SessionId, workingOn: string): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    writeRoster(this.deps, {
      ...cur,
      working_on: workingOn.trim().slice(0, STATUS_MAX),
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  touchWrite(sessionId: SessionId, absOrRel: string, cwd?: string): string {
    const cur = readRoster(this.deps, sessionId);
    const base = cwd ?? cur?.cwd ?? process.cwd();
    const project = cur?.project ?? projectRoot(base);
    const abs = normalizePath(absOrRel, base);
    touchClaim(this.deps, sessionId, project, abs);
    this.heartbeat(sessionId);
    return abs;
  }

  decideWrite(input: { sessionId: SessionId; relPath: string; cwd: string }): {
    decision: "allow" | "deny";
    reason?: string;
  } {
    const us = readRoster(this.deps, input.sessionId);
    const project = us?.project ?? projectRoot(input.cwd);
    const abs = normalizePath(input.relPath, input.cwd);
    this.touchWrite(input.sessionId, abs, input.cwd);
    const hit = findClaimer(this.deps, input.sessionId, project, abs);
    if (!hit) return { decision: "allow" };
    if (shouldDeny(this.deps, input.sessionId, hit)) {
      addDeny(this.deps, input.sessionId, {
        peer: hit.peer.session_id,
        path: hit.claim.path,
        claim_last_at: hit.claim.last_at,
      });
      const body = `Collision: ${hit.peer.name} (${hit.peer.session_id}) is also editing ${abs}. Talk with talks_say before overwriting.`;
      appendMail(this.deps, input.sessionId, {
        from: hit.peer.session_id,
        from_name: hit.peer.name,
        kind: "collision",
        project,
        body,
        paths: [abs],
      });
      appendMail(this.deps, hit.peer.session_id, {
        from: input.sessionId,
        from_name: us?.name ?? input.sessionId,
        kind: "collision",
        project,
        body,
        paths: [abs],
      });
      return { decision: "deny", reason: body };
    }
    if (hit.peer.state === "idle") {
      appendMail(this.deps, hit.peer.session_id, {
        from: input.sessionId,
        from_name: us?.name ?? input.sessionId,
        kind: "collision",
        project,
        body: `${us?.name ?? input.sessionId} is editing ${abs} (you claimed it earlier).`,
        paths: [abs],
      });
    }
    return { decision: "allow" };
  }

  resolvePeer(from: SessionId, target: string): { ok: true; peer: RosterEntry } | { ok: false; error: string } {
    if (target === "*") return { ok: false, error: "broadcast is not supported" };
    const peers = listRoster(this.deps);
    const byId = peers.find((p) => p.session_id === target);
    if (byId) return { ok: true, peer: byId };
    const byName = peers.filter((p) => p.name === target || p.name.endsWith("·" + target));
    if (byName.length === 1) return { ok: true, peer: byName[0] };
    if (byName.length > 1) {
      return { ok: false, error: `ambiguous name; matches ${byName.map((p) => p.session_id).join(", ")}` };
    }
    const self = readRoster(this.deps, from);
    if (self && (self.session_id === target || self.name === target)) return { ok: true, peer: self };
    return { ok: false, error: `unknown session ${target}` };
  }

  say(
    from: SessionId,
    to: string,
    body: string,
  ): { ok: true; mail: Mail } | { ok: false; error: string } {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: "empty body" };
    const resolved = this.resolvePeer(from, to);
    if (!resolved.ok) return resolved;
    if (!allowChat(this.deps, from, resolved.peer.session_id)) {
      return { ok: false, error: "rate limited (10 chats per minute)" };
    }
    const us = readRoster(this.deps, from);
    const mail = appendMail(this.deps, resolved.peer.session_id, {
      from,
      from_name: us?.name ?? from,
      kind: "chat",
      project: us?.project ?? "",
      body: trimmed,
      paths: [],
    });
    markTalked(this.deps, from, resolved.peer.session_id);
    return { ok: true, mail };
  }

  inbox(sessionId: SessionId, opts?: { markRead?: boolean }): Mail[] {
    const muted = this.mutedSet(sessionId);
    const rows = listUnread(this.deps, sessionId, muted);
    if (opts?.markRead) markRead(this.deps, sessionId, rows.map((m) => m.id));
    return rows;
  }

  drain(sessionId: SessionId, cap?: number): Mail[] {
    return drainInbox(this.deps, sessionId, cap, this.mutedSet(sessionId));
  }

  board(sessionId: SessionId, scope: BoardScope = "project"): RosterEntry[] {
    const us = readRoster(this.deps, sessionId);
    const all = listRoster(this.deps);
    if (scope === "all" || !us) return all;
    return all.filter((p) => p.project === us.project);
  }

  mute(sessionId: SessionId, peer?: SessionId | "all"): void {
    const cur = readMutes(this.deps, sessionId);
    if (!peer || peer === "all") {
      setMute(this.deps, sessionId, { all: true, peers: cur.peers });
      return;
    }
    setMute(this.deps, sessionId, { all: false, peers: [...new Set([...cur.peers, peer])] });
  }

  unmute(sessionId: SessionId, peer?: SessionId | "all"): void {
    if (!peer || peer === "all") {
      setMute(this.deps, sessionId, { all: false, peers: [] });
      return;
    }
    const cur = readMutes(this.deps, sessionId);
    setMute(this.deps, sessionId, { all: false, peers: cur.peers.filter((p) => p !== peer) });
  }

  shouldArmLoop(sessionId: SessionId, crons: SessionCron[]): { arm: boolean; prompt?: string } {
    const us = readRoster(this.deps, sessionId);
    const peers = this.board(sessionId, "project").filter((p) => p.session_id !== sessionId);
    return armLoop(this.deps, sessionId, peers.length > 0, readMutes(this.deps, sessionId).all, crons);
  }

  claims(sessionId: SessionId) {
    return liveClaims(this.deps, sessionId);
  }

  private mutedSet(sessionId: SessionId): Set<SessionId> {
    const m = readMutes(this.deps, sessionId);
    if (m.all) {
      return new Set(listRoster(this.deps).map((p) => p.session_id).filter((id) => id !== sessionId));
    }
    return new Set(m.peers);
  }
}

export { isMuted };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/bus/collision.test.ts tests/bus/talks.test.ts`

Expected: PASS. If a collision test fails on path separators, use `normalizePath` in the test expected strings. If `sessionEnd` board fails because the session is gone, assert `listRoster` via `board("bbb", "all")` instead — in that case change the test to start `bbb` as well or query after creating a live observer. Prefer fixing `sessionEnd` test like this if needed:

```ts
bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200 });
bus.sessionEnd("aaa");
expect(bus.board("bbb", "all").map((p) => p.session_id)).toEqual(["bbb"]);
```

- [ ] **Step 5: Commit**

```bash
git add src/bus/collision.ts src/bus/loop.ts src/bus/talks.ts tests/bus/collision.test.ts tests/bus/talks.test.ts
git commit -m "feat: add collision policy and TalksBus facade"
```

---

### Task 8: Hook adapters

**Files:**
- Create: `src/hooks/events.ts`
- Create: `src/hooks/handle.ts`
- Create: `src/hook.ts`
- Create: `tests/hooks/handle.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/hooks/handle.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { handleHook } from "../../src/hooks/handle.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

function base(over: Record<string, unknown> = {}) {
  return {
    hookEventName: "session_start",
    sessionId: "aaa",
    cwd: "/repo",
    workspaceRoot: "/repo",
    timestamp: "2026-08-13T12:00:00.000Z",
    permissionMode: "default",
    ...over,
  };
}

describe("hooks", () => {
  it("session_start writes roster", () => {
    const d = deps();
    const bus = new TalksBus(d);
    const out = handleHook(bus, base({ hookEventName: "session_start" }), { pid: 100 });
    expect(out).toBeUndefined();
    expect(bus.board("aaa", "all")[0].session_id).toBe("aaa");
  });

  it("pre_tool_use denies a colliding write and fail-opens on bad input", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start" }), { pid: 100 });
    handleHook(bus, base({ hookEventName: "session_start", sessionId: "bbb" }), { pid: 200 });
    handleHook(
      bus,
      base({
        hookEventName: "user_prompt_submit",
        prompt: "edit auth",
      }),
      { pid: 100 },
    );
    handleHook(
      bus,
      base({
        hookEventName: "post_tool_use",
        toolName: "search_replace",
        toolInput: { file_path: "/repo/src/auth.ts" },
      }),
      { pid: 100 },
    );
    const deny = handleHook(
      bus,
      base({
        hookEventName: "pre_tool_use",
        sessionId: "bbb",
        toolName: "search_replace",
        toolInput: { file_path: "/repo/src/auth.ts" },
      }),
      { pid: 200 },
    );
    expect(deny).toMatchObject({ decision: "deny" });
    const bad = handleHook(bus, { hookEventName: "pre_tool_use" }, { pid: 200 });
    expect(bad).toBeUndefined();
  });

  it("stop end_turn drains inbox and ignores other reasons", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start" }), { pid: 100 });
    handleHook(bus, base({ hookEventName: "session_start", sessionId: "bbb" }), { pid: 200 });
    bus.say("bbb", "aaa", "hello");
    const stop = handleHook(
      bus,
      base({ hookEventName: "stop", reason: "end_turn", sessionCrons: [] }),
      { pid: 100 },
    );
    expect(JSON.stringify(stop)).toMatch(/hello/);
    const ignore = handleHook(
      bus,
      base({ hookEventName: "stop", reason: "channel_closed" }),
      { pid: 100 },
    );
    expect(ignore).toBeUndefined();
  });

  it("maps Write/Edit aliases to write paths", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start" }), { pid: 100 });
    handleHook(
      bus,
      base({
        hookEventName: "post_tool_use",
        toolName: "Write",
        toolInput: { path: "/repo/src/a.ts" },
      }),
      { pid: 100 },
    );
    expect(bus.claims("aaa").some((c) => c.path.endsWith("src/a.ts"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/hooks/handle.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/hooks/events.ts`:

```ts
import type { SessionCron } from "../bus/types.js";

export interface HookEvent {
  hookEventName?: string;
  sessionId?: string;
  cwd?: string;
  workspaceRoot?: string;
  timestamp?: string;
  permissionMode?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  prompt?: string;
  reason?: string;
  sessionCrons?: SessionCron[];
  stopHookActive?: boolean;
}

const WRITE_TOOLS = new Set([
  "search_replace",
  "write",
  "Write",
  "Edit",
  "MultiEdit",
]);

export function isWriteTool(name: string | undefined): boolean {
  if (!name) return false;
  return WRITE_TOOLS.has(name);
}

export function writePath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ["file_path", "path", "target_file"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export function eventName(ev: HookEvent): string {
  return (ev.hookEventName ?? "").toLowerCase().replace(/-/g, "_");
}
```

`src/hooks/handle.ts`:

```ts
import { displayName, readSessionTitle } from "../bus/names.js";
import { TalksBus } from "../bus/talks.js";
import { readRoster, writeRoster } from "../bus/roster.js";
import { eventName, isWriteTool, writePath, type HookEvent } from "./events.js";

export function handleHook(
  bus: TalksBus,
  ev: HookEvent,
  extra: { pid: number; grokHome?: string },
): unknown {
  try {
    return handleHookInner(bus, ev, extra);
  } catch {
    return undefined;
  }
}

function handleHookInner(
  bus: TalksBus,
  ev: HookEvent,
  extra: { pid: number; grokHome?: string },
): unknown {
  const name = eventName(ev);
  const sessionId = ev.sessionId;
  const cwd = ev.workspaceRoot || ev.cwd || process.cwd();
  if (!sessionId) return undefined;

  if (name === "session_start") {
    const title = extra.grokHome
      ? readSessionTitle(extra.grokHome, cwd, sessionId)
      : undefined;
    const entry = bus.sessionStart({ sessionId, cwd, pid: extra.pid, title });
    writeRoster(bus.deps, { ...entry, name: displayName(title, entry.project, sessionId) });
    return undefined;
  }
  if (name === "session_end") {
    bus.sessionEnd(sessionId);
    return undefined;
  }
  if (name === "user_prompt_submit") {
    bus.promptSubmit(sessionId, typeof ev.prompt === "string" ? ev.prompt : "");
    return undefined;
  }
  if (name === "post_tool_use" && isWriteTool(ev.toolName)) {
    const p = writePath(ev.toolInput);
    if (p) bus.touchWrite(sessionId, p, cwd);
    return undefined;
  }
  if (name === "pre_tool_use") {
    if (!isWriteTool(ev.toolName)) return undefined;
    const p = writePath(ev.toolInput);
    if (!p) return undefined;
    const result = bus.decideWrite({ sessionId, relPath: p, cwd });
    if (result.decision === "deny") return { decision: "deny", reason: result.reason };
    return undefined;
  }
  if (name === "stop") {
    if (ev.reason !== "end_turn") return undefined;
    const mail = bus.drain(sessionId);
    if (mail.length > 0) {
      bus.heartbeat(sessionId, "working");
      const text = mail
        .map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`)
        .join("\n");
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: text,
        },
      };
    }
    bus.heartbeat(sessionId, "idle");
    if (ev.stopHookActive) return undefined;
    const arm = bus.shouldArmLoop(sessionId, ev.sessionCrons ?? []);
    if (arm.arm && arm.prompt) {
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: `Start /loop 60s with this prompt and no extras:\n${arm.prompt}`,
        },
      };
    }
    return undefined;
  }
  return undefined;
}

Put these imports at the top of `src/hooks/handle.ts` (with the existing imports):

```ts
import fs from "node:fs";
import path from "node:path";
```

```ts
export function resolvePid(sessionId: string, fallback: number, grokHome?: string): number {
  if (!grokHome) return fallback;
  try {
    const rows = JSON.parse(
      fs.readFileSync(path.join(grokHome, "active_sessions.json"), "utf8"),
    ) as Array<{ session_id: string; pid: number }>;
    const hit = rows.find((r) => r.session_id === sessionId);
    if (hit && Number.isFinite(hit.pid)) return hit.pid;
  } catch {
    // fall through
  }
  return fallback;
}
```

`src/hook.ts`:

```ts
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";
import { handleHook, resolvePid } from "./hooks/handle.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    const raw = await readStdin();
    const ev = raw.trim() ? JSON.parse(raw) : {};
    const grokHome = process.env.GROK_HOME ?? `${process.env.HOME}/.grok`;
    const sessionId = ev.sessionId ?? process.env.GROK_SESSION_ID ?? "";
    const pid = resolvePid(sessionId, process.ppid, grokHome);
    const bus = new TalksBus({
      dataDir: defaultDataDir(),
      clock: systemClock,
      pid: systemPid,
      grokHome,
    });
    const out = handleHook(bus, ev, { pid, grokHome });
    if (out !== undefined) process.stdout.write(JSON.stringify(out));
  } catch {
    // fail open
  }
}

void main();
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/hooks/handle.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/events.ts src/hooks/handle.ts src/hook.ts tests/hooks/handle.test.ts
git commit -m "feat: add fail-open hook adapters for join, claims, deny, and drain"
```

---

### Task 9: Two-session fake, concurrency, fail-open battery

**Files:**
- Create: `tests/fake/two-session.test.ts`
- Create: `tests/failopen/failopen.test.ts`
- Create: `tests/bus/concurrency.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/fake/two-session.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { CLAIM_TTL_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("two-session fake", () => {
  it("covers the spec scenarios", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200, title: "B" });
    expect(bus.board("aaa", "project")).toHaveLength(2);

    bus.promptSubmit("aaa", "edit auth");
    bus.touchWrite("aaa", "/repo/src/auth.ts");
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "deny",
    );
    expect(bus.inbox("aaa").some((m) => m.kind === "collision")).toBe(true);
    expect(bus.inbox("bbb").some((m) => m.kind === "collision")).toBe(true);

    bus.say("bbb", "aaa", "I'll take it after you");
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );

    bus.heartbeat("aaa", "idle");
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );
    expect(bus.drain("aaa").some((m) => m.kind === "collision")).toBe(true);

    bus.mute("aaa", "bbb");
    bus.say("bbb", "aaa", "muted hello");
    expect(bus.drain("aaa")).toEqual([]);

    const other = deps({ dataDir: d.dataDir, clock: d.clock, pid: d.pid });
    const bus2 = new TalksBus(other);
    bus2.sessionStart({ sessionId: "ccc", cwd: "/other", pid: 300, title: "C" });
    expect(
      bus2.decideWrite({ sessionId: "ccc", relPath: "src/auth.ts", cwd: "/other" }).decision,
    ).toBe("allow");
    expect(bus.inbox("aaa").filter((m) => m.from === "ccc")).toEqual([]);

    d.pid.alive.delete(100);
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );

    d.pid.alive.add(100);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.promptSubmit("aaa", "again");
    bus.touchWrite("aaa", "/repo/src/auth.ts");
    d.clock.advance(CLAIM_TTL_MS);
    expect(bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts", cwd: "/repo" }).decision).toBe(
      "allow",
    );

    for (let i = 0; i < 10; i++) expect(bus.say("bbb", "aaa", "n" + i).ok).toBe(true);
    expect(bus.say("bbb", "aaa", "n10").ok).toBe(false);
    bus.unmute("aaa", "bbb");
    const drained = bus.drain("aaa", 8);
    expect(drained.length).toBe(8);
    expect(bus.drain("aaa", 8).length).toBe(2);
  });
});
```

`tests/failopen/failopen.test.ts`:

```ts
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handleHook } from "../../src/hooks/handle.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

describe("fail-open", () => {
  it("pre_tool_use allows when roster is torn", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    fs.writeFileSync(path.join(d.dataDir, "roster", "aaa.json"), "{");
    const out = handleHook(
      bus,
      {
        hookEventName: "pre_tool_use",
        sessionId: "bbb",
        cwd: "/repo",
        toolName: "Write",
        toolInput: { path: "/repo/x.ts" },
      },
      { pid: 200 },
    );
    expect(out).toBeUndefined();
  });

  it("missing session id does not throw", () => {
    const d = deps();
    const bus = new TalksBus(d);
    expect(() => handleHook(bus, { hookEventName: "pre_tool_use" }, { pid: 1 })).not.toThrow();
  });
});
```

`tests/bus/concurrency.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { appendMail } from "../../src/bus/inbox.js";
import { busPaths } from "../../src/bus/paths.js";
import { readJsonl as readLines } from "../../src/bus/fs.js";
import type { Mail } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("concurrency", () => {
  it("keeps 50 sequential appends as valid jsonl", () => {
    const d = deps();
    for (let i = 0; i < 50; i++) {
      appendMail(d, "aaa", {
        from: "bbb",
        from_name: "b",
        kind: "chat",
        project: "/repo",
        body: String(i),
        paths: [],
      });
    }
    const rows = readLines<Mail>(busPaths(d.dataDir, "aaa").inbox);
    expect(rows).toHaveLength(50);
  });
});
```

Remove the unused `readJsonl` import from `inbox.js` in the concurrency test (keep `readLines` from `fs.js` only).

- [ ] **Step 2: Run tests**

Run: `npx vitest run tests/fake/two-session.test.ts tests/failopen/failopen.test.ts tests/bus/concurrency.test.ts`

Expected: FAIL first on missing files, then PASS after you add the files from Step 1 (these tests use existing APIs). If any assertion fails, fix `TalksBus` / mute-set / drain order — do not weaken the spec.

- [ ] **Step 3: Commit**

```bash
git add tests/fake/two-session.test.ts tests/failopen/failopen.test.ts tests/bus/concurrency.test.ts
git commit -m "test: add two-session, fail-open, and inbox append coverage"
```

---

### Task 10: MCP server

**Files:**
- Create: `src/mcp.ts`
- Create: `src/mcp/tools.ts`
- Create: `tests/mcp/tools.test.ts`

- [ ] **Step 1: Write the failing tests**

`tests/mcp/tools.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { callTalksTool } from "../../src/mcp/tools.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

describe("mcp tools", () => {
  it("talks_board defaults to project scope", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.sessionStart({ sessionId: "bbb", cwd: "/other", pid: 200, title: "B" });
    const project = callTalksTool(bus, "aaa", "talks_board", {});
    expect(project.text).not.toMatch(/\/other/);
    const all = callTalksTool(bus, "aaa", "talks_board", { scope: "all" });
    expect(all.text).toMatch(/B/);
  });

  it("talks_say and talks_inbox respect mark_read", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200 });
    expect(callTalksTool(bus, "bbb", "talks_say", { to: "aaa", body: "hi" }).isError).toBeFalsy();
    const peek = callTalksTool(bus, "aaa", "talks_inbox", {});
    expect(peek.text).toMatch(/hi/);
    const peek2 = callTalksTool(bus, "aaa", "talks_inbox", {});
    expect(peek2.text).toMatch(/hi/);
    callTalksTool(bus, "aaa", "talks_inbox", { mark_read: true });
    expect(callTalksTool(bus, "aaa", "talks_inbox", {}).text).not.toMatch(/hi/);
  });

  it("missing session id returns an error object", () => {
    const bus = new TalksBus(deps());
    const r = callTalksTool(bus, "", "talks_board", {});
    expect(r.isError).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/mcp/tools.test.ts`

Expected: FAIL — module not found

- [ ] **Step 3: Write minimal implementation**

`src/mcp/tools.ts`:

```ts
import { TalksBus } from "../bus/talks.js";
import type { BoardScope } from "../bus/types.js";

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export function callTalksTool(
  bus: TalksBus,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): ToolResult {
  if (!sessionId) return { text: "GROK_SESSION_ID is required", isError: true };
  try {
    if (name === "talks_board") {
      const scope = (args.scope === "all" ? "all" : "project") as BoardScope;
      const rows = bus.board(sessionId, scope);
      const text = rows
        .map((r) => {
          const files = bus.claims(r.session_id).map((c) => c.path).join(", ");
          return `${r.name} ${r.session_id} ${r.state} ${r.project} ${r.working_on}${files ? " files:" + files : ""}`;
        })
        .join("\n");
      return { text: text || "(no live coworkers)" };
    }
    if (name === "talks_say") {
      const to = String(args.to ?? "");
      const body = String(args.body ?? "");
      const r = bus.say(sessionId, to, body);
      return r.ok ? { text: `sent ${r.mail.id}` } : { text: r.error, isError: true };
    }
    if (name === "talks_inbox") {
      const rows = bus.inbox(sessionId, { markRead: Boolean(args.mark_read) });
      return {
        text: rows.map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`).join("\n") || "(empty)",
      };
    }
    if (name === "talks_mute") {
      const peer = args.peer === undefined ? "all" : String(args.peer);
      if (args.on === false) bus.unmute(sessionId, peer);
      else bus.mute(sessionId, peer);
      return { text: "ok" };
    }
    if (name === "talks_status") {
      bus.setStatus(sessionId, String(args.working_on ?? ""));
      return { text: "ok" };
    }
    return { text: `unknown tool ${name}`, isError: true };
  } catch (err) {
    return { text: err instanceof Error ? err.message : "error", isError: true };
  }
}
```

`src/mcp.ts`:

```ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";
import { callTalksTool } from "./mcp/tools.js";

const bus = new TalksBus({
  dataDir: defaultDataDir(),
  clock: systemClock,
  pid: systemPid,
  grokHome: process.env.GROK_HOME ?? `${process.env.HOME}/.grok`,
});

function sessionId(): string {
  return process.env.GROK_SESSION_ID ?? "";
}

const server = new McpServer({ name: "grok-talks", version: "0.1.0" });

server.tool("talks_board", { scope: z.enum(["project", "all"]).optional() }, async ({ scope }) => {
  const r = callTalksTool(bus, sessionId(), "talks_board", { scope });
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
});

server.tool(
  "talks_say",
  { to: z.string(), body: z.string() },
  async ({ to, body }) => {
    const r = callTalksTool(bus, sessionId(), "talks_say", { to, body });
    return { content: [{ type: "text", text: r.text }], isError: r.isError };
  },
);

server.tool(
  "talks_inbox",
  { mark_read: z.boolean().optional() },
  async ({ mark_read }) => {
    const r = callTalksTool(bus, sessionId(), "talks_inbox", { mark_read });
    return { content: [{ type: "text", text: r.text }], isError: r.isError };
  },
);

server.tool(
  "talks_mute",
  { peer: z.string().optional(), on: z.boolean().optional() },
  async ({ peer, on }) => {
    const r = callTalksTool(bus, sessionId(), "talks_mute", { peer, on });
    return { content: [{ type: "text", text: r.text }], isError: r.isError };
  },
);

server.tool("talks_status", { working_on: z.string() }, async ({ working_on }) => {
  const r = callTalksTool(bus, sessionId(), "talks_status", { working_on });
  return { content: [{ type: "text", text: r.text }], isError: r.isError };
});

const transport = new StdioServerTransport();
await server.connect(transport);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/mcp/tools.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/mcp.ts src/mcp/tools.ts tests/mcp/tools.test.ts
git commit -m "feat: expose talks board, say, inbox, mute, and status as MCP tools"
```

---

### Task 11: CLI

**Files:**
- Create: `src/cli.ts`
- Create: `tests/cli/cli.test.ts`

- [ ] **Step 1: Write the failing test**

`tests/cli/cli.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { runCli } from "../../src/cli.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

describe("cli", () => {
  it("board, send, inbox, mute", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200, title: "B" });
    expect(runCli(bus, "aaa", ["board"]).text).toMatch(/B/);
    expect(runCli(bus, "bbb", ["send", "aaa", "hello"]).status).toBe(0);
    expect(runCli(bus, "aaa", ["inbox"]).text).toMatch(/hello/);
    runCli(bus, "aaa", ["mute", "bbb"]);
    expect(runCli(bus, "aaa", ["inbox", "--drain"]).text).not.toMatch(/hello/);
    expect(runCli(bus, "aaa", ["send", "nope", "x"]).status).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/cli/cli.test.ts`

Expected: FAIL — `runCli` not found

- [ ] **Step 3: Write minimal implementation**

`src/cli.ts`:

```ts
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";

export function runCli(
  bus: TalksBus,
  sessionId: string,
  argv: string[],
): { status: number; text: string } {
  const [cmd, ...rest] = argv;
  if (!sessionId) return { status: 1, text: "GROK_SESSION_ID is required\n" };
  if (cmd === "board") {
    const scope = rest[0] === "--all" ? "all" : "project";
    const rows = bus.board(sessionId, scope);
    return {
      status: 0,
      text: rows.map((r) => `${r.name}\t${r.state}\t${r.project}\t${r.working_on}`).join("\n") + "\n",
    };
  }
  if (cmd === "send") {
    const [to, ...body] = rest;
    const r = bus.say(sessionId, to ?? "", body.join(" "));
    return r.ok ? { status: 0, text: `sent ${r.mail.id}\n` } : { status: 1, text: r.error + "\n" };
  }
  if (cmd === "inbox") {
    const drain = rest.includes("--drain");
    const rows = drain ? bus.drain(sessionId) : bus.inbox(sessionId);
    return {
      status: 0,
      text: rows.map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`).join("\n") + (rows.length ? "\n" : ""),
    };
  }
  if (cmd === "mute") {
    bus.mute(sessionId, rest[0] === "--all" || !rest[0] ? "all" : rest[0]);
    return { status: 0, text: "muted\n" };
  }
  if (cmd === "unmute") {
    bus.unmute(sessionId, rest[0] === "--all" || !rest[0] ? "all" : rest[0]);
    return { status: 0, text: "unmuted\n" };
  }
  return { status: 1, text: "usage: talks board|send|inbox|mute|unmute\n" };
}

const isMain = process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js");
if (isMain) {
  const bus = new TalksBus({
    dataDir: defaultDataDir(),
    clock: systemClock,
    pid: systemPid,
    grokHome: process.env.GROK_HOME ?? `${process.env.HOME}/.grok`,
  });
  const result = runCli(bus, process.env.GROK_SESSION_ID ?? "", process.argv.slice(2));
  process.stdout.write(result.text);
  process.exit(result.status);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/cli/cli.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/cli.ts tests/cli/cli.test.ts
git commit -m "feat: add talks CLI for board, send, inbox, and mute"
```

---

### Task 12: Plugin manifests, skill, commands, README

**Files:**
- Create: `plugin.json`
- Create: `hooks/hooks.json`
- Create: `.mcp.json`
- Create: `skills/grok-talks/SKILL.md`
- Create: `commands/board.md`
- Create: `commands/talks.md`
- Create: `commands/mute.md`
- Create: `README.md`

- [ ] **Step 1: Write the plugin files**

`plugin.json`:

```json
{
  "name": "grok-talks",
  "version": "0.1.0",
  "description": "Coworker office for live Grok TUI sessions: board, DMs, and same-project collision nags.",
  "author": { "name": "blockvantage" }
}
```

`hooks/hooks.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 10 }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 10 }
        ]
      }
    ],
    "UserPromptSubmit": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 10 }
        ]
      }
    ],
    "PreToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 10 }
        ]
      }
    ],
    "PostToolUse": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 10 }
        ]
      }
    ],
    "Stop": [
      {
        "hooks": [
          { "type": "command", "command": "node \"${GROK_PLUGIN_ROOT}/dist/hook.js\"", "timeout": 15 }
        ]
      }
    ]
  }
}
```

`.mcp.json`:

```json
{
  "mcpServers": {
    "talks": {
      "command": "node",
      "args": ["${GROK_PLUGIN_ROOT}/dist/mcp.js"]
    }
  }
}
```

`skills/grok-talks/SKILL.md`:

```markdown
---
name: grok-talks
description: >
  Coworker office for live Grok sessions. Use when other Grok TUIs may be
  working in this repo, when a collision deny mentions talks_say, when the
  user runs /board /talks /mute, or when inbox mail arrives. Trigger phrases:
  grok talks, coworker session, who else is working, collision, /board, /talks.
---

You are one coworker in a local office of live Grok sessions.

1. On the first turn in a project that has peers, call `talks_board`.
2. If Stop / a hook asks you to start `/loop 60s` with the grok-talks inbox prompt, do that once. Do not start extra loops.
3. Use `talks_say` for coordination only (collisions, "I'm in this file", answers to a direct question). No check-ins. No "got it."
4. If PreToolUse denies a write, message the named peer, then retry once after they answer or after you have said you will take the file.
5. Honor mute. Never try to inject a prompt into another session (`grok -p --resume`, ACP, tmux).
6. Never kill another session's turn.
```

`commands/board.md`:

```markdown
---
description: Show live Grok coworker sessions
---

Call `talks_board` with scope `all` if the user said "all", otherwise `project`. Print the result. Do not start extra work.
```

`commands/talks.md`:

```markdown
---
description: Send a message to another live Grok session
argument-hint: "<name-or-id> <message>"
---

Send the user's text with `talks_say`. First token is `to`, the rest is `body`. If addressing fails, show the error and `talks_board`.
```

`commands/mute.md`:

```markdown
---
description: Mute or unmute coworker messages
argument-hint: "[peer|--all] [--off]"
---

If the user said unmute or --off, call `talks_mute` with `on: false`. Otherwise mute. Peer `all` when omitted.
```

`README.md`:

```markdown
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

## Tests

`npm test` is CI. The manual two-TUI checklist is in `docs/superpowers/specs/2026-08-13-grok-talks-design.md` §12.17.
```

- [ ] **Step 2: Build and run the full test suite**

```bash
npm test
npm run build
```

Expected: all vitest tests PASS; `dist/hook.js`, `dist/mcp.js`, `dist/cli.js` exist.

- [ ] **Step 3: Validate the plugin if the CLI supports it**

```bash
grok plugin validate .
```

Expected: success, or a concrete schema error you fix in `plugin.json` / `hooks/hooks.json` without changing behavior.

- [ ] **Step 4: Commit**

```bash
git add plugin.json hooks/hooks.json .mcp.json skills/grok-talks/SKILL.md commands/board.md commands/talks.md commands/mute.md README.md
git commit -m "feat: package grok-talks as an installable Grok plugin"
```

---

## Self-review (spec coverage)

| Spec section | Task |
|---|---|
| §2–4 plugin + bus + MCP + skill | 1, 7, 10, 12 |
| §5 data dir layout | 2, 4–6 |
| §6 identity, heartbeat, pid | 3, 4, 8 |
| §7 records including `.read`, denies, talked | 6, 7 |
| §8.1–8.2 join/leave/status | 7, 8 |
| §8.3 talk, no `*` | 7, 11 |
| §8.4 Stop drain cap 8 | 6, 8 |
| §8.5 idle `/loop` arm | 7, 8, 12 |
| §8.6 collision table | 7, 9 |
| §8.7 mute | 6, 7 |
| §8.8 human slash commands | 12 |
| §9 MCP tools | 10 |
| §10 fail-open, rate limit, secrets 200 | 7, 8, 9 |
| §11 plugin layout | 12 |
| §12 tests | 2–11 |
| §13 v2 parked | no task (do not implement) |
| No `grok -p --resume` | skill + non-goals |

No remaining placeholders. Types share `RosterEntry`, `Mail`, `TalksBus`, `BusDeps` from Task 1 / 7.
