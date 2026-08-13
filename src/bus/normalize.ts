import fs from "node:fs";
import path from "node:path";

export function normalizePath(input: string, cwd: string): string {
  try {
    const resolved = path.resolve(cwd, input);
    try {
      return fs.realpathSync.native(resolved);
    } catch {
      return resolved;
    }
  } catch {
    return path.resolve(cwd, input);
  }
}

export function projectRoot(cwd: string): string {
  let dir = path.resolve(cwd);
  while (true) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(cwd);
    dir = parent;
  }
}
