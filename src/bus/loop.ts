import fs from "node:fs";
import { busPaths } from "./paths.js";
import { LOOP_NAG_MS, type BusDeps, type SessionCron, type SessionId } from "./types.js";

export const LOOP_PROMPT =
  "Check the grok-talks inbox with talks_inbox. If it is empty, do nothing else. If there is mail, reply with talks_say only when coordination is needed (a collision or a direct question). Do not send acknowledgements. Do not start extra loops. Do not spawn subagents.";

export function isTalksLoop(cron: SessionCron): boolean {
  return /talks_inbox|grok-talks inbox/i.test(cron.prompt ?? "");
}

export function shouldArmLoop(
  deps: BusDeps,
  sessionId: SessionId,
  hasProjectPeer: boolean,
  muteAll: boolean,
  crons: SessionCron[],
): { arm: boolean; prompt?: string } {
  if (!hasProjectPeer || muteAll) return { arm: false };
  if (crons.some(isTalksLoop)) return { arm: false };
  const marker = busPaths(deps.dataDir, sessionId).loopArmed;
  try {
    const stamped = Date.parse(fs.readFileSync(marker, "utf8").trim());
    if (Number.isFinite(stamped) && deps.clock.now().getTime() - stamped < LOOP_NAG_MS) {
      return { arm: false };
    }
  } catch {
    // no marker
  }
  fs.mkdirSync(busPaths(deps.dataDir).loopDir, { recursive: true });
  fs.writeFileSync(marker, deps.clock.now().toISOString());
  return { arm: true, prompt: LOOP_PROMPT };
}
