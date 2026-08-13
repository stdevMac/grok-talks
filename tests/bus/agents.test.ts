import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ALL_SQUAD_CARDS } from "../../src/bus/roleCards.js";

const agentsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../agents");

const PLAN_ROLES = new Set(["planner", "explorer", "validator", "visual-qa"]);

function parseFrontmatter(raw: string): Record<string, string> {
  const m = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return {};
  const out: Record<string, string> = {};
  let key = "";
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([a-z_]+):\s*(.*)$/);
    if (kv) {
      key = kv[1];
      out[key] = kv[2].replace(/^>\s*/, "").trim();
      continue;
    }
    if (key && /^\s/.test(line)) out[key] += " " + line.trim();
  }
  return out;
}

describe("plugin agents", () => {
  it("ships a Grok agent for every squad card with talks_role and the right permission mode", () => {
    for (const role of ALL_SQUAD_CARDS) {
      const file = path.join(agentsDir, `${role}.md`);
      expect(fs.existsSync(file), file).toBe(true);
      const raw = fs.readFileSync(file, "utf8");
      const fm = parseFrontmatter(raw);
      expect(fm.name).toBe(role);
      expect(fm.description.toLowerCase()).toMatch(/use when/);
      expect(fm.prompt_mode).toBe("full");
      expect(fm.permission_mode).toBe(PLAN_ROLES.has(role) ? "plan" : "default");
      expect(raw).toMatch(/talks_role/);
      if (role !== "lead") expect(raw).not.toMatch(/talks_approve/);
    }
  });
});
