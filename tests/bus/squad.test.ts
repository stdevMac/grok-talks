import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  SQUAD_ROLES,
  activeWorkers,
  approveTask,
  gcDeadWorkers,
  loadSquadState,
  markWorkerAttached,
  parseRoles,
  spawnWorker,
  startSquad,
} from "../../src/bus/squad.js";
import { TalksBus } from "../../src/bus/talks.js";
import { HEARTBEAT_MS, SPAWN_GRACE_MS } from "../../src/bus/types.js";
import { writeRoster } from "../../src/bus/roster.js";
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

    expect(fe.member.launch).toMatch(
      /--session-id [0-9a-f-]{36} --agent grok-talks:frontend "Call talks_role/,
    );
    const back = bus.handoff(fe.member.sessionId, "lead", "glass", "sign.html done", "abc1234");
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.mail.commit).toBe("abc1234");
    expect(loadSquadState(d.dataDir, "lead-1")?.workers.find((w) => w.sessionId === fe.member.sessionId)?.state).toBe(
      "retired",
    );
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

  it("spawns visual-qa without approval and serves the critic card", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    const critic = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "visual-qa",
      task: "critique-ui",
      body: "tear the sign apart",
    });
    expect(critic.ok).toBe(true);
    if (!critic.ok) return;
    expect(critic.member.launch).toMatch(/--agent grok-talks:visual-qa/);
    const card = bus.roleCard(critic.member.sessionId);
    expect(card.ok).toBe(true);
    if (card.ok) {
      expect(card.role).toBe("visual-qa");
      expect(card.text).toMatch(/punch list/i);
    }
  });

  it("refuses a non-sha commit, allows worker→lead by session id, and blocks worker spawn", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "host" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    expect(bus.board("lead-1", "project")[0].name).toBe("lead");

    const planner = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice it",
    });
    expect(planner.ok).toBe(true);
    if (!planner.ok) return;

    const bad = bus.handoff(planner.member.sessionId, "lead-1", "plan", "done", "not a sha");
    expect(bad.ok).toBe(false);

    const nested = spawnWorker(bus, {
      leadSessionId: planner.member.sessionId,
      cwd: "/repo",
      role: "qa",
      task: "prove",
      body: "no",
    });
    expect(nested.ok).toBe(false);
    if (!nested.ok) expect(nested.error).toMatch(/only the lead/);

    const lead = bus.board("lead-1", "all").find((r) => r.session_id === "lead-1")!;
    writeRoster(d, { ...lead, name: "host" });
    const back = bus.handoff(planner.member.sessionId, "lead-1", "plan", "done");
    expect(back.ok).toBe(true);
    expect(activeWorkers(loadSquadState(d.dataDir, "lead-1")!).length).toBe(0);
  });

  it("does not GC an unattached spawn during grace, even with a dead placeholder pid", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });

    const waiting = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice",
      pid: 999,
    });
    expect(waiting.ok).toBe(true);
    expect(gcDeadWorkers(bus, "lead-1")).toBe(0);
    expect(bus.board("lead-1", "project").some((r) => r.name === "planner")).toBe(true);
  });

  it("garbage-collects attached workers whose pid is dead, and unattached after grace", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });

    const dead = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice",
      pid: 999,
    });
    expect(dead.ok).toBe(true);
    if (!dead.ok) return;
    markWorkerAttached(d.dataDir, dead.member.sessionId);
    expect(gcDeadWorkers(bus, "lead-1")).toBe(1);
    expect(activeWorkers(loadSquadState(d.dataDir, "lead-1")!).length).toBe(0);

    const stale = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "explorer",
      task: "look",
      body: "scan",
      pid: 100,
    });
    expect(stale.ok).toBe(true);
    d.clock.advance(SPAWN_GRACE_MS + 1);
    expect(gcDeadWorkers(bus)).toBe(1);
    expect(activeWorkers(loadSquadState(d.dataDir, "lead-1")!).length).toBe(0);
  });

  it("still spawns when the lead is off the live board and does not use pid 1", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "lead-1", cwd: "/repo", pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd: "/repo" });
    d.clock.advance(HEARTBEAT_MS + 1);
    expect(bus.board("lead-1", "all").some((r) => r.session_id === "lead-1")).toBe(false);
    const spawned = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd: "/repo",
      role: "planner",
      task: "plan",
      body: "slice",
    });
    expect(spawned.ok).toBe(true);
    expect(gcDeadWorkers(bus)).toBe(0);
  });

  it("honors .grok/talks-pack.json caps in the project", () => {
    const d = deps();
    const bus = new TalksBus(d);
    const cwd = path.join(d.dataDir, "repo");
    fs.mkdirSync(path.join(cwd, ".grok"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".grok", "talks-pack.json"),
      JSON.stringify({ maxTransient: 1, perRole: { planner: 3 } }),
    );
    bus.sessionStart({ sessionId: "lead-1", cwd, pid: 100, title: "lead" });
    startSquad(bus, { leadSessionId: "lead-1", cwd });
    const first = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd,
      role: "planner",
      task: "plan",
      body: "one",
    });
    expect(first.ok).toBe(true);
    const second = spawnWorker(bus, {
      leadSessionId: "lead-1",
      cwd,
      role: "planner",
      task: "plan-2",
      body: "two",
    });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toMatch(/squad full/);
  });
});

