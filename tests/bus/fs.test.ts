import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { appendJsonl, readJson, readJsonl, writeJsonAtomic } from "../../src/bus/fs.js";
import { tempDir } from "../helpers.js";

describe("fs helpers", () => {
  it("writes json atomically and reads it back", () => {
    const dir = tempDir();
    const file = path.join(dir, "roster", "a.json");
    writeJsonAtomic(file, { n: 1 });
    expect(readJson<{ n: number }>(file)).toEqual({ n: 1 });
  });

  it("returns undefined for missing or torn json", () => {
    const dir = tempDir();
    const file = path.join(dir, "bad.json");
    expect(readJson(file)).toBeUndefined();
    fs.writeFileSync(file, "{");
    expect(readJson(file)).toBeUndefined();
    fs.writeFileSync(file, "");
    expect(readJson(file)).toBeUndefined();
  });

  it("appends jsonl and skips torn lines", () => {
    const dir = tempDir();
    const file = path.join(dir, "inbox", "a.jsonl");
    appendJsonl(file, { id: "1" });
    fs.appendFileSync(file, "not-json\n");
    appendJsonl(file, { id: "2" });
    expect(readJsonl<{ id: string }>(file).map((x) => x.id)).toEqual(["1", "2"]);
  });
});
