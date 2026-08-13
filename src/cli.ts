import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";

export function runCli(
  bus: TalksBus,
  sessionId: string,
  argv: string[],
): { status: number; text: string } {
  const [cmd, ...rest] = argv;
  if (!sessionId) return { status: 1, text: "GROK_SESSION_ID is required\n" };
  if (cmd === "board") {
    const scope = rest[0] === "--all" ? "all" : "project";
    const rows = bus.board(sessionId, scope);
    return {
      status: 0,
      text: rows.map((r) => `${r.name}\t${r.state}\t${r.project}\t${r.working_on}`).join("\n") + "\n",
    };
  }
  if (cmd === "send") {
    const [to, ...body] = rest;
    const r = bus.say(sessionId, to ?? "", body.join(" "));
    return r.ok ? { status: 0, text: `sent ${r.mail.id}\n` } : { status: 1, text: r.error + "\n" };
  }
  if (cmd === "inbox") {
    const drain = rest.includes("--drain");
    const rows = drain ? bus.drain(sessionId) : bus.inbox(sessionId);
    return {
      status: 0,
      text:
        rows.map((m) => `[${m.kind}] ${m.from_name}: ${m.body}`).join("\n") + (rows.length ? "\n" : ""),
    };
  }
  if (cmd === "mute") {
    bus.mute(sessionId, rest[0] === "--all" || !rest[0] ? "all" : rest[0]);
    return { status: 0, text: "muted\n" };
  }
  if (cmd === "unmute") {
    bus.unmute(sessionId, rest[0] === "--all" || !rest[0] ? "all" : rest[0]);
    return { status: 0, text: "unmuted\n" };
  }
  if (cmd === "start") {
    const cwd = rest[0] || process.cwd();
    const title = rest[1];
    const pid = Number(process.env.GROK_TALKS_PID ?? process.pid);
    bus.sessionStart({ sessionId, cwd, pid, title });
    return { status: 0, text: `started ${sessionId}\n` };
  }
  return { status: 1, text: "usage: talks board|send|inbox|mute|unmute|start\n" };
}

const isMain = process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js");
if (isMain) {
  const assumeAlive = process.env.GROK_TALKS_ASSUME_ALIVE === "1";
  const bus = new TalksBus({
    dataDir: defaultDataDir(),
    clock: systemClock,
    pid: assumeAlive ? { isAlive: () => true } : systemPid,
    grokHome: process.env.GROK_HOME ?? `${process.env.HOME}/.grok`,
  });
  const result = runCli(bus, process.env.GROK_SESSION_ID ?? "", process.argv.slice(2));
  process.stdout.write(result.text);
  process.exit(result.status);
}
