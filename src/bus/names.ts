import path from "node:path";
import { readJson } from "./fs.js";
import type { SessionId } from "./types.js";

export function displayName(
  title: string | undefined,
  project: string,
  sessionId: SessionId,
): string {
  const trimmed = title?.trim();
  if (trimmed) return trimmed;
  const repo = path.basename(project) || "session";
  return `${repo}·${sessionId.slice(0, 8)}`;
}

export function readSessionTitle(
  grokHome: string,
  cwd: string,
  sessionId: SessionId,
): string | undefined {
  const encoded = encodeURIComponent(cwd);
  const file = path.join(grokHome, "sessions", encoded, sessionId, "summary.json");
  const summary = readJson<{ generated_title?: string; session_summary?: string; title?: string }>(
    file,
  );
  const title = summary?.generated_title ?? summary?.title;
  return title?.trim() || undefined;
}
