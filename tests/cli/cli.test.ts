import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { runCli } from "../../src/cli.js";
import { deps } from "../helpers.js";

describe("cli", () => {
  it("board, send, inbox, mute", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100, title: "A" });
    bus.sessionStart({ sessionId: "bbb", cwd: "/repo", pid: 200, title: "B" });
    expect(runCli(bus, "aaa", ["board"]).text).toMatch(/B/);
    expect(runCli(bus, "bbb", ["send", "aaa", "hello"]).status).toBe(0);
    expect(runCli(bus, "aaa", ["inbox"]).text).toMatch(/hello/);
    runCli(bus, "aaa", ["mute", "bbb"]);
    expect(runCli(bus, "aaa", ["inbox", "--drain"]).text).not.toMatch(/hello/);
    expect(runCli(bus, "aaa", ["send", "nope", "x"]).status).toBe(1);
    expect(runCli(bus, "aaa", ["squad", "planner,qa"]).status).toBe(0);
    expect(runCli(bus, "aaa", ["board"]).text).toMatch(/planner/);
    expect(runCli(bus, "aaa", ["approve"]).status).toBe(1);
    expect(runCli(bus, "aaa", ["approve", "glass"]).status).toBe(0);
    const spawned = runCli(bus, "aaa", ["spawn", "explorer", "look", "scan the repo"]);
    expect(spawned.status).toBe(0);
    expect(spawned.text).toMatch(/--session-id [0-9a-f-]{36} --agent grok-talks:explorer "/);
    const explorerId = spawned.text.split("\t")[1];
    expect(runCli(bus, explorerId, ["handoff", "aaa", "look", "nothing to reuse", "--commit", "abcdef1"]).status).toBe(0);
    expect(runCli(bus, "aaa", ["inbox"]).text).toMatch(/COMMIT abcdef1/);
  });
});
