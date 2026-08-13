import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { capture, parseArgs, resolveTarget } from "../../scripts/visual-shot.mjs";

const fixture = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../fixtures/sign.html");

describe("visual-shot", () => {
  it("parses --out and turns a file into a file URL", () => {
    expect(parseArgs(["page.html", "--out", "/tmp/x"])).toEqual({ target: "page.html", out: "/tmp/x" });
    expect(resolveTarget(fixture)).toMatch(/^file:\/\//);
    expect(() => resolveTarget("")).toThrow(/usage/);
  });

  it("writes desktop and mobile PNGs of a local HTML file", async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "talks-shot-"));
    let rows;
    try {
      rows = await capture(fixture, { out, cwd: process.cwd() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("no renderer")) {
        throw new Error(
          "visual-shot needs Playwright Chromium or Google Chrome. Run: npx playwright install chromium",
        );
      }
      throw err;
    }
    expect(rows.map((r) => r.name)).toEqual(["desktop", "mobile"]);
    for (const row of rows) {
      expect(fs.existsSync(row.file)).toBe(true);
      expect(fs.readFileSync(row.file).subarray(0, 8)).toEqual(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      );
      expect(row.bytes).toBeGreaterThan(500);
    }
  }, 60_000);
});
