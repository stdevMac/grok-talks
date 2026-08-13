import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, DenyKey, SessionId } from "./types.js";

export function listDenies(deps: BusDeps, sessionId: SessionId): DenyKey[] {
  const rows = readJson<DenyKey[]>(busPaths(deps.dataDir, sessionId).denies);
  return Array.isArray(rows) ? rows : [];
}

export function addDeny(deps: BusDeps, sessionId: SessionId, key: DenyKey): void {
  const rows = listDenies(deps, sessionId);
  if (!hasDeny(deps, sessionId, key)) rows.push(key);
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).denies, rows);
}

export function hasDeny(deps: BusDeps, sessionId: SessionId, key: DenyKey): boolean {
  return listDenies(deps, sessionId).some(
    (k) => k.peer === key.peer && k.path === key.path && k.claim_last_at === key.claim_last_at,
  );
}
