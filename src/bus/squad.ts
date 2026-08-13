import fs from "node:fs";
import path from "node:path";
import { readJson, writeJsonAtomic } from "./fs.js";
import { loadCaps, loadContract } from "./contracts.js";
import type { TalksBus } from "./talks.js";
import type { SessionId } from "./types.js";

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

export type WorkerState = "spawned" | "handoff_sent" | "retired";

export interface SquadMember {
  role: SquadRole;
  sessionId: SessionId;
  name: string;
}

export interface WorkerRecord {
  sessionId: SessionId;
  role: SquadRole;
  task: string;
  state: WorkerState;
}

export interface SquadState {
  leadSessionId: SessionId;
  cwd: string;
  nextSeq: number;
  workers: WorkerRecord[];
  approvals: Record<string, string>;
}

export interface Squad {
  leadSessionId: SessionId;
  members: SquadMember[];
}

export function isSquadRole(value: string): value is SquadRole {
  return (SQUAD_ROLES as readonly string[]).includes(value);
}

export function parseRoles(raw: string | string[] | undefined): SquadRole[] {
  if (raw === undefined || raw === "") return [];
  const parts = Array.isArray(raw) ? raw : raw.split(/[\s,]+/).filter(Boolean);
  if (parts.length === 1 && parts[0] === "all") return [...SQUAD_ROLES];
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

export function squadStatePath(dataDir: string, leadSessionId: SessionId): string {
  return path.join(dataDir, "squad", `${leadSessionId}.json`);
}

export function loadSquadState(dataDir: string, leadSessionId: SessionId): SquadState | undefined {
  return readJson<SquadState>(squadStatePath(dataDir, leadSessionId));
}

export function saveSquadState(dataDir: string, state: SquadState): void {
  writeJsonAtomic(squadStatePath(dataDir, state.leadSessionId), state);
}

export function ensureSquadState(
  dataDir: string,
  leadSessionId: SessionId,
  cwd: string,
): SquadState {
  const existing = loadSquadState(dataDir, leadSessionId);
  if (existing) return existing;
  const fresh: SquadState = { leadSessionId, cwd, nextSeq: 1, workers: [], approvals: {} };
  saveSquadState(dataDir, fresh);
  return fresh;
}

export function activeWorkers(state: SquadState): WorkerRecord[] {
  return state.workers.filter((w) => w.state !== "retired");
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
  ensureSquadState(bus.deps.dataDir, input.leadSessionId, input.cwd);
  const roles = input.roles ?? [];
  const members: SquadMember[] = [];
  for (const role of roles) {
    const spawned = spawnWorker(bus, {
      leadSessionId: input.leadSessionId,
      cwd: input.cwd,
      role,
      task: "briefing",
      body: `You are ${role}. Call talks_role, then talks_inbox. Launch: grok --agent grok-talks:${role}`,
      pid: input.pid,
      skipApproval: true,
      skipCap: true,
    });
    if (!spawned.ok) throw new Error(spawned.error);
    members.push(spawned.member);
  }
  return { leadSessionId: input.leadSessionId, members };
}

export function spawnWorker(
  bus: TalksBus,
  input: {
    leadSessionId: SessionId;
    cwd: string;
    role: SquadRole;
    task: string;
    body: string;
    pid?: number;
    skipApproval?: boolean;
    skipCap?: boolean;
  },
): { ok: true; member: SquadMember } | { ok: false; error: string } {
  const contract = loadContract(input.role);
  const state = ensureSquadState(bus.deps.dataDir, input.leadSessionId, input.cwd);
  if (!input.skipApproval && contract.requiresApproval && !state.approvals[input.task]) {
    return { ok: false, error: `task ${input.task} needs human approval before spawning ${input.role}` };
  }
  if (!input.skipCap) {
    const capError = capExceeded(state, input.role);
    if (capError) return { ok: false, error: capError };
  }

  const lead = bus.board(input.leadSessionId, "all").find((r) => r.session_id === input.leadSessionId);
  const pid = input.pid ?? lead?.pid ?? 1;
  const sessionId = `squad-${input.leadSessionId.slice(0, 8)}-${input.role}-${state.nextSeq}`;
  state.nextSeq += 1;
  const entry = bus.sessionStart({
    sessionId,
    cwd: lead?.cwd ?? input.cwd,
    pid,
    title: input.role,
  });
  bus.setStatus(sessionId, ROLE_BRIEFS[input.role]);
  const brief = bus.handoff(
    input.leadSessionId,
    sessionId,
    input.task,
    input.body ||
      `You are ${input.role}. Call talks_role for your card, then talks_inbox. Launch: grok --agent grok-talks:${input.role}`,
  );
  if (!brief.ok) return { ok: false, error: brief.error };
  state.workers.push({
    sessionId,
    role: input.role,
    task: input.task,
    state: "spawned",
  });
  saveSquadState(bus.deps.dataDir, state);
  return { ok: true, member: { role: input.role, sessionId, name: entry.name } };
}

export function retireWorker(
  bus: TalksBus,
  leadSessionId: SessionId,
  sessionId: SessionId,
): { ok: true } | { ok: false; error: string } {
  const state = loadSquadState(bus.deps.dataDir, leadSessionId);
  if (!state) return { ok: false, error: "no squad for this lead" };
  const worker = state.workers.find((w) => w.sessionId === sessionId);
  if (!worker) return { ok: false, error: `unknown worker ${sessionId}` };
  worker.state = "retired";
  bus.sessionEnd(sessionId);
  saveSquadState(bus.deps.dataDir, state);
  return { ok: true };
}

export function markHandoffSent(dataDir: string, fromSessionId: SessionId): void {
  const states = listSquadStates(dataDir);
  for (const state of states) {
    const worker = state.workers.find((w) => w.sessionId === fromSessionId && w.state !== "retired");
    if (worker) {
      worker.state = "handoff_sent";
      saveSquadState(dataDir, state);
      return;
    }
  }
}

export function requestApproval(dataDir: string, leadSessionId: SessionId, task: string, note: string): void {
  const state = ensureSquadState(dataDir, leadSessionId, "");
  if (state.approvals[task] !== "approved") {
    state.approvals[task] = note.trim() ? `requested:${note.trim()}` : "requested";
  }
  saveSquadState(dataDir, state);
}

export function approveTask(dataDir: string, leadSessionId: SessionId, task: string): void {
  const state = ensureSquadState(dataDir, leadSessionId, "");
  state.approvals[task] = `approved`;
  saveSquadState(dataDir, state);
}

export function isApproved(dataDir: string, leadSessionId: SessionId, task: string): boolean {
  return loadSquadState(dataDir, leadSessionId)?.approvals[task] === "approved";
}

export function squadSessionId(leadSessionId: SessionId, role: SquadRole): SessionId {
  return `squad-${leadSessionId.slice(0, 8)}-${role}`;
}

function capExceeded(state: SquadState, role: SquadRole): string | undefined {
  const caps = loadCaps();
  const live = activeWorkers(state);
  if (live.length >= caps.maxTransient) {
    return `squad full (${caps.maxTransient} live workers)`;
  }
  const per = caps.perRole[role] ?? 1;
  const same = live.filter((w) => w.role === role).length;
  if (same >= per) return `${role} cap is ${per}`;
  return undefined;
}

function listSquadStates(dataDir: string): SquadState[] {
  const dir = path.join(dataDir, "squad");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: SquadState[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const state = readJson<SquadState>(path.join(dir, name));
    if (state) out.push(state);
  }
  return out;
}
