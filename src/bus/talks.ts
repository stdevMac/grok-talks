import path from "node:path";
import { dropClaim, liveClaims, removeClaims, touchClaim } from "./claims.js";
import { toIso } from "./clock.js";
import { findClaimer, shouldDeny } from "./collision.js";
import { addDeny } from "./denies.js";
import { appendMail, drainInbox, listUnread, markRead } from "./inbox.js";
import { shouldArmLoop as armLoop } from "./loop.js";
import { isMuted, readMutes, setMute } from "./mutes.js";
import { displayName } from "./names.js";
import { normalizePath, projectRoot } from "./normalize.js";
import { allowChat } from "./rateLimit.js";
import { handoffDenied } from "./contracts.js";
import { isKnownLead, markHandoffSent, retireIfWorkerToLead, spawningRoster } from "./squad.js";
import { cardFromSession, formatRoleBriefing } from "./roleCards.js";
import { listRoster, readRoster, removeRoster, writeRoster } from "./roster.js";
import { markTalked } from "./talked.js";
import {
  PLUGIN_VERSION,
  STATUS_MAX,
  type BoardScope,
  type BusDeps,
  type Mail,
  type RosterEntry,
  type SessionCron,
  type SessionId,
  type SessionState,
} from "./types.js";

export class TalksBus {
  constructor(readonly deps: BusDeps) {}

  sessionStart(input: {
    sessionId: SessionId;
    cwd: string;
    pid: number;
    title?: string;
  }): RosterEntry {
    const prev = readRoster(this.deps, input.sessionId);
    const project = projectRoot(input.cwd);
    const entry: RosterEntry = {
      session_id: input.sessionId,
      name: displayName(input.title ?? prev?.name, project, input.sessionId),
      cwd: path.resolve(input.cwd),
      project,
      pid: input.pid,
      working_on: prev?.working_on ?? "",
      state: prev?.state ?? "idle",
      heartbeat_at: toIso(this.deps.clock.now()),
      plugin_version: PLUGIN_VERSION,
    };
    writeRoster(this.deps, entry);
    return entry;
  }

  sessionEnd(sessionId: SessionId): void {
    removeRoster(this.deps, sessionId);
    removeClaims(this.deps, sessionId);
  }

