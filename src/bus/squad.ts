import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { cardFromSession } from "./roleCards.js";
import { readJson, writeJsonAtomic } from "./fs.js";
import { loadCaps, loadContract } from "./contracts.js";
import { isLive, readRoster, writeRoster } from "./roster.js";
import type { TalksBus } from "./talks.js";
import { toIso } from "./clock.js";
import type { RosterEntry, SessionId } from "./types.js";
import { SPAWN_GRACE_MS } from "./types.js";

export const SQUAD_ROLES = [
  "planner",
  "explorer",
  "frontend",
  "backend",
  "qa",
  "validator",
  "adversarial",
  "security",
  "visual-qa",
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
  "visual-qa": "Savage visual critique: hierarchy, type, motion, taste. Punch list only.",
};

export type WorkerState = "spawned" | "handoff_sent" | "retired";

export interface SquadMember {
  role: SquadRole;
  sessionId: SessionId;
  name: string;
  launch: string;
}

export const WORKER_FIRST_TURN =
  "Call talks_role, then talks_inbox. If a talks_* tool asks for a session id, pass caller=<the --session-id>. Do only the assigned slice. Handoff only the lead.";

export function launchLine(role: string, sessionId: string): string {
  const kick = `${WORKER_FIRST_TURN} caller=${sessionId}`;
  return `grok --session-id ${sessionId} --agent grok-talks:${role} ${JSON.stringify(kick)}`;
}

export interface WorkerRecord {
  sessionId: SessionId;
  role: SquadRole;
  task: string;
  state: WorkerState;
  spawnedAt?: string;
  attached?: boolean;
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
  const lead = readRoster(bus.deps, input.leadSessionId);
  if (lead) writeRoster(bus.deps, { ...lead, name: "lead" });
  ensureSquadState(bus.deps.dataDir, input.leadSessionId, input.cwd);
  const roles = input.roles ?? [];
  const members: SquadMember[] = [];
  for (const role of roles) {
    const spawned = spawnWorker(bus, {
      leadSessionId: input.leadSessionId,
      cwd: input.cwd,
      role,
      task: "briefing",
      body: `You are ${role}. Call talks_role, then talks_inbox.`,
      pid: input.pid,
      skipApproval: true,
      skipCap: true,
    });
    if (!spawned.ok) throw new Error(spawned.error);
    members.push(spawned.member);
  }
  gcDeadWorkers(bus, input.leadSessionId);
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
  if (findWorker(bus.deps.dataDir, input.leadSessionId)) {
    return { ok: false, error: "only the lead can spawn" };
  }
  const contract = loadContract(input.role);
  const state = ensureSquadState(bus.deps.dataDir, input.leadSessionId, input.cwd);
  if (!input.skipApproval && contract.requiresApproval && state.approvals[input.task] !== "approved") {
    return { ok: false, error: `task ${input.task} needs human approval before spawning ${input.role}` };
  }

  gcDeadWorkers(bus, input.leadSessionId);
  const fresh = ensureSquadState(bus.deps.dataDir, input.leadSessionId, input.cwd);
  if (!input.skipCap) {
    const capError = capExceeded(fresh, input.role, input.cwd);
    if (capError) return { ok: false, error: capError };
  }

