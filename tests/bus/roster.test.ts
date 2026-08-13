import { describe, expect, it } from "vitest";
import { isLive, listRoster, readRoster, removeRoster, writeRoster } from "../../src/bus/roster.js";
import { HEARTBEAT_MS, type RosterEntry } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

function entry(over: Partial<RosterEntry> = {}): RosterEntry {
  return {
    session_id: "aaa",
    name: "payverge·aaa",
    cwd: "/repo",
    project: "/repo",
    pid: 100,
    working_on: "first",
    state: "idle",
    heartbeat_at: "2026-08-13T12:00:00.000Z",
    plugin_version: "1",
    ...over,
  };
}

describe("roster", () => {
  it("writes and reads a roster file", () => {
    const d = deps();
    writeRoster(d, entry());
    expect(readRoster(d, "aaa")?.name).toBe("payverge·aaa");
  });

  it("heartbeat updates time and does not clobber working_on", () => {
    const d = deps();
    writeRoster(d, entry());
    d.clock.advance(1000);
    writeRoster(d, { ...readRoster(d, "aaa")!, heartbeat_at: d.clock.now().toISOString() });
    expect(readRoster(d, "aaa")?.working_on).toBe("first");
  });

  it("treats dead pid as not live", () => {
    const d = deps();
    const e = entry({ pid: 999 });
    expect(isLive(d, e)).toBe(false);
  });

  it("treats heartbeat at 2:00 as stale and 1:59 as live", () => {
    const d = deps();
    const e = entry();
    d.clock.advance(HEARTBEAT_MS - 1);
    expect(isLive(d, e)).toBe(true);
    d.clock.advance(1);
    expect(isLive(d, e)).toBe(false);
  });

  it("hides stale peers from listRoster", () => {
    const d = deps();
    writeRoster(d, entry({ session_id: "aaa", pid: 100 }));
    writeRoster(d, entry({ session_id: "bbb", pid: 999, name: "dead" }));
    expect(listRoster(d).map((x) => x.session_id)).toEqual(["aaa"]);
  });

  it("removeRoster deletes the file", () => {
    const d = deps();
    writeRoster(d, entry());
    removeRoster(d, "aaa");
    expect(readRoster(d, "aaa")).toBeUndefined();
  });
});
