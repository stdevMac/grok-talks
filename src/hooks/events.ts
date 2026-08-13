import type { SessionCron } from "../bus/types.js";

export interface HookEvent {
  hookEventName?: string;
  sessionId?: string;
  cwd?: string;
  workspaceRoot?: string;
  timestamp?: string;
  permissionMode?: string;
  toolName?: string;
  toolInput?: Record<string, unknown>;
  prompt?: string;
  reason?: string;
  sessionCrons?: SessionCron[];
  stopHookActive?: boolean;
}

const WRITE_TOOLS = new Set(["search_replace", "write", "Write", "Edit", "MultiEdit"]);

export function isWriteTool(name: string | undefined): boolean {
  if (!name) return false;
  return WRITE_TOOLS.has(name);
}

export function writePath(input: Record<string, unknown> | undefined): string | undefined {
  if (!input) return undefined;
  for (const key of ["file_path", "path", "target_file"]) {
    const v = input[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return undefined;
}

export function eventName(ev: HookEvent): string {
  return (ev.hookEventName ?? "").toLowerCase().replace(/-/g, "_");
}
