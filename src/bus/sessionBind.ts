import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { readJson, removeFile, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import type { SessionId } from "./types.js";

export interface SessionBind {
  session_id: SessionId;
}

function bindPath(dataDir: string, pid: number): string {
  return path.join(busPaths(dataDir).dataDir, "binds", `${pid}.json`);
}

export function bindSession(dataDir: string, pid: number, sessionId: SessionId): void {
  if (!Number.isFinite(pid) || pid <= 1 || !sessionId) return;
  writeJsonAtomic(bindPath(dataDir, pid), { session_id: sessionId } satisfies SessionBind);
}

export function unbindSession(dataDir: string, sessionId: SessionId): void {
  const dir = path.join(busPaths(dataDir).dataDir, "binds");
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    const row = readJson<SessionBind>(path.join(dir, name));
    if (row?.session_id === sessionId) removeFile(path.join(dir, name));
  }
}

export function readBind(dataDir: string, pid: number): SessionId | undefined {
  if (!Number.isFinite(pid) || pid <= 1) return undefined;
  return readJson<SessionBind>(bindPath(dataDir, pid))?.session_id;
}

export function parentPid(pid: number): number | undefined {
  if (!Number.isFinite(pid) || pid <= 1) return undefined;
  const r = spawnSync("ps", ["-o", "ppid=", "-p", String(pid)], { encoding: "utf8" });
  const n = Number((r.stdout || "").trim());
  return Number.isFinite(n) && n > 1 ? n : undefined;
}

export function resolveSessionId(
  dataDir: string,
  input: { explicit?: string; env?: NodeJS.ProcessEnv; ppid?: number },
): SessionId {
  const explicit = input.explicit?.trim();
  if (explicit) return explicit;
  const fromEnv = (input.env ?? process.env).GROK_SESSION_ID?.trim();
  if (fromEnv) return fromEnv;
  let pid = input.ppid ?? process.ppid;
  for (let i = 0; i < 6 && pid && pid > 1; i++) {
    const hit = readBind(dataDir, pid);
    if (hit) return hit;
    pid = parentPid(pid) ?? 0;
  }
  return "";
}
