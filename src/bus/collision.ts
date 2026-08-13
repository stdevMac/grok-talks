import { liveClaims } from "./claims.js";
import { hasDeny } from "./denies.js";
import { isMuted } from "./mutes.js";
import { isLive, listRoster } from "./roster.js";
import { hasTalked } from "./talked.js";
import type { BusDeps, ClaimPath, RosterEntry, SessionId } from "./types.js";

export interface CollisionHit {
  peer: RosterEntry;
  claim: ClaimPath;
}

export function findClaimer(
  deps: BusDeps,
  us: SessionId,
  project: string,
  absPath: string,
): CollisionHit | undefined {
  for (const peer of listRoster(deps)) {
    if (peer.session_id === us) continue;
    if (peer.project !== project) continue;
    if (!isLive(deps, peer)) continue;
    const claim = liveClaims(deps, peer.session_id).find((c) => c.path === absPath);
    if (claim) return { peer, claim };
  }
  return undefined;
}

export function shouldDeny(deps: BusDeps, us: SessionId, hit: CollisionHit): boolean {
  if (isMuted(deps, us, hit.peer.session_id)) return false;
  if (hit.peer.state !== "working") return false;
  if (hasTalked(deps, us, hit.peer.session_id)) return false;
  if (
    hasDeny(deps, us, {
      peer: hit.peer.session_id,
      path: hit.claim.path,
      claim_last_at: hit.claim.last_at,
    })
  ) {
    return false;
  }
  return true;
}
