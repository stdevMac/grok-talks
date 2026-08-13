import { TalksBus } from "./talks.js";
import type { RosterEntry, SessionId } from "./types.js";

export const SQUAD_ROLES = [
  "planner",
  "explorer",
  "frontend",
  "backend",
  "qa",
  "validator",
  "adversarial",
  "security",
] as const;

export type SquadRole = (typeof SQUAD_ROLES)[number];

export const ROLE_BRIEFS: Record<SquadRole, string> = {
  planner: "Break the job into ordered slices and name owners.",
  explorer: "Read the repo and report what already exists.",
  frontend: "Own presentation: markup, motion, and what the human sees.",
  backend: "Own the engine: state, frames, and how pieces stitch.",
  qa: "Write checks that prove more than one role actually shipped.",
  validator: "Reject outputs that break the contract (contrast, structure, names).",
  adversarial: "Try to break the sample; file collisions and ugly edge cases.",
  security: "Keep secrets out of the bus and the sample; lock down markup.",
};

export interface SquadMember {
  role: SquadRole;
  sessionId: SessionId;
  name: string;
}

export interface Squad {
  leadSessionId: SessionId;
  members: SquadMember[];
}

export function isSquadRole(value: string): value is SquadRole {
  return (SQUAD_ROLES as readonly string[]).includes(value);
}

export function parseRoles(raw: string | string[] | undefined): SquadRole[] {
  if (!raw) return [...SQUAD_ROLES];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\s,]+/).filter(Boolean);
  const roles: SquadRole[] = [];
  for (const part of parts) {
    const key = part.trim().toLowerCase();
    if (!isSquadRole(key)) {
      throw new Error(`unknown squad role: ${part}`);
    }
    if (!roles.includes(key)) roles.push(key);
  }
  return roles;
}

export function startSquad(
  bus: TalksBus,
  input: {
    leadSessionId: SessionId;
    cwd: string;
    roles?: SquadRole[];
    pid?: number;
  },
): Squad {
  const lead = bus.board(input.leadSessionId, "all").find((r) => r.session_id === input.leadSessionId);
  const pid = input.pid ?? lead?.pid ?? 1;
  const roles = input.roles && input.roles.length > 0 ? input.roles : [...SQUAD_ROLES];
  const members: SquadMember[] = [];
  for (const role of roles) {
    const sessionId = squadSessionId(input.leadSessionId, role);
    const entry: RosterEntry = bus.sessionStart({
      sessionId,
      cwd: lead?.cwd ?? input.cwd,
      pid,
      title: role,
    });
    bus.setStatus(sessionId, ROLE_BRIEFS[role]);
    members.push({ role, sessionId, name: entry.name });
  }
  return { leadSessionId: input.leadSessionId, members };
}

export function squadSessionId(leadSessionId: SessionId, role: SquadRole): SessionId {
  return `squad-${leadSessionId.slice(0, 8)}-${role}`;
}
