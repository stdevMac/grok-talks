import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { BusDeps, Clock, PidCheck } from "../src/bus/types.js";

export function iso(d: Date): string {
  return d.toISOString();
}

export function tempDir(prefix = "talks-"): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

export function fakeClock(start = new Date("2026-08-13T12:00:00.000Z")): Clock & {
  time: Date;
  advance: (ms: number) => void;
} {
  const clock = {
    time: start,
    now: () => clock.time,
    advance: (ms: number) => {
      clock.time = new Date(clock.time.getTime() + ms);
    },
  };
  return clock;
}

export function fakePid(alive: Iterable<number> = [100, 200, 300]): PidCheck & {
  alive: Set<number>;
} {
  const set = new Set(alive);
  return {
    alive: set,
    isAlive: (pid: number) => set.has(pid),
  };
}

export function deps(overrides: Partial<BusDeps> = {}): BusDeps & {
  clock: ReturnType<typeof fakeClock>;
  pid: ReturnType<typeof fakePid>;
} {
  const clock = (overrides.clock as ReturnType<typeof fakeClock>) ?? fakeClock();
  const pid = (overrides.pid as ReturnType<typeof fakePid>) ?? fakePid();
  return {
    dataDir: overrides.dataDir ?? tempDir(),
    clock,
    pid,
    grokHome: overrides.grokHome,
  };
}
