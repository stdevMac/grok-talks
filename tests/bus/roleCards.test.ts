import { describe, expect, it } from "vitest";
import {
  ALL_SQUAD_CARDS,
  cardFromSession,
  formatRoleBriefing,
  loadConstitution,
  loadRoleCard,
} from "../../src/bus/roleCards.js";

describe("role cards", () => {
  it("loads the constitution and every shipped role card", () => {
    const constitution = loadConstitution();
    expect(constitution).toMatch(/talks_role/);
    expect(constitution).toMatch(/lead/);
    for (const role of ALL_SQUAD_CARDS) {
      const card = loadRoleCard(role);
      expect(card.length).toBeGreaterThan(40);
      expect(card.toLowerCase()).toContain(role === "qa" ? "qa" : role);
      const brief = formatRoleBriefing(role);
      expect(brief.startsWith(constitution)).toBe(true);
      expect(brief).toContain(card.trim().slice(0, 20));
    }
  });

  it("resolves a card from session name or id suffix", () => {
    expect(cardFromSession("planner", "abc")).toBe("planner");
    expect(cardFromSession("x", "squad-lead-1-frontend")).toBe("frontend");
    expect(cardFromSession("idle", "sess-1")).toBeUndefined();
  });
});
