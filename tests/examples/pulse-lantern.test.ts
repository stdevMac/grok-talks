import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPulseLantern } from "../../examples/pulse-lantern/run.js";
import { TalksBus } from "../../src/bus/talks.js";
import { deps } from "../helpers.js";

describe("pulse lantern dummy", () => {
  it("builds a neon sign with more than one role on the office bus", () => {
    const d = deps();
    const bus = new TalksBus(d);
    const outDir = path.join(d.dataDir, "lantern-out");
    const result = runPulseLantern(bus, outDir);

    expect(result.collisionDenied).toBe(true);
    expect(result.retiredAfterHandoff).toBe(true);
    expect(result.boardNames).toEqual(["lead"]);
    expect(result.contributions.length).toBeGreaterThan(1);
    expect(fs.existsSync(result.htmlPath)).toBe(true);
    expect(result.html).toContain("GROK TALKS");
    expect(result.html).toContain("data-role=\"frontend\"");
    expect(result.html).toContain("data-role=\"backend\"");
    expect(result.html).toContain("data-role=\"qa\"");
    expect(result.html).toContain("#7df9ff");
    expect(result.html).toContain("pulse 2.4s");

    const published = path.resolve("examples/pulse-lantern/out/index.html");
    fs.mkdirSync(path.dirname(published), { recursive: true });
    fs.writeFileSync(published, result.html, "utf8");
    expect(fs.readFileSync(published, "utf8")).toContain("GROK TALKS");
  });
});
