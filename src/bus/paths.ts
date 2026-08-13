import path from "node:path";
import type { SessionId } from "./types.js";

export function busPaths(dataDir: string, sessionId?: SessionId) {
  return {
    dataDir,
    rosterDir: path.join(dataDir, "roster"),
    claimsDir: path.join(dataDir, "claims"),
    inboxDir: path.join(dataDir, "inbox"),
    mutesDir: path.join(dataDir, "mutes"),
    deniesDir: path.join(dataDir, "denies"),
    talkedDir: path.join(dataDir, "talked"),
    loopDir: path.join(dataDir, "loop-armed"),
    roster: sessionId ? path.join(dataDir, "roster", `${sessionId}.json`) : "",
    claims: sessionId ? path.join(dataDir, "claims", `${sessionId}.json`) : "",
    inbox: sessionId ? path.join(dataDir, "inbox", `${sessionId}.jsonl`) : "",
    read: sessionId ? path.join(dataDir, "inbox", `${sessionId}.read`) : "",
    mutes: sessionId ? path.join(dataDir, "mutes", `${sessionId}.json`) : "",
    denies: sessionId ? path.join(dataDir, "denies", `${sessionId}.json`) : "",
    talked: sessionId ? path.join(dataDir, "talked", `${sessionId}.json`) : "",
    loopArmed: sessionId ? path.join(dataDir, "loop-armed", sessionId) : "",
  };
}

export function defaultDataDir(env = process.env): string {
  return (
    env.GROK_PLUGIN_DATA ??
    path.join(env.GROK_HOME ?? path.join(env.HOME ?? ".", ".grok"), "plugin-data", "grok-talks")
  );
}
