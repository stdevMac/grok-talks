import fs from "node:fs";
import path from "node:path";
import { readJson, removeFile, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import { HEARTBEAT_MS, type BusDeps, type RosterEntry, type SessionId } from "./types.js";

export function writeRoster(deps: BusDeps, entry: RosterEntry): void {
  writeJsonAtomic(busPaths(deps.dataDir, entry.session_id).roster, entry);
}

export function readRoster(deps: BusDeps, sessionId: SessionId): RosterEntry | undefined {
  return readJson<RosterEntry>(busPaths(deps.dataDir, sessionId).roster);
}

export function removeRoster(deps: BusDeps, sessionId: SessionId): void {
  removeFile(busPaths(deps.dataDir, sessionId).roster);
}

export function isLive(deps: BusDeps, entry: RosterEntry): boolean {
  if (!Number.isFinite(entry.pid) || !deps.pid.isAlive(entry.pid)) return false;
  const hb = Date.parse(entry.heartbeat_at);
  if (!Number.isFinite(hb)) return false;
  return deps.clock.now().getTime() - hb < HEARTBEAT_MS;
}

export function listRoster(deps: BusDeps): RosterEntry[] {
  const dir = busPaths(deps.dataDir).rosterDir;
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RosterEntry[] = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const entry = readJson<RosterEntry>(path.join(dir, name));
    if (entry && isLive(deps, entry)) out.push(entry);
  }
  return out;
}