  heartbeat(sessionId: SessionId, state?: SessionState): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    writeRoster(this.deps, {
      ...cur,
      state: state ?? cur.state,
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  promptSubmit(sessionId: SessionId, prompt: string): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    const trimmed = prompt.trim();
    writeRoster(this.deps, {
      ...cur,
      state: "working",
      working_on: trimmed ? trimmed.slice(0, STATUS_MAX) : cur.working_on,
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  setStatus(sessionId: SessionId, workingOn: string): void {
    const cur = readRoster(this.deps, sessionId);
    if (!cur) return;
    writeRoster(this.deps, {
      ...cur,
      working_on: workingOn.trim().slice(0, STATUS_MAX),
      heartbeat_at: toIso(this.deps.clock.now()),
    });
  }

  touchWrite(sessionId: SessionId, absOrRel: string, cwd?: string): string {
    const cur = readRoster(this.deps, sessionId);
    const base = cwd ?? cur?.cwd ?? process.cwd();
    const project = cur?.project ?? projectRoot(base);
    const abs = normalizePath(absOrRel, base);
    touchClaim(this.deps, sessionId, project, abs);
    this.heartbeat(sessionId);
    return abs;
  }

  decideWrite(input: { sessionId: SessionId; relPath: string; cwd: string }): {
    decision: "allow" | "deny";
    reason?: string;
  } {
    const us = readRoster(this.deps, input.sessionId);
    const project = us?.project ?? projectRoot(input.cwd);
    const abs = normalizePath(input.relPath, input.cwd);
    this.touchWrite(input.sessionId, abs, input.cwd);
    const hit = findClaimer(this.deps, input.sessionId, project, abs);
    if (!hit) return { decision: "allow" };
    if (shouldDeny(this.deps, input.sessionId, hit)) {
      addDeny(this.deps, input.sessionId, {
        peer: hit.peer.session_id,
        path: hit.claim.path,
        claim_last_at: hit.claim.last_at,
      });
      const body = `Collision: ${hit.peer.name} (${hit.peer.session_id}) is also editing ${abs}. Talk with talks_say before overwriting.`;
      appendMail(this.deps, input.sessionId, {
        from: hit.peer.session_id,
        from_name: hit.peer.name,
        kind: "collision",
        project,
        body,
        paths: [abs],
      });
      appendMail(this.deps, hit.peer.session_id, {
        from: input.sessionId,
        from_name: us?.name ?? input.sessionId,
        kind: "collision",
        project,
        body,
        paths: [abs],
      });
      dropClaim(this.deps, input.sessionId, abs);
      return { decision: "deny", reason: body };
    }
    if (hit.peer.state === "idle") {
      appendMail(this.deps, hit.peer.session_id, {
        from: input.sessionId,
        from_name: us?.name ?? input.sessionId,
        kind: "collision",
        project,
        body: `${us?.name ?? input.sessionId} is editing ${abs} (you claimed it earlier).`,
        paths: [abs],
      });
    }
    return { decision: "allow" };
  }

  resolvePeer(
    from: SessionId,
    target: string,
  ): { ok: true; peer: RosterEntry } | { ok: false; error: string } {
    if (target === "*") return { ok: false, error: "broadcast is not supported" };
    const byId = readRoster(this.deps, target);
    if (byId) return { ok: true, peer: byId };
    const peers = listRoster(this.deps);
    const byName = peers.filter((p) => p.name === target || p.name.endsWith("·" + target));
    if (byName.length === 1) return { ok: true, peer: byName[0] };
    if (byName.length > 1) {
      return {
        ok: false,
        error: `ambiguous name; matches ${byName.map((p) => p.session_id).join(", ")}`,
      };
    }
    const self = readRoster(this.deps, from);
    if (self && (self.session_id === target || self.name === target)) return { ok: true, peer: self };
    return { ok: false, error: `unknown session ${target}` };
  }

  say(
    from: SessionId,
    to: string,
    body: string,
  ): { ok: true; mail: Mail } | { ok: false; error: string } {
    const trimmed = body.trim();
    if (!trimmed) return { ok: false, error: "empty body" };
    const resolved = this.resolvePeer(from, to);
    if (!resolved.ok) return resolved;
    if (!allowChat(this.deps, from, resolved.peer.session_id)) {
      return { ok: false, error: "rate limited (10 chats per minute)" };
    }
    const us = readRoster(this.deps, from);
    const mail = appendMail(this.deps, resolved.peer.session_id, {
      from,
      from_name: us?.name ?? from,
      kind: "chat",
      project: us?.project ?? "",
      body: trimmed,
      paths: [],
    });
    markTalked(this.deps, from, resolved.peer.session_id);
    return { ok: true, mail };
  }

  handoff(
    from: SessionId,
    to: string,
    task: string,
    body: string,
    commit?: string,
  ): { ok: true; mail: Mail } | { ok: false; error: string } {
    const taskName = task.trim();
    const trimmed = body.trim();
    if (!taskName) return { ok: false, error: "empty task" };
    if (!trimmed) return { ok: false, error: "empty body" };
    const sha = commit?.trim();
    if (sha && !/^[0-9a-f]{7,40}$/i.test(sha)) {
      return { ok: false, error: "commit must be a 7-40 char hex sha" };
    }
    const resolved = this.resolvePeer(from, to);
    if (!resolved.ok) return resolved;
    const us = readRoster(this.deps, from);
    const denied = handoffDenied(us, resolved.peer, {
      toIsLead: isKnownLead(this.deps.dataDir, resolved.peer.session_id),
    });
    if (denied) return { ok: false, error: denied };
    const mail = appendMail(this.deps, resolved.peer.session_id, {
      from,
      from_name: us?.name ?? from,
      kind: "handoff",
      project: us?.project ?? "",
      body: sha ? `TASK ${taskName}\nCOMMIT ${sha}\n${trimmed}` : `TASK ${taskName}\n${trimmed}`,
      paths: [],
      commit: sha,
    });
    markTalked(this.deps, from, resolved.peer.session_id);
    markHandoffSent(this.deps.dataDir, from);
    retireIfWorkerToLead(this, from, resolved.peer);
    return { ok: true, mail };
  }

  roleCard(sessionId: SessionId): { ok: true; role: string; text: string } | { ok: false; error: string } {
    const us = readRoster(this.deps, sessionId);
    const role = cardFromSession(us?.name ?? "", sessionId) ?? (isKnownLead(this.deps.dataDir, sessionId) ? "lead" : undefined);
    if (!role) return { ok: false, error: "no squad role on this session" };
    try {
      return { ok: true, role, text: formatRoleBriefing(role) };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "role card missing" };
    }
  }

  inbox(sessionId: SessionId, opts?: { markRead?: boolean }): Mail[] {
    const muted = this.mutedSet(sessionId);
    const rows = listUnread(this.deps, sessionId, muted);
    if (opts?.markRead) markRead(this.deps, sessionId, rows.map((m) => m.id));
    return rows;
  }

  drain(sessionId: SessionId, cap?: number): Mail[] {
    return drainInbox(this.deps, sessionId, cap, this.mutedSet(sessionId));
  }

  board(sessionId: SessionId, scope: BoardScope = "project"): RosterEntry[] {
    const us = readRoster(this.deps, sessionId);
    const seen = new Set<string>();
    const all: RosterEntry[] = [];
    for (const row of [...listRoster(this.deps), ...spawningRoster(this)]) {
      if (seen.has(row.session_id)) continue;
      seen.add(row.session_id);
      all.push(row);
    }
    if (scope === "all" || !us) return all;
    return all.filter((p) => p.project === us.project);
  }

  mute(sessionId: SessionId, peer?: SessionId | "all"): void {
    const cur = readMutes(this.deps, sessionId);
    if (!peer || peer === "all") {
      setMute(this.deps, sessionId, { all: true, peers: cur.peers });
      return;
    }
    setMute(this.deps, sessionId, { all: false, peers: [...new Set([...cur.peers, peer])] });
  }

  unmute(sessionId: SessionId, peer?: SessionId | "all"): void {
    if (!peer || peer === "all") {
      setMute(this.deps, sessionId, { all: false, peers: [] });
      return;
    }
    const cur = readMutes(this.deps, sessionId);
    setMute(this.deps, sessionId, { all: false, peers: cur.peers.filter((p) => p !== peer) });
  }

  shouldArmLoop(sessionId: SessionId, crons: SessionCron[]): { arm: boolean; prompt?: string } {
    const peers = this.board(sessionId, "project").filter((p) => p.session_id !== sessionId);
    return armLoop(
      this.deps,
      sessionId,
      peers.length > 0,
      readMutes(this.deps, sessionId).all,
      crons,
    );
  }

  claims(sessionId: SessionId) {
    return liveClaims(this.deps, sessionId);
  }

  private mutedSet(sessionId: SessionId): Set<SessionId> {
    const m = readMutes(this.deps, sessionId);
    if (m.all) {
      return new Set(
        listRoster(this.deps)
          .map((p) => p.session_id)
          .filter((id) => id !== sessionId),
      );
    }
    return new Set(m.peers);
  }
}

export { isMuted };
