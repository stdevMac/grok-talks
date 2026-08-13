import { readJson, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { BusDeps, MuteFile, SessionId } from "./types.js";

export function readMutes(deps: BusDeps, sessionId: SessionId): MuteFile {
  const file = readJson<MuteFile>(busPaths(deps.dataDir, sessionId).mutes);
  if (!file || typeof file.all !== "boolean" || !Array.isArray(file.peers)) {
    return { all: false, peers: [] };
  }
  return file;
}

export function setMute(deps: BusDeps, sessionId: SessionId, mute: MuteFile): void {
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).mutes, mute);
}

export function isMuted(deps: BusDeps, listener: SessionId, sender: SessionId): boolean {
  const m = readMutes(deps, listener);
  return m.all || m.peers.includes(sender);
}

export function mutedSenders(deps: BusDeps, listener: SessionId): Set<SessionId> {
  const m = readMutes(deps, listener);
  if (m.all) return new Set(["*"]);
  return new Set(m.peers);
}
