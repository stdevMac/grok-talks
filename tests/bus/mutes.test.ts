import { describe, expect, it } from "vitest";
import { isMuted, readMutes, setMute } from "../../src/bus/mutes.js";
import { deps } from "../helpers.js";

describe("mutes", () => {
  it("mutes one peer and unmute restores", () => {
    const d = deps();
    expect(isMuted(d, "aaa", "bbb")).toBe(false);
    setMute(d, "aaa", { all: false, peers: ["bbb"] });
    expect(isMuted(d, "aaa", "bbb")).toBe(true);
    setMute(d, "aaa", { all: false, peers: [] });
    expect(isMuted(d, "aaa", "bbb")).toBe(false);
  });

  it("mute all blocks every sender", () => {
    const d = deps();
    setMute(d, "aaa", { all: true, peers: [] });
    expect(isMuted(d, "aaa", "zzz")).toBe(true);
  });

  it("missing or torn mute file is unmuted", () => {
    const d = deps();
    expect(readMutes(d, "aaa")).toEqual({ all: false, peers: [] });
  });
});
