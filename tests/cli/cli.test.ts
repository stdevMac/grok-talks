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
  });
});
