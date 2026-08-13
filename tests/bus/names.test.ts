import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { displayName, readSessionTitle } from "../../src/bus/names.js";
import { tempDir } from "../helpers.js";

describe("displayName", () => {
  it("uses title when present", () => {
    expect(displayName("auth-fix", "/Users/maceo/payverge", "abcdef12zzzz")).toBe("auth-fix");
  });

  it("falls back to repo·short-id", () => {
    expect(displayName(undefined, "/Users/maceo/payverge", "abcdef12zzzz")).toBe("payverge·abcdef12");
  });
});

describe("readSessionTitle", () => {
  it("reads generated_title from summary.json when present", () => {
    const home = tempDir();
    const cwd = "/Users/maceo/payverge";
    const id = "sess-1";
    const dir = path.join(home, "sessions", encodeURIComponent(cwd), id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "summary.json"), JSON.stringify({ generated_title: "Fix login" }));
    expect(readSessionTitle(home, cwd, id)).toBe("Fix login");
  });

  it("returns undefined when summary is missing", () => {
    expect(readSessionTitle(tempDir(), "/x", "nope")).toBeUndefined();
  });
});
