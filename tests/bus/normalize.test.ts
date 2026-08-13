import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { normalizePath, projectRoot } from "../../src/bus/normalize.js";

describe("normalizePath", () => {
  it("resolves relative segments against cwd", () => {
    expect(normalizePath("src/../src/auth.ts", "/repo")).toBe(path.resolve("/repo", "src/auth.ts"));
  });

  it("collapses duplicate slashes and dots", () => {
    expect(normalizePath("/repo//src/./auth.ts", "/repo")).toBe(path.resolve("/repo/src/auth.ts"));
  });

  it("returns lexical resolve when given an absolute path", () => {
    expect(normalizePath("/abs/foo.ts", "/repo")).toBe(path.resolve("/abs/foo.ts"));
  });
});

describe("projectRoot", () => {
  it("returns cwd when no git root exists above it", () => {
    const isolated = path.join(os.tmpdir(), "talks-no-git-" + process.pid);
    expect(projectRoot(isolated)).toBe(path.resolve(isolated));
  });
});
