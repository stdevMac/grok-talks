import fs from "node:fs";
import path from "node:path";
import {
  approveTask,
  spawnWorker,
  startSquad,
  type SquadRole,
} from "../../src/bus/squad.js";
import { TalksBus } from "../../src/bus/talks.js";
import type { RoleContribution } from "./contributions.js";
import { WORDMARK } from "./contributions.js";
import { stitchLantern } from "./stitch.js";

const ROLES: SquadRole[] = [
  "planner",
  "explorer",
  "frontend",
  "backend",
  "qa",
  "validator",
  "adversarial",
  "security",
];

export interface PulseResult {
  html: string;
  htmlPath: string;
  contributions: RoleContribution[];
  boardNames: string[];
  collisionDenied: boolean;
  retiredAfterHandoff: boolean;
}

export function runPulseLantern(bus: TalksBus, outDir: string): PulseResult {
  const project = path.resolve(outDir);
  fs.mkdirSync(project, { recursive: true });
  const lead = "lead-lantern";

  bus.sessionStart({ sessionId: lead, cwd: project, pid: 100, title: "lead" });
  bus.promptSubmit(lead, "Ship a neon coworker sign");
  startSquad(bus, { leadSessionId: lead, cwd: project, pid: 100 });

  const contributions: RoleContribution[] = [];
  let collisionDenied = false;

  function take(role: SquadRole, task: string, artifact: string, note: string): string {
    const spawned = spawnWorker(bus, {
      leadSessionId: lead,
      cwd: project,
      role,
      task,
      body: note,
      pid: 100,
    });
    if (!spawned.ok) throw new Error(spawned.error);
    contributions.push({ role, sessionId: spawned.member.sessionId, artifact, note });
    return spawned.member.sessionId;
  }

  take("planner", "plan-sign", "One lamp in a dark room. The wordmark is the product.", "scoped the sign to a single wordmark and a credit roll");
  bus.handoff(contributions.at(-1)!.sessionId, lead, "plan-sign", "plan ready");

  take("explorer", "look", "No existing brand kit. Borrow subway-sign contrast.", "looked around; nothing to reuse");
  bus.handoff(contributions.at(-1)!.sessionId, lead, "look", "nothing to reuse");

  approveTask(bus.deps.dataDir, lead, "glass");
  approveTask(bus.deps.dataDir, lead, "pulse");
  const fe = spawnWorker(bus, {
    leadSessionId: lead,
    cwd: project,
    role: "frontend",
    task: "glass",
    body: "cut the glass wordmark",
    pid: 100,
  });
  const be = spawnWorker(bus, {
    leadSessionId: lead,
    cwd: project,
    role: "backend",
    task: "pulse",
    body: "wire the pulse loop",
    pid: 100,
  });
  if (!fe.ok || !be.ok) throw new Error(fe.ok ? be.error : fe.error);

  bus.promptSubmit(fe.member.sessionId, "drawing the sign");
  bus.touchWrite(fe.member.sessionId, "sign.html", project);
  const collide = bus.decideWrite({
    sessionId: be.member.sessionId,
    relPath: "sign.html",
    cwd: project,
  });
  collisionDenied = collide.decision === "deny";
  bus.say(be.member.sessionId, fe.member.sessionId, "you keep sign.html — I'll ship the pulse");
  const retry = bus.decideWrite({
    sessionId: be.member.sessionId,
    relPath: "sign.html",
    cwd: project,
  });
  if (retry.decision !== "allow") throw new Error("backend should be allowed after talking");

  contributions.push({
    role: "frontend",
    sessionId: fe.member.sessionId,
    artifact: WORDMARK,
    note: "cut the glass wordmark",
  });
  contributions.push({
    role: "backend",
    sessionId: be.member.sessionId,
    artifact: "pulse 2.4s ease-in-out infinite",
    note: "wired the pulse loop",
  });
  bus.handoff(fe.member.sessionId, lead, "glass", "wordmark done", "aaaaaaaa");
  bus.handoff(be.member.sessionId, lead, "pulse", "engine done", "bbbbbbbb");

  const rest: Array<[SquadRole, string, string, string]> = [
    ["validator", "contrast", "#7df9ff", "picked a high-contrast ice neon"],
    ["adversarial", "glitch", "on", "forced a magenta/cyan glitch to keep it honest"],
    ["security", "csp", "default-src 'none'; style-src 'unsafe-inline'", "locked the page to inline CSS only"],
    ["qa", "prove", `roles=${ROLES.length}`, "required every role to leave a fingerprint"],
  ];
  for (const [role, task, artifact, note] of rest) {
    const id = take(role, task, artifact, note);
    bus.handoff(id, lead, task, "done");
  }

  const html = stitchLantern(contributions);
  const htmlPath = path.join(project, "index.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return {
    html,
    htmlPath,
    contributions,
    boardNames: bus.board(lead, "project").map((r) => r.name),
    collisionDenied,
    retiredAfterHandoff: !bus.board(lead, "project").some((r) => r.name !== "lead"),
  };
}
