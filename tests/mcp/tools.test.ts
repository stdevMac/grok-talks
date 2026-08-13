import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { callTalksTool } from "../../src/mcp/tools.js";
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

  it("talks_squad_start puts roles on the board", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const started = callTalksTool(bus, "lead-1", "talks_squad_start", {
      roles: ["qa", "frontend"],
      cwd: "/repo",
    });
    expect(started.isError).toBeFalsy();
    expect(started.text).toMatch(/frontend/);
    const board = callTalksTool(bus, "lead-1", "talks_board", {});
    expect(board.text).toMatch(/qa/);
  });
});
