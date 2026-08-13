import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

function two(projectA = "/repo", projectB = "/repo") {
  const d = deps();
  const bus = new TalksBus(d);
  bus.sessionStart({ sessionId: "aaa", cwd: projectA, pid: 100 });
  bus.sessionStart({ sessionId: "bbb", cwd: projectB, pid: 200 });
  bus.promptSubmit("aaa", "working on auth");
  bus.touchWrite("aaa", "src/auth.ts", projectA);
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
    expect(
      bus.decideWrite({ sessionId: "bbb", relPath: "src/auth.ts.bak", cwd: "/repo" }).decision,
    ).toBe("allow");
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
