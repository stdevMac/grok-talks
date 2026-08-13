import type { Clock, PidCheck } from "./types.js";

export const systemClock: Clock = {
  now: () => new Date(),
};

export const systemPid: PidCheck = {
  isAlive(pid: number): boolean {
    if (!Number.isFinite(pid) || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  },
};

export function toIso(d: Date): string {
  return d.toISOString();
}
