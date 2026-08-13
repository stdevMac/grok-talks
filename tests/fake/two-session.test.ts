import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { CHAT_WINDOW_MS, CLAIM_TTL_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("two-session fake", () => {
  it("covers board, chat drain, mute, deny-once, and cross-project allow", () => {
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

    const bus2 = new TalksBus({ dataDir: d.dataDir, clock: d.clock, pid: d.pid });
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

    bus.heartbeat("aaa");
    bus.heartbeat("bbb");
    d.clock.advance(CHAT_WINDOW_MS);
    bus.heartbeat("aaa");
    bus.heartbeat("bbb");
    for (let i = 0; i < 10; i++) expect(bus.say("bbb", "aaa", "n" + i).ok).toBe(true);
    expect(bus.say("bbb", "aaa", "n10").ok).toBe(false);
    bus.unmute("aaa", "bbb");
    bus.drain("aaa", 100);
    d.clock.advance(CHAT_WINDOW_MS);
    bus.heartbeat("aaa");
    bus.heartbeat("bbb");
    for (let i = 0; i < 10; i++) expect(bus.say("bbb", "aaa", "cap" + i).ok).toBe(true);
    const drained = bus.drain("aaa", 8);
    expect(drained.length).toBe(8);
    expect(bus.drain("aaa", 8).length).toBe(2);
  });
});
