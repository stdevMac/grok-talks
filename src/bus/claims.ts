import { toIso } from "./clock.js";
import { readJson, removeFile, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import {
  CLAIM_TTL_MS,
  type BusDeps,
  type ClaimPath,
  type ClaimsFile,
  type SessionId,
} from "./types.js";

export function readClaims(deps: BusDeps, sessionId: SessionId): ClaimsFile | undefined {
  return readJson<ClaimsFile>(busPaths(deps.dataDir, sessionId).claims);
}

export function touchClaim(
  deps: BusDeps,
  sessionId: SessionId,
  project: string,
  absPath: string,
): void {
  const now = toIso(deps.clock.now());
  const current = readClaims(deps, sessionId);
  const paths = current?.paths.filter((p) => p.path !== absPath) ?? [];
  paths.push({ path: absPath, last_at: now });
  const next: ClaimsFile = { session_id: sessionId, project, paths };
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).claims, next);
}

export function liveClaims(deps: BusDeps, sessionId: SessionId): ClaimPath[] {
  const file = readClaims(deps, sessionId);
  if (!file) return [];
  const now = deps.clock.now().getTime();
  return file.paths.filter((p) => {
    const t = Date.parse(p.last_at);
    return Number.isFinite(t) && now - t < CLAIM_TTL_MS;
  });
}

export function removeClaims(deps: BusDeps, sessionId: SessionId): void {
  removeFile(busPaths(deps.dataDir, sessionId).claims);
}
