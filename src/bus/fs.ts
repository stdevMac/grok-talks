import fs from "node:fs";
import path from "node:path";

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function writeJsonAtomic(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + "\n", "utf8");
  fs.renameSync(tmp, file);
}

export function readJson<T>(file: string): T | undefined {
  try {
    const raw = fs.readFileSync(file, "utf8");
    if (!raw.trim()) return undefined;
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

export function appendJsonl(file: string, value: unknown): void {
  ensureDir(path.dirname(file));
  fs.appendFileSync(file, JSON.stringify(value) + "\n", "utf8");
}

export function readJsonl<T>(file: string): T[] {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const out: T[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line) as T);
      } catch {
        // skip torn line
      }
    }
    return out;
  } catch {
    return [];
  }
}

export function removeFile(file: string): void {
  try {
    fs.unlinkSync(file);
  } catch {
    // missing is fine
  }
}
