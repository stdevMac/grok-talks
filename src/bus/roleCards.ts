import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ALL_SQUAD_CARDS = ["lead", ...([
  "planner",
  "explorer",
  "frontend",
  "backend",
  "qa",
  "validator",
  "adversarial",
  "security",
  "visual-qa",
] as const)] as const;

export type SquadCardName = (typeof ALL_SQUAD_CARDS)[number];

export function squadDir(): string {
  if (process.env.GROK_PLUGIN_ROOT) {
    return path.join(process.env.GROK_PLUGIN_ROOT, "squad");
  }
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, "..", "..", "squad");
}

export function loadConstitution(): string {
  return readSquadFile("CONSTITUTION.md");
}

export function loadRoleCard(role: SquadCardName): string {
  return readSquadFile(path.join("roles", `${role}.md`));
}

export function loadWorkerProtocol(): string {
  return readSquadFile("WORKER.md");
}

export function formatRoleBriefing(role: SquadCardName): string {
  const parts = [loadConstitution(), loadRoleCard(role)];
  if (role !== "lead") parts.push(loadWorkerProtocol());
  return parts.join("\n\n");
}

export function cardFromSession(name: string, sessionId: string): SquadCardName | undefined {
  const n = name.trim().toLowerCase();
  if (isCard(n)) return n;
  const tail = sessionId.split("-").pop()?.toLowerCase();
  if (tail && isCard(tail)) return tail;
  return undefined;
}

export function isCard(value: string): value is SquadCardName {
  return (ALL_SQUAD_CARDS as readonly string[]).includes(value);
}

function readSquadFile(rel: string): string {
  const file = path.join(squadDir(), rel);
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`squad card missing: ${file}`);
  }
}
