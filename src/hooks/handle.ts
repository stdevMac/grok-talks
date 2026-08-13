import fs from "node:fs";
import path from "node:path";
import { displayName, readSessionTitle } from "../bus/names.js";
import { readRoster, writeRoster } from "../bus/roster.js";
import { approveTask, findWorker, gcDeadWorkers, pendingApprovals, parseHumanApprove } from "../bus/squad.js";
import { TalksBus } from "../bus/talks.js";
import { eventName, isWriteTool, writePath, type HookEvent } from "./events.js";

export function handleHook(
  bus: TalksBus,
  ev: HookEvent,
  extra: { pid: number; grokHome?: string },
): unknown {
  try {
    return handleHookInner(bus, ev, extra);
  } catch {
    return undefined;
  }
}

function handleHookInner(
  bus: TalksBus,
  ev: HookEvent,
  extra: { pid: number; grokHome?: string },
): unknown {
  const name = eventName(ev);
  const sessionId = ev.sessionId;
  const cwd = ev.workspaceRoot || ev.cwd || process.cwd();
  if (!sessionId) return undefined;

  if (name === "session_start") {
    const grokTitle = extra.grokHome ? readSessionTitle(extra.grokHome, cwd, sessionId) : undefined;
    const existing = readRoster(bus.deps, sessionId);
    const worker = findWorker(bus.deps.dataDir, sessionId);
    const title = worker?.role || grokTitle || existing?.name;
    const entry = bus.sessionStart({ sessionId, cwd, pid: extra.pid, title });
    writeRoster(bus.deps, {
      ...entry,
      name: displayName(title, entry.project, sessionId),
      working_on: existing?.working_on || entry.working_on,
    });
    return undefined;
  }
  if (name === "session_end") {
    bus.sessionEnd(sessionId);
    return undefined;
  }
  if (name === "user_prompt_submit") {
    const prompt = typeof ev.prompt === "string" ? ev.prompt : "";
    const task = parseHumanApprove(prompt);
    if (task) {
      approveTask(bus.deps.dataDir, sessionId, task);
      bus.heartbeat(sessionId);
      return undefined;
    }
    bus.promptSubmit(sessionId, prompt);
    return undefined;
  }
  if (name === "post_tool_use" && isWriteTool(ev.toolName)) {
    const p = writePath(ev.toolInput);
    if (p) bus.touchWrite(sessionId, p, cwd);
    return undefined;
  }
  if (name === "pre_tool_use") {
    if (!isWriteTool(ev.toolName)) return undefined;
    const p = writePath(ev.toolInput);
    if (!p) return undefined;
    const result = bus.decideWrite({ sessionId, relPath: p, cwd });
    if (result.decision === "deny") return { decision: "deny", reason: result.reason };
    return undefined;
  }
  if (name === "stop") {
    if (ev.reason !== "end_turn") return undefined;
    const mail = bus.drain(sessionId);
    if (mail.length > 0) {
      bus.heartbeat(sessionId, "working");
      const text = mail.map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`).join("\n");
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: text,
        },
      };
    }
    bus.heartbeat(sessionId, "idle");
    gcDeadWorkers(bus, sessionId);
    const pending = pendingApprovals(bus.deps.dataDir, sessionId);
    if (pending.length > 0) {
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: `Pending human approvals: ${pending.join(", ")}. Type /approve <task> — the model cannot approve.`,
        },
      };
    }
    if (ev.stopHookActive) return undefined;
    const arm = bus.shouldArmLoop(sessionId, ev.sessionCrons ?? []);
    if (arm.arm && arm.prompt) {
      return {
        hookSpecificOutput: {
          hookEventName: "Stop",
          additionalContext: `Start /loop 60s with this prompt and no extras:\n${arm.prompt}`,
        },
      };
    }
    return undefined;
  }
  return undefined;
}

export function resolvePid(sessionId: string, fallback: number, grokHome?: string): number {
  if (!grokHome) return fallback;
  try {
    const rows = JSON.parse(
      fs.readFileSync(path.join(grokHome, "active_sessions.json"), "utf8"),
    ) as Array<{ session_id: string; pid: number }>;
    const hit = rows.find((r) => r.session_id === sessionId);
    if (hit && Number.isFinite(hit.pid)) return hit.pid;
  } catch {
    // fall through
  }
  return fallback;
}
