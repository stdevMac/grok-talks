import fs from "node:fs";
import path from "node:path";
import { startSquad, type SquadRole } from "../../src/bus/squad.js";
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
}

export function runPulseLantern(bus: TalksBus, outDir: string): PulseResult {
  const project = path.resolve(outDir);
  fs.mkdirSync(project, { recursive: true });

  bus.sessionStart({ sessionId: "lead-lantern", cwd: project, pid: 100, title: "lead" });
  bus.promptSubmit("lead-lantern", "Ship a neon coworker sign");
  const squad = startSquad(bus, {
    leadSessionId: "lead-lantern",
    cwd: project,
    roles: ROLES,
    pid: 100,
  });

  const byRole = Object.fromEntries(squad.members.map((m) => [m.role, m]));

  bus.say(byRole.planner.sessionId, byRole.frontend.sessionId, "own the wordmark on the glass");
  bus.say(byRole.frontend.sessionId, byRole.backend.sessionId, "I need a pulse engine, not a static poster");
  bus.say(byRole.qa.sessionId, byRole.planner.sessionId, "I will fail the run if fewer than two roles write");

  const signPath = "sign.html";
  bus.promptSubmit(byRole.frontend.sessionId, "drawing the sign");
  bus.touchWrite(byRole.frontend.sessionId, signPath, project);
  const collide = bus.decideWrite({
    sessionId: byRole.backend.sessionId,
    relPath: signPath,
    cwd: project,
  });
  const collisionDenied = collide.decision === "deny";
  bus.say(byRole.backend.sessionId, byRole.frontend.sessionId, "you keep sign.html — I'll ship the pulse");
  const retry = bus.decideWrite({
    sessionId: byRole.backend.sessionId,
    relPath: signPath,
    cwd: project,
  });
  if (retry.decision !== "allow") {
    throw new Error("backend should be allowed to write after talking");
  }

  const contributions: RoleContribution[] = [
    {
      role: "planner",
      sessionId: byRole.planner.sessionId,
      artifact: "One lamp in a dark room. The wordmark is the product.",
      note: "scoped the sign to a single wordmark and a credit roll",
    },
    {
      role: "explorer",
      sessionId: byRole.explorer.sessionId,
      artifact: "No existing brand kit. Borrow subway-sign contrast.",
      note: "looked around; nothing to reuse",
    },
    {
      role: "frontend",
      sessionId: byRole.frontend.sessionId,
      artifact: WORDMARK,
      note: "cut the glass wordmark",
    },
    {
      role: "backend",
      sessionId: byRole.backend.sessionId,
      artifact: "pulse 2.4s ease-in-out infinite",
      note: "wired the pulse loop",
    },
    {
      role: "validator",
      sessionId: byRole.validator.sessionId,
      artifact: "#7df9ff",
      note: "picked a high-contrast ice neon",
    },
    {
      role: "adversarial",
      sessionId: byRole.adversarial.sessionId,
      artifact: "on",
      note: "forced a magenta/cyan glitch to keep it honest",
    },
    {
      role: "security",
      sessionId: byRole.security.sessionId,
      artifact: "default-src 'none'; style-src 'unsafe-inline'",
      note: "locked the page to inline CSS only",
    },
    {
      role: "qa",
      sessionId: byRole.qa.sessionId,
      artifact: `roles=${contributionsExpected()}`,
      note: "required every role to leave a fingerprint",
    },
  ];

  const html = stitchLantern(contributions);
  const htmlPath = path.join(project, "index.html");
  fs.writeFileSync(htmlPath, html, "utf8");

  return {
    html,
    htmlPath,
    contributions,
    boardNames: bus.board("lead-lantern", "project").map((r) => r.name),
    collisionDenied,
  };
}

function contributionsExpected(): number {
  return ROLES.length;
}
