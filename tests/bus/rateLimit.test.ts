import { describe, expect, it } from "vitest";
import { allowChat } from "../../src/bus/rateLimit.js";
import { CHAT_RATE, CHAT_WINDOW_MS } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

describe("rate limit", () => {
  it("allows 10 chats and rejects the 11th until the window passes", () => {
    const d = deps();
    for (let i = 0; i < CHAT_RATE; i++) {
      expect(allowChat(d, "bbb", "aaa")).toBe(true);
    }
    expect(allowChat(d, "bbb", "aaa")).toBe(false);
    d.clock.advance(CHAT_WINDOW_MS);
    expect(allowChat(d, "bbb", "aaa")).toBe(true);
  });
});
