import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";
import { callTalksTool } from "./mcp/tools.js";

const bus = new TalksBus({
  dataDir: defaultDataDir(),
  clock: systemClock,
  pid: systemPid,
  grokHome: process.env.GROK_HOME ?? `${process.env.HOME}/.grok`,
});

function sessionId(): string {
  return process.env.GROK_SESSION_ID ?? "";
}

const server = new McpServer({ name: "grok-talks", version: "0.1.0" });

server.tool("talks_board", { scope: z.enum(["project", "all"]).optional() }, async ({ scope }) => {
  const r = callTalksTool(bus, sessionId(), "talks_board", { scope });
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool("talks_say", { to: z.string(), body: z.string() }, async ({ to, body }) => {
  const r = callTalksTool(bus, sessionId(), "talks_say", { to, body });
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool("talks_inbox", { mark_read: z.boolean().optional() }, async ({ mark_read }) => {
  const r = callTalksTool(bus, sessionId(), "talks_inbox", { mark_read });
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_mute",
  { peer: z.string().optional(), on: z.boolean().optional() },
  async ({ peer, on }) => {
    const r = callTalksTool(bus, sessionId(), "talks_mute", { peer, on });
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_status", { working_on: z.string() }, async ({ working_on }) => {
  const r = callTalksTool(bus, sessionId(), "talks_status", { working_on });
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_squad_start",
  { roles: z.union([z.string(), z.array(z.string())]).optional(), cwd: z.string().optional() },
  async ({ roles, cwd }) => {
    const r = callTalksTool(bus, sessionId(), "talks_squad_start", { roles, cwd });
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_role", {}, async () => {
  const r = callTalksTool(bus, sessionId(), "talks_role", {});
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_handoff",
  { to: z.string(), task: z.string(), body: z.string(), commit: z.string().optional() },
  async ({ to, task, body, commit }) => {
    const r = callTalksTool(bus, sessionId(), "talks_handoff", { to, task, body, commit });
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool(
  "talks_spawn",
  {
    role: z.string(),
    task: z.string(),
    body: z.string().optional(),
    cwd: z.string().optional(),
  },
  async ({ role, task, body, cwd }) => {
    const r = callTalksTool(bus, sessionId(), "talks_spawn", { role, task, body, cwd });
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_retire", { session_id: z.string() }, async ({ session_id }) => {
  const r = callTalksTool(bus, sessionId(), "talks_retire", { session_id });
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_request_approval",
  { task: z.string(), body: z.string().optional() },
  async ({ task, body }) => {
    const r = callTalksTool(bus, sessionId(), "talks_request_approval", { task, body });
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
