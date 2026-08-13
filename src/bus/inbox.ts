import { randomUUID } from "node:crypto";
import { toIso } from "./clock.js";
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "./fs.js";
import { busPaths } from "./paths.js";
import { DRAIN_CAP, type BusDeps, type Mail, type SessionId } from "./types.js";

export function appendMail(
  deps: BusDeps,
  to: SessionId,
  mail: Omit<Mail, "id" | "ts"> & Partial<Pick<Mail, "id" | "ts">>,
): Mail {
  const full: Mail = {
    id: mail.id ?? randomUUID(),
    ts: mail.ts ?? toIso(deps.clock.now()),
    from: mail.from,
    from_name: mail.from_name,
    kind: mail.kind,
    project: mail.project,
    body: mail.body,
    paths: mail.paths,
  };
  appendJsonl(busPaths(deps.dataDir, to).inbox, full);
  return full;
}

function readSet(deps: BusDeps, sessionId: SessionId): Set<string> {
  const arr = readJson<string[]>(busPaths(deps.dataDir, sessionId).read) ?? [];
  return new Set(Array.isArray(arr) ? arr : []);
}

function writeSet(deps: BusDeps, sessionId: SessionId, ids: Set<string>): void {
  writeJsonAtomic(busPaths(deps.dataDir, sessionId).read, [...ids]);
}

function collisionKey(m: Mail): string | undefined {
  if (m.kind !== "collision") return undefined;
  return `${m.from}\0${m.paths[0] ?? ""}`;
}

export function listUnread(
  deps: BusDeps,
  sessionId: SessionId,
  muted: Set<SessionId> = new Set(),
): Mail[] {
  const read = readSet(deps, sessionId);
  const rows = readJsonl<Mail>(busPaths(deps.dataDir, sessionId).inbox).filter(
    (m) => m?.id && m.from && !read.has(m.id) && !muted.has(m.from),
  );
  const latestCollision = new Map<string, string>();
  for (const m of rows) {
    const key = collisionKey(m);
    if (key) latestCollision.set(key, m.id);
  }
  return rows.filter((m) => {
    const key = collisionKey(m);
    if (!key) return true;
    return latestCollision.get(key) === m.id;
  });
}

export function drainInbox(
  deps: BusDeps,
  sessionId: SessionId,
  cap = DRAIN_CAP,
  muted: Set<SessionId> = new Set(),
): Mail[] {
  const unread = listUnread(deps, sessionId, muted).slice(0, cap);
  if (unread.length === 0) return [];
  const read = readSet(deps, sessionId);
  const all = readJsonl<Mail>(busPaths(deps.dataDir, sessionId).inbox);
  for (const m of unread) {
    read.add(m.id);
    const key = collisionKey(m);
    if (!key) continue;
    for (const other of all) {
      if (collisionKey(other) === key) read.add(other.id);
    }
  }
  writeSet(deps, sessionId, read);
  return unread;
}

export function markRead(deps: BusDeps, sessionId: SessionId, ids: string[]): void {
  const read = readSet(deps, sessionId);
  for (const id of ids) read.add(id);
  writeSet(deps, sessionId, read);
}
