import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { resolveSessionId } from "./bus/sessionBind.js";
import { TalksBus } from "./bus/talks.js";
import { callTalksTool } from "./mcp/tools.js";

const bus = new TalksBus({
  dataDir: defaultDataDir(),
  clock: systemClock,
  pid: systemPid,
  grokHome: process.env.GROK_HOME ?? `${process.env.HOME}/.grok`,
});

function sessionId(caller?: string): string {
  return resolveSessionId(bus.deps.dataDir, {
    explicit: caller,
    env: process.env,
    ppid: process.ppid,
  });
}

const caller = z.string().optional();

const server = new McpServer({ name: "grok-talks", version: "0.1.0" });

server.tool("talks_board", { scope: z.enum(["project", "all"]).optional(), caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_board", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool("talks_say", { to: z.string(), body: z.string(), caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_say", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool("talks_inbox", { mark_read: z.boolean().optional(), caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_inbox", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_mute",
  { peer: z.string().optional(), on: z.boolean().optional(), caller },
  async (args) => {
    const r = callTalksTool(bus, sessionId(args.caller), "talks_mute", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_status", { working_on: z.string(), caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_status", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_squad_start",
  {
    roles: z.union([z.string(), z.array(z.string())]).optional(),
    cwd: z.string().optional(),
    caller,
  },
  async (args) => {
    const r = callTalksTool(bus, sessionId(args.caller), "talks_squad_start", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_role", { caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_role", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_handoff",
  { to: z.string(), task: z.string(), body: z.string(), commit: z.string().optional(), caller },
  async (args) => {
    const r = callTalksTool(bus, sessionId(args.caller), "talks_handoff", args);
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
    caller,
  },
  async (args) => {
    const r = callTalksTool(bus, sessionId(args.caller), "talks_spawn", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

server.tool("talks_retire", { session_id: z.string(), caller }, async (args) => {
  const r = callTalksTool(bus, sessionId(args.caller), "talks_retire", args);
  return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
});

server.tool(
  "talks_request_approval",
  { task: z.string(), body: z.string().optional(), caller },
  async (args) => {
    const r = callTalksTool(bus, sessionId(args.caller), "talks_request_approval", args);
    return { content: [{ type: "text" as const, text: r.text }], isError: r.isError };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
