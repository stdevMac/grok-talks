import { systemClock, systemPid } from "./bus/clock.js";
import { defaultDataDir } from "./bus/paths.js";
import { TalksBus } from "./bus/talks.js";
import { handleHook, resolvePid } from "./hooks/handle.js";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main() {
  try {
    const raw = await readStdin();
    const ev = raw.trim() ? JSON.parse(raw) : {};
    const grokHome = process.env.GROK_HOME ?? `${process.env.HOME}/.grok`;
    const sessionId = ev.sessionId ?? process.env.GROK_SESSION_ID ?? "";
    const pid = resolvePid(sessionId, process.ppid, grokHome);
    const bus = new TalksBus({
      dataDir: defaultDataDir(),
      clock: systemClock,
      pid: systemPid,
      grokHome,
    });
    const out = handleHook(bus, ev, { pid, grokHome });
    if (out !== undefined) process.stdout.write(JSON.stringify(out));
  } catch {
    // fail open
  }
}

void main();