  const lead = readRoster(bus.deps, input.leadSessionId);
  const rawPid = input.pid ?? lead?.pid ?? 0;
  const pid = rawPid > 1 ? rawPid : 0;
  const sessionId = randomUUID();
  fresh.nextSeq += 1;
  const entry = bus.sessionStart({
    sessionId,
    cwd: lead?.cwd ?? input.cwd,
    pid,
    title: input.role,
  });
  bus.setStatus(sessionId, ROLE_BRIEFS[input.role]);
  const launch = launchLine(input.role, sessionId);
  const brief = bus.handoff(
    input.leadSessionId,
    sessionId,
    input.task,
    `${(input.body || `You are ${input.role}. Call talks_role, then talks_inbox.`).trim()}\nAttach: ${launch}`,
  );
  if (!brief.ok) {
    bus.sessionEnd(sessionId);
    return { ok: false, error: brief.error };
  }
  fresh.workers.push({
    sessionId,
    role: input.role,
    task: input.task,
    state: "spawned",
    spawnedAt: toIso(bus.deps.clock.now()),
    attached: false,
  });
  saveSquadState(bus.deps.dataDir, fresh);
  return { ok: true, member: { role: input.role, sessionId, name: entry.name, launch } };
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

export function retireIfWorkerToLead(bus: TalksBus, fromId: SessionId, to: RosterEntry): void {
  for (const state of listSquadStates(bus.deps.dataDir)) {
    const worker = state.workers.find((w) => w.sessionId === fromId && w.state !== "retired");
    if (!worker) continue;
    const toRole = cardFromSession(to.name, to.session_id);
    if (to.session_id === state.leadSessionId || toRole === "lead" || to.name === "lead") {
      retireWorker(bus, state.leadSessionId, fromId);
      return;
    }
  }
}

export function gcDeadWorkers(bus: TalksBus, _leadSessionId?: SessionId): number {
  const now = bus.deps.clock.now().getTime();
  let n = 0;
  for (const state of listSquadStates(bus.deps.dataDir)) {
    for (const w of activeWorkers(state)) {
      if (withinSpawnGrace(w, now)) continue;
      const entry = readRoster(bus.deps, w.sessionId);
      if (!entry || !isLive(bus.deps, entry)) {
        retireWorker(bus, state.leadSessionId, w.sessionId);
        n += 1;
      }
    }
  }
  return n;
}

export function markWorkerAttached(dataDir: string, sessionId: SessionId): void {
  for (const state of listSquadStates(dataDir)) {
    const worker = state.workers.find((w) => w.sessionId === sessionId);
    if (!worker || worker.attached) continue;
    worker.attached = true;
    saveSquadState(dataDir, state);
    return;
  }
}

export function withinSpawnGrace(worker: WorkerRecord, nowMs: number): boolean {
  if (worker.attached || worker.state === "retired") return false;
  const t = Date.parse(worker.spawnedAt ?? "");
  return Number.isFinite(t) && nowMs - t < SPAWN_GRACE_MS;
}

export function spawningRoster(bus: TalksBus): RosterEntry[] {
  const now = bus.deps.clock.now().getTime();
  const out: RosterEntry[] = [];
  for (const state of listSquadStates(bus.deps.dataDir)) {
    for (const w of activeWorkers(state)) {
      if (!withinSpawnGrace(w, now)) continue;
      const entry = readRoster(bus.deps, w.sessionId);
      if (entry) out.push(entry);
    }
  }
  return out;
}

export function isKnownLead(dataDir: string, sessionId: SessionId): boolean {
  return listSquadStates(dataDir).some((s) => s.leadSessionId === sessionId);
}

export function findWorker(dataDir: string, sessionId: SessionId): WorkerRecord | undefined {
  for (const state of listSquadStates(dataDir)) {
    const w = state.workers.find((row) => row.sessionId === sessionId);
    if (w) return w;
  }
  return undefined;
}

export function parseHumanApprove(prompt: string): string | undefined {
  const m = prompt.trim().match(/^\/approve\s+(\S+)/i);
  return m?.[1];
}

export function pendingApprovals(dataDir: string, leadSessionId: SessionId): string[] {
  const state = loadSquadState(dataDir, leadSessionId);
  if (!state) return [];
  return Object.entries(state.approvals)
    .filter(([, v]) => v === "requested" || v.startsWith("requested:"))
    .map(([task]) => task);
}

export function requestApproval(dataDir: string, leadSessionId: SessionId, task: string, note: string): void {
  const taskName = task.trim();
  if (!taskName || findWorker(dataDir, leadSessionId)) return;
  const state = ensureSquadState(dataDir, leadSessionId, "");
  if (state.approvals[taskName] !== "approved") {
    state.approvals[taskName] = note.trim() ? `requested:${note.trim()}` : "requested";
  }
  saveSquadState(dataDir, state);
}

export function approveTask(dataDir: string, leadSessionId: SessionId, task: string): void {
  const taskName = task.trim();
  if (!taskName) return;
  let leadId = leadSessionId;
  if (!loadSquadState(dataDir, leadId)) {
    for (const state of listSquadStates(dataDir)) {
      if (state.workers.some((w) => w.sessionId === leadSessionId)) {
        leadId = state.leadSessionId;
        break;
      }
    }
  }
  const state = ensureSquadState(dataDir, leadId, "");
  state.approvals[taskName] = "approved";
  saveSquadState(dataDir, state);
}

export function isApproved(dataDir: string, leadSessionId: SessionId, task: string): boolean {
  return loadSquadState(dataDir, leadSessionId)?.approvals[task] === "approved";
}

export function squadSessionId(leadSessionId: SessionId, role: SquadRole): SessionId {
  return `squad-${leadSessionId.slice(0, 8)}-${role}`;
}

function capExceeded(state: SquadState, role: SquadRole, cwd?: string): string | undefined {
  const caps = loadCaps(cwd || state.cwd);
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
