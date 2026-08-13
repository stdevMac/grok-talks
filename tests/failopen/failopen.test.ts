import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { TalksBus } from "../../src/bus/talks.js";
import { handleHook } from "../../src/hooks/handle.js";
import { deps } from "../helpers.js";

describe("fail-open", () => {
  it("pre_tool_use allows when roster is torn", () => {
    const d = deps();
    const bus = new TalksBus(d);
    bus.sessionStart({ sessionId: "aaa", cwd: "/repo", pid: 100 });
    fs.writeFileSync(path.join(d.dataDir, "roster", "aaa.json"), "{");
    const out = handleHook(
      bus,
      {
        hookEventName: "pre_tool_use",
        sessionId: "bbb",
        cwd: "/repo",
        toolName: "Write",
        toolInput: { path: "/repo/x.ts" },
      },
      { pid: 200 },
    );
    expect(out).toBeUndefined();
  });

  it("missing session id does not throw", () => {
    const d = deps();
    const bus = new TalksBus(d);
    expect(() => handleHook(bus, { hookEventName: "pre_tool_use" }, { pid: 1 })).not.toThrow();
  });
});
