import { describe, expect, it } from "vitest";
import {
  SQUAD_ROLES,
  activeWorkers,
  approveTask,
  loadSquadState,
  parseRoles,
  retireWorker,
  spawnWorker,
  startSquad,
} from "../../src/bus/squad.js";
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

  it("parses empty as no standing workers, all as the full set", () => {
    expect(parseRoles(undefined)).toEqual([]);
    expect(parseRoles("all")).toEqual([...SQUAD_ROLES]);
    expect(() => parseRoles("wizard")).toThrow(/unknown squad role/);
  });

  it("briefs each role with a handoff and serves the role card", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const squad = startSquad(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      roles: ["planner"],
    });
    const mail = bus.inbox(squad.members[0].sessionId);
    expect(mail.some((m) => m.kind === "handoff" && m.body.includes("talks_role"))).toBe(true);
    const card = bus.roleCard(squad.members[0].sessionId);
    expect(card.ok).toBe(true);
    if (card.ok) {
      expect(card.role).toBe("planner");
      expect(card.text).toMatch(/Does not own/);
    }
    const assigned = bus.handoff("lead-1", "planner", "slice-auth", "spec the token refresh");
    expect(assigned.ok).toBe(true);
    expect(bus.inbox(squad.members[0].sessionId).some((m) => m.body.includes("TASK slice-auth"))).toBe(
      true,
    );
  });

  it("spawns transients under caps, blocks unapproved product roles, and retires them", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    expect(loadSquadState(d.dataDir, "lead-1")?.workers).toEqual([]);

    const blocked = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "frontend",
      task: "glass",
      body: "own the sign",
    });
    expect(blocked.ok).toBe(false);

    approveTask(d.dataDir, "lead-1", "glass");
    const fe = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "frontend",
      task: "glass",
      body: "own the sign",
    });
    expect(fe.ok).toBe(true);
    if (!fe.ok) return;

    bus.sessionStart({ sessionId: "be", cwd: "/repo", pid: 200, title: "backend" });
    const peer = bus.handoff(fe.member.sessionId, "backend", "nope", "take this");
    expect(peer.ok).toBe(false);
    if (!peer.ok) expect(peer.error).toMatch(/only handoff/);

    const back = bus.handoff(fe.member.sessionId, "lead", "glass", "sign.html done");
    expect(back.ok).toBe(true);
    expect(loadSquadState(d.dataDir, "lead-1")?.workers[0].state).toBe("handoff_sent");

    expect(retireWorker(bus, "lead-1", fe.member.sessionId).ok).toBe(true);
    expect(activeWorkers(loadSquadState(d.dataDir, "lead-1")!).length).toBe(0);
    expect(bus.board("lead-1", "project").some((r) => r.session_id === fe.member.sessionId)).toBe(
      false,
    );
  });

  it("refuses a second planner while one is live", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    const first = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice it",
    });
    expect(first.ok).toBe(true);
    const second = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan-2",
      body: "again",
    });
    expect(second.ok).toBe(false);
  });
});

