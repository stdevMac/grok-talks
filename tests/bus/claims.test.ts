import { describe, expect, it } from "vitest";
import { liveClaims, removeClaims, touchClaim } from "../../src/bus/claims.js";
import { CLAIM_TTL_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("claims", () => {
  it("records an absolute path and refreshes last_at", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    d.clock.advance(1000);
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    const rows = liveClaims(d, "aaa");
    expect(rows).toHaveLength(1);
    expect(rows[0].path).toBe("/repo/src/auth.ts");
    expect(rows[0].last_at).toBe(d.clock.now().toISOString());
  });

  it("expires claims at 10 minutes", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/src/auth.ts");
    d.clock.advance(CLAIM_TTL_MS - 1);
    expect(liveClaims(d, "aaa")).toHaveLength(1);
    d.clock.advance(1);
    expect(liveClaims(d, "aaa")).toHaveLength(0);
  });

  it("keeps two paths independent", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/a.ts");
    touchClaim(d, "aaa", "/repo", "/repo/b.ts");
    expect(liveClaims(d, "aaa").map((c) => c.path).sort()).toEqual(["/repo/a.ts", "/repo/b.ts"]);
  });

  it("removeClaims clears the file", () => {
    const d = deps();
    touchClaim(d, "aaa", "/repo", "/repo/a.ts");
    removeClaims(d, "aaa");
    expect(liveClaims(d, "aaa")).toEqual([]);
  });
});
