import { parseRoles, startSquad } from "../bus/squad.js";
import { TalksBus } from "../bus/talks.js";
import type { BoardScope } from "../bus/types.js";

export interface ToolResult {
  text: string;
  isError?: boolean;
}

export function callTalksTool(
  bus: TalksBus,
  sessionId: string,
  name: string,
  args: Record<string, unknown>,
): ToolResult {
  if (!sessionId) return { text: "GROK_SESSION_ID is required", isError: true };
  try {
    if (name === "talks_board") {
      const scope = (args.scope === "all" ? "all" : "project") as BoardScope;
      const rows = bus.board(sessionId, scope);
      const text = rows
        .map((r) => {
          const files = bus.claims(r.session_id).map((c) => c.path).join(", ");
          return `${r.name} ${r.session_id} ${r.state} ${r.project} ${r.working_on}${files ? " files:" + files : ""}`;
        })
        .join("\n");
      return { text: text || "(no live coworkers)" };
    }
    if (name === "talks_say") {
      const to = String(args.to ?? "");
      const body = String(args.body ?? "");
      const r = bus.say(sessionId, to, body);
      return r.ok ? { text: `sent ${r.mail.id}` } : { text: r.error, isError: true };
    }
    if (name === "talks_inbox") {
      const rows = bus.inbox(sessionId, { markRead: Boolean(args.mark_read) });
      return {
        text: rows.map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`).join("\n") || "(empty)",
      };
    }
    if (name === "talks_mute") {
      const peer = args.peer === undefined ? "all" : String(args.peer);
      if (args.on === false) bus.unmute(sessionId, peer);
      else bus.mute(sessionId, peer);
      return { text: "ok" };
    }
    if (name === "talks_status") {
      bus.setStatus(sessionId, String(args.working_on ?? ""));
      return { text: "ok" };
    }
    if (name === "talks_squad_start") {
      const cwd = String(args.cwd ?? process.cwd());
      const roles = parseRoles(
        Array.isArray(args.roles) ? (args.roles as string[]) : (args.roles as string | undefined),
      );
      const squad = startSquad(bus, { leadSessionId: sessionId, cwd, roles });
      return {
        text: squad.members
          .map((m) => `${m.role}\t${m.sessionId}\tgrok --agent grok-talks:${m.role}`)
          .join("\n"),
      };
    }
    if (name === "talks_role") {
      const r = bus.roleCard(sessionId);
      return r.ok ? { text: r.text } : { text: r.error, isError: true };
    }
    if (name === "talks_handoff") {
      const r = bus.handoff(
        sessionId,
        String(args.to ?? ""),
        String(args.task ?? ""),
        String(args.body ?? ""),
      );
      return r.ok ? { text: `handoff ${r.mail.id}` } : { text: r.error, isError: true };
    }
    return { text: `unknown tool ${name}`, isError: true };
  } catch (err) {
    return { text: err instanceof Error ? err.message : "error", isError: true };
  }
}
