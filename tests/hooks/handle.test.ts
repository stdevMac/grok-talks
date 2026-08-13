import { describe, expect, it } from "vitest";
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
