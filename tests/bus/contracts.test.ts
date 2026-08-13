import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { handoffDenied, loadCaps } from "../../src/bus/contracts.js";
import { tempDir } from "../helpers.js";

describe("contracts", () => {
  it("loads shipped caps and ignores a broken project pack", () => {
    const base = loadCaps();
    expect(base.maxTransient).toBe(4);
    expect(base.perRole.planner).toBe(1);

    const cwd = tempDir("pack-");
    fs.mkdirSync(path.join(cwd, ".grok"), { recursive: true });
    fs.writeFileSync(path.join(cwd, ".grok", "talks-pack.json"), "{not json");
    expect(loadCaps(cwd).maxTransient).toBe(4);
  });

  it("merges a valid pack and drops non-numeric overrides", () => {
    const cwd = tempDir("pack-");
    fs.mkdirSync(path.join(cwd, ".grok"), { recursive: true });
    fs.writeFileSync(
      path.join(cwd, ".grok", "talks-pack.json"),
      JSON.stringify({ maxTransient: 8, perRole: { planner: 2, frontend: "nope" } }),
    );
    const caps = loadCaps(cwd);
    expect(caps.maxTransient).toBe(8);
    expect(caps.perRole.planner).toBe(2);
    expect(caps.perRole.frontend).toBe(2);
  });

  it("allows a worker to hand off to a known lead even when the lead is not named lead", () => {
    const denied = handoffDenied(
      {
        session_id: "fe",
        name: "frontend",
        cwd: "/repo",
        project: "/repo",
        pid: 1,
        working_on: "",
        state: "working",
        heartbeat_at: "2026-08-13T12:00:00.000Z",
        plugin_version: "1",
      },
      {
        session_id: "lead-1",
        name: "host",
        cwd: "/repo",
        project: "/repo",
        pid: 1,
        working_on: "",
        state: "idle",
        heartbeat_at: "2026-08-13T12:00:00.000Z",
        plugin_version: "1",
      },
      { toIsLead: true },
    );
    expect(denied).toBeUndefined();
  });
});
