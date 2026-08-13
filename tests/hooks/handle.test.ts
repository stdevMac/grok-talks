import { describe, expect, it } from "vitest";
import { isApproved, requestApproval, spawnWorker, startSquad } from "../../src/bus/squad.js";
import { TalksBus } from "../../src/bus/talks.js";
import { handleHook } from "../../src/hooks/handle.js";
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

  it("does not let a denied working peer block the original writer's next write", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start" }), { pid: 100 });
    handleHook(bus, base({ hookEventName: "session_start", sessionId: "bbb" }), { pid: 200 });
    handleHook(bus, base({ hookEventName: "user_prompt_submit", prompt: "A owns auth" }), { pid: 100 });
    handleHook(
      bus,
      base({ hookEventName: "user_prompt_submit", sessionId: "bbb", prompt: "B also wants auth" }),
      { pid: 200 },
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
    const retry = handleHook(
      bus,
      base({
        hookEventName: "pre_tool_use",
        toolName: "search_replace",
        toolInput: { file_path: "/repo/src/auth.ts" },
      }),
      { pid: 100 },
    );
    expect(retry).toBeUndefined();
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

  it("records /approve without clobbering working_on and nags pending approvals on stop", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start", sessionId: "lead-1" }), { pid: 100 });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    bus.promptSubmit("lead-1", "Ship the sign");
    requestApproval(d.dataDir, "lead-1", "glass", "own the wordmark");
    const nag = handleHook(
      bus,
      base({ hookEventName: "stop", sessionId: "lead-1", reason: "end_turn", sessionCrons: [] }),
      { pid: 100 },
    );
    expect(JSON.stringify(nag)).toMatch(/Pending human approvals: glass/);
    handleHook(
      bus,
      base({ hookEventName: "user_prompt_submit", sessionId: "lead-1", prompt: "/approve glass" }),
      { pid: 100 },
    );
    expect(isApproved(d.dataDir, "lead-1", "glass")).toBe(true);
    expect(bus.board("lead-1", "project")[0].working_on).toBe("Ship the sign");
    const after = handleHook(
      bus,
      base({ hookEventName: "stop", sessionId: "lead-1", reason: "end_turn", sessionCrons: [] }),
      { pid: 100 },
    );
    expect(JSON.stringify(after) ?? "").not.toMatch(/Pending human approvals/);
  });

  it("keeps a spawned worker's role name and status when the TUI attaches", () => {
    const d = deps();
    const bus = new TalksBus(d);
    handleHook(bus, base({ hookEventName: "session_start", sessionId: "lead-1" }), { pid: 100 });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    const spawned = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice it",
      pid: 100,
    });
    expect(spawned.ok).toBe(true);
    if (!spawned.ok) return;
    handleHook(
      bus,
      base({ hookEventName: "session_start", sessionId: spawned.member.sessionId }),
      { pid: 100 },
    );
    const row = bus.board("lead-1", "project").find((r) => r.session_id === spawned.member.sessionId);
    expect(row?.name).toBe("planner");
    expect(row?.working_on).toMatch(/ordered slices/);
  });
});
