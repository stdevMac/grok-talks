import { describe, expect, it } from "vitest";
import { LOOP_PROMPT } from "../../src/bus/loop.js";
import { TalksBus } from "../../src/bus/talks.js";
import { STATUS_MAX } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("TalksBus", () => {
  it("sessionEnd removes roster and claims but leaves inbox", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200 });
    bus.say("aaa", "aaa", "note");
    bus.sessionEnd("aaa");
    expect(bus.board("bbb", "all").map((p) => p.session_id)).toEqual(["bbb"]);
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

  it("preserves name and working_on when the same session attaches again", () => {
    const bus = new TalksBus(deps());
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.setStatus("aaa", "editing auth");
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    const row = bus.board("aaa", "project")[0];
    expect(row.name).toBe("A");
    expect(row.working_on).toBe("editing auth");
  });
});
