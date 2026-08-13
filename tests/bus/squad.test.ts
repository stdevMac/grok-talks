import { describe, expect, it } from "vitest";
import { SQUAD_ROLES, parseRoles, startSquad } from "../../src/bus/squad.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

describe("squad", () => {
  it("starts named roles on the same office so they appear on the board and can talk", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const squad = startSquad(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      roles: ["planner", "frontend", "backend", "qa", "validator", "adversarial"],
    });
    expect(squad.members.map((m) => m.role)).toEqual([
      "planner",
      "frontend",
      "backend",
      "qa",
      "validator",
      "adversarial",
    ]);
    const board = bus.board("lead-1", "project");
    for (const member of squad.members) {
      expect(board.some((row) => row.session_id === member.sessionId && row.name === member.role)).toBe(
        true,
      );
    }
    const said = bus.say(squad.members[0].sessionId, squad.members[1].sessionId, "own the neon CSS");
    expect(said.ok).toBe(true);
    const inbox = bus.drain(squad.members[1].sessionId);
    expect(inbox.some((m) => m.body.includes("neon CSS"))).toBe(true);
  });

  it("applies the same deny-once collision rules between roles", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const squad = startSquad(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      roles: ["frontend", "backend"],
    });
    const fe = squad.members[0].sessionId;
    const be = squad.members[1].sessionId;
    bus.promptSubmit(fe, "drawing the sign");
    bus.touchWrite(fe, "/repo/sign.html");
    const first = bus.decideWrite({ sessionId: be, relPath: "sign.html", cwd: "/repo" });
    expect(first.decision).toBe("deny");
    bus.say(be, fe, "you keep sign.html");
    const second = bus.decideWrite({ sessionId: be, relPath: "sign.html", cwd: "/repo" });
    expect(second.decision).toBe("allow");
  });

  it("defaults to the full role list and rejects unknown roles", () => {
    expect(parseRoles(undefined)).toEqual([...SQUAD_ROLES]);
    expect(() => parseRoles("wizard")).toThrow(/unknown squad role/);
  });
});
