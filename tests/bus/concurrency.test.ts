import { describe, expect, it } from "vitest";
import { readJsonl as readLines } from "../../src/bus/fs.js";
import { appendMail } from "../../src/bus/inbox.js";
import { busPaths } from "../../src/bus/paths.js";
import type { Mail } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("concurrency", () => {
  it("keeps 50 sequential appends as valid jsonl", () => {
    const d = deps();
    for (let i = 0; i < 50; i++) {
      appendMail(d, "aaa", {
        from: "bbb",
        from_name: "b",
        kind: "chat",
        project: "/repo",
        body: String(i),
        paths: [],
      });
    }
    const rows = readLines<Mail>(busPaths(d.dataDir, "aaa").inbox);
    expect(rows).toHaveLength(50);
  });
});
