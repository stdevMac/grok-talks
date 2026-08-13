import path from "node:path";
import { readJson, writeJsonAtomic } from "./fs.js";
import { CHAT_RATE, CHAT_WINDOW_MS, type BusDeps, type SessionId } from "./types.js";

type Stamps = Record<string, number[]>;

function key(from: SessionId, to: SessionId): string {
  return `${from}>${to}`;
}

export function allowChat(deps: BusDeps, from: SessionId, to: SessionId): boolean {
  const file = path.join(deps.dataDir, "rate-limit.json");
  const stamps = readJson<Stamps>(file) ?? {};
  const now = deps.clock.now().getTime();
  const k = key(from, to);
  const recent = (stamps[k] ?? []).filter((t) => now - t < CHAT_WINDOW_MS);
  if (recent.length >= CHAT_RATE) {
    stamps[k] = recent;
    writeJsonAtomic(file, stamps);
    return false;
  }
  recent.push(now);
  stamps[k] = recent;
  writeJsonAtomic(file, stamps);
  return true;
}
