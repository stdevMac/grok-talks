import { describe, expect, it } from "vitest";
import { addDeny, hasDeny } from "../../src/bus/denies.js";
import { hasTalked, markTalked } from "../../src/bus/talked.js";
import { deps } from "../helpers.js";

describe("denies and talked", () => {
  it("persists a deny key", () => {
    const d = deps();
    addDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t1" });
    expect(hasDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t1" })).toBe(true);
    expect(hasDeny(d, "aaa", { peer: "bbb", path: "/repo/a.ts", claim_last_at: "t2" })).toBe(false);
  });

  it("records talked peers", () => {
    const d = deps();
    expect(hasTalked(d, "aaa", "bbb")).toBe(false);
    markTalked(d, "aaa", "bbb");
    expect(hasTalked(d, "aaa", "bbb")).toBe(true);
  });
});
