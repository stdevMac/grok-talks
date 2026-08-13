import { describe, expect, it } from "vitest";
import { bindSession, resolveSessionId, unbindSession } from "../../src/bus/sessionBind.js";
import { deps } from "../helpers.js";

describe("session bind", () => {
  it("resolves explicit, then env, then pid bind", () => {
    const d = deps();
    expect(resolveSessionId(d.dataDir, { explicit: "aaa" })).toBe("aaa");
    expect(resolveSessionId(d.dataDir, { env: { GROK_SESSION_ID: "env-1" } })).toBe("env-1");
    bindSession(d.dataDir, 4242, "bound");
    expect(resolveSessionId(d.dataDir, { ppid: 4242, env: {} })).toBe("bound");
    unbindSession(d.dataDir, "bound");
    expect(resolveSessionId(d.dataDir, { ppid: 4242, env: {} })).toBe("");
  });
});
