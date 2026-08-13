import { describe, expect, it } from "vitest";
import { appendMail, drainInbox, listUnread } from "../../src/bus/inbox.js";
import type { Mail } from "../../src/bus/types.js";
import { deps } from "../helpers.js";

function mail(over: Partial<Mail> = {}): Omit<Mail, "id" | "ts"> & Partial<Pick<Mail, "id" | "ts">> {
  return {
    from: "bbb",
    from_name: "b",
    kind: "chat",
    project: "/repo",
    body: "hi",
    paths: [],
    ...over,
  };
}

describe("inbox", () => {
  it("appends and lists unread oldest first", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ body: "one" }));
    d.clock.advance(1000);
    appendMail(d, "aaa", mail({ body: "two" }));
    expect(listUnread(d, "aaa").map((m) => m.body)).toEqual(["one", "two"]);
  });

  it("drain marks only returned ids read and caps at 8", () => {
    const d = deps();
    for (let i = 0; i < 10; i++) appendMail(d, "aaa", mail({ body: String(i) }));
    const first = drainInbox(d, "aaa", 8);
    expect(first.map((m) => m.body)).toEqual(["0", "1", "2", "3", "4", "5", "6", "7"]);
    const second = drainInbox(d, "aaa", 8);
    expect(second.map((m) => m.body)).toEqual(["8", "9"]);
  });

  it("skips muted senders without marking them read", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ from: "bbb", body: "hidden" }));
    appendMail(d, "aaa", mail({ from: "ccc", body: "shown" }));
    const got = drainInbox(d, "aaa", 8, new Set(["bbb"]));
    expect(got.map((m) => m.body)).toEqual(["shown"]);
    expect(listUnread(d, "aaa", new Set()).map((m) => m.body)).toEqual(["hidden"]);
  });

  it("coalesces collision keys to the newest undelivered line", () => {
    const d = deps();
    appendMail(d, "aaa", mail({ kind: "collision", paths: ["/repo/a.ts"], body: "old" }));
    d.clock.advance(1000);
    appendMail(d, "aaa", mail({ kind: "collision", paths: ["/repo/a.ts"], body: "new" }));
    const got = drainInbox(d, "aaa", 8);
    expect(got.map((m) => m.body)).toEqual(["new"]);
    expect(listUnread(d, "aaa")).toEqual([]);
  });
});
