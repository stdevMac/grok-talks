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

export function loadCaps(): SquadCaps {
  const file = path.join(squadDir(), "caps.json");
  return JSON.parse(fs.readFileSync(file, "utf8")) as SquadCaps;
}

export function handoffDenied(from: RosterEntry | undefined, to: RosterEntry): string | undefined {
  if (!from) return undefined;
  const fromRole = cardFromSession(from.name, from.session_id);
  if (!fromRole || fromRole === "lead") return undefined;
  const contract = loadContract(fromRole);
  const toRole = cardFromSession(to.name, to.session_id) ?? to.name;
  if (contract.handoffTargets.includes(toRole)) return undefined;
  if (contract.handoffTargets.includes("lead") && (toRole === "lead" || to.name === "lead")) {
    return undefined;
  }
  return `${fromRole} may only handoff to ${contract.handoffTargets.join(", ")}`;
}

export function isCardRole(value: string): value is SquadCardName {
  return isCard(value);
}
