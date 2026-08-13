import { toIso } from "./clock.js";
import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, SessionId, TalkedFile } from "./types.js";

export function readTalked(deps: BusDeps, sessionId: SessionId): TalkedFile {
  return readJson<TalkedFile>(busPaths(deps.dataDir, sessionId).talked) ?? {};
}

export function markTalked(deps: BusDeps, sessionId: SessionId, peer: SessionId): void {
  const file = readTalked(deps, sessionId);
  file[peer] = toIso(deps.clock.now());
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).talked, file);
}

export function hasTalked(deps: BusDeps, sessionId: SessionId, peer: SessionId): boolean {
  return Boolean(readTalked(deps, sessionId)[peer]);
}
