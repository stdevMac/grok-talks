import { describe, expect, it } from "vitest";
import { approveTask } from "../../src/bus/squad.js";
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

  it("talks_role and talks_handoff drive the shipped squad cards", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const started = callTalksTool(bus, "lead-1", "talks_squad_start", {
      roles: ["planner"],
      cwd: "/repo",
    });
    const plannerId = started.text.split("\t")[1];
    const card = callTalksTool(bus, plannerId, "talks_role", {});
    expect(card.isError).toBeFalsy();
    expect(card.text).toMatch(/Planner/);
    const sent = callTalksTool(bus, "lead-1", "talks_handoff", {
      to: "planner",
      task: "plan-login",
      body: "slice the login job",
    });
    expect(sent.isError).toBeFalsy();
    const inbox = callTalksTool(bus, plannerId, "talks_inbox", {});
    expect(inbox.text).toMatch(/plan-login/);
  });

  it("talks_spawn requires approval for frontend then retire drops them", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const denied = callTalksTool(bus, "lead-1", "talks_spawn", {
      role: "frontend",
      task: "ui-1",
      body: "the glass",
      cwd: "/repo",
    });
    expect(denied.isError).toBe(true);
    approveTask(d.dataDir, "lead-1", "ui-1");
    const spawned = callTalksTool(bus, "lead-1", "talks_spawn", {
      role: "frontend",
      task: "ui-1",
      body: "the glass",
      cwd: "/repo",
    });
    expect(spawned.isError).toBeFalsy();
    const id = spawned.text.split("\t")[1];
    expect(spawned.text).toMatch(/--session-id /);
    const board = callTalksTool(bus, "lead-1", "talks_board", {});
    expect(board.text).toMatch(/\[spawned task=ui-1\]/);
    const approve = callTalksTool(bus, "lead-1", "talks_approve", { task: "ui-1" });
    expect(approve.isError).toBe(true);
    expect(approve.text).toMatch(/only the human/);
    expect(callTalksTool(bus, "lead-1", "talks_retire", { session_id: id }).text).toBe("retired");
  });
});

