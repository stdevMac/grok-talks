import fs from "node:fs";
import path from "node:path";
import { cardFromSession, isCard, squadDir, type SquadCardName } from "./roleCards.js";
import type { RosterEntry } from "./types.js";

export interface RoleContract {
  role: SquadCardName;
  handoffTargets: string[];
  mayTalkToUser: boolean;
  maySpawn: boolean;
  requiresApproval: boolean;
  writes: string[];
}

export interface SquadCaps {
  maxTransient: number;
  perRole: Partial<Record<string, number>>;
}

export function loadContract(role: SquadCardName): RoleContract {
  const file = path.join(squadDir(), "contracts", `${role}.json`);
  const raw = fs.readFileSync(file, "utf8");
  return JSON.parse(raw) as RoleContract;
}

export function loadCaps(cwd?: string): SquadCaps {
  const file = path.join(squadDir(), "caps.json");
  const base = JSON.parse(fs.readFileSync(file, "utf8")) as SquadCaps;
  if (!cwd) return normalizeCaps(base);
  const pack = path.join(cwd, ".grok", "talks-pack.json");
  try {
    const extra = JSON.parse(fs.readFileSync(pack, "utf8")) as Partial<SquadCaps>;
    const perRole = { ...base.perRole };
    for (const [role, value] of Object.entries(extra.perRole ?? {})) {
      const n = asCount(value, 0);
      if (n > 0) perRole[role] = n;
    }
    return normalizeCaps({
      maxTransient: extra.maxTransient ?? base.maxTransient,
      perRole,
    });
  } catch {
    return normalizeCaps(base);
  }
}

export function handoffDenied(
  from: RosterEntry | undefined,
  to: RosterEntry,
  opts?: { toIsLead?: boolean },
): string | undefined {
  if (!from) return undefined;
  const fromRole = cardFromSession(from.name, from.session_id);
  if (!fromRole || fromRole === "lead") return undefined;
  const contract = loadContract(fromRole);
  const toRole = cardFromSession(to.name, to.session_id) ?? to.name;
  if (contract.handoffTargets.includes(toRole)) return undefined;
  if (
    contract.handoffTargets.includes("lead") &&
    (toRole === "lead" || to.name === "lead" || opts?.toIsLead)
  ) {
    return undefined;
  }
  return `${fromRole} may only handoff to ${contract.handoffTargets.join(", ")}`;
}

export function isCardRole(value: string): value is SquadCardName {
  return isCard(value);
}

function asCount(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 1
    ? Math.floor(value)
    : fallback;
}

function normalizeCaps(caps: SquadCaps): SquadCaps {
  const perRole: SquadCaps["perRole"] = {};
  for (const [role, value] of Object.entries(caps.perRole ?? {})) {
    const n = asCount(value, 0);
    if (n > 0) perRole[role] = n;
  }
  return { maxTransient: asCount(caps.maxTransient, 4), perRole };
}
