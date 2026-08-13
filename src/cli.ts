#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import {
  approveTask,
  findWorker,
  isSquadRole,
  parseRoles,
  requestApproval,
  retireWorker,
  spawnWorker,
  startSquad,
} from "./bus/squad.js";
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
      text:
        rows
          .map((r) => {
            const w = findWorker(bus.deps.dataDir, r.session_id);
            const extra = w ? `\t${w.state}\t${w.task}` : "";
            return `${r.name}\t${r.state}\t${r.project}\t${r.working_on}${extra}`;
          })
          .join("\n") + "\n",
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
  if (cmd === "squad") {
    try {
      const roles = parseRoles(rest[0]);
      const cwd = rest[1] || process.cwd();
      const squad = startSquad(bus, { leadSessionId: sessionId, cwd, roles });
      return {
        status: 0,
        text:
          squad.members.map((m) => `${m.role}\t${m.sessionId}\t${m.launch}`).join("\n") + "\n",
      };
    } catch (err) {
      return { status: 1, text: (err instanceof Error ? err.message : "squad failed") + "\n" };
    }
  }
  if (cmd === "role") {
    const r = bus.roleCard(sessionId);
    return r.ok ? { status: 0, text: r.text + "\n" } : { status: 1, text: r.error + "\n" };
  }
  if (cmd === "handoff") {
    const copy = [...rest];
    const flag = copy.indexOf("--commit");
    let commit: string | undefined;
    if (flag >= 0) {
      commit = copy[flag + 1];
      copy.splice(flag, 2);
    }
    const [to, task, ...body] = copy;
    const r = bus.handoff(sessionId, to ?? "", task ?? "", body.join(" "), commit);
    return r.ok ? { status: 0, text: `handoff ${r.mail.id}\n` } : { status: 1, text: r.error + "\n" };
  }
  if (cmd === "spawn") {
    const copy = [...rest];
    let cwd = process.cwd();
    const flag = copy.indexOf("--cwd");
    if (flag >= 0) {
      cwd = copy[flag + 1] || cwd;
      copy.splice(flag, 2);
    }
    const role = copy[0] ?? "";
    if (!isSquadRole(role)) return { status: 1, text: `unknown role ${role}\n` };
    const r = spawnWorker(bus, {
      leadSessionId: sessionId,
      cwd,
      role,
      task: copy[1] ?? role,
      body: copy.slice(2).join(" "),
    });
    if (!r.ok) return { status: 1, text: r.error + "\n" };
    return {
      status: 0,
      text: `${r.member.role}\t${r.member.sessionId}\t${r.member.launch}\n`,
    };
  }
  if (cmd === "retire") {
    const r = retireWorker(bus, sessionId, rest[0] ?? "");
    return r.ok ? { status: 0, text: "retired\n" } : { status: 1, text: r.error + "\n" };
  }
  if (cmd === "request-approval") {
    const task = (rest[0] ?? "").trim();
    if (!task) return { status: 1, text: "empty task\n" };
    requestApproval(bus.deps.dataDir, sessionId, task, rest.slice(1).join(" "));
    return { status: 0, text: "requested\n" };
  }
  if (cmd === "approve") {
    const task = (rest[0] ?? "").trim();
    if (!task) return { status: 1, text: "empty task\n" };
    approveTask(bus.deps.dataDir, sessionId, task);
    return { status: 0, text: "approved\n" };
  }
  if (cmd === "shot") {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const script = path.resolve(here, "..", "scripts", "visual-shot.mjs");
    const r = spawnSync(process.execPath, [script, ...rest], { encoding: "utf8" });
    return { status: r.status ?? 1, text: (r.stdout || "") + (r.stderr || "") };
  }
  return {
    status: 1,
    text: "usage: talks board|send|inbox|mute|unmute|start|squad|role|handoff|spawn|retire|request-approval|approve|shot\n",
  };
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
