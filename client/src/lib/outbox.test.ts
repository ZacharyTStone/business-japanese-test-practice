/**
 * The answers that could not be sent: kept, sent once, and never graded here.
 */
import { describe, expect, it } from "vitest";

import { makeOutbox, MAX_FAILURES, refusalOf, type AttemptArgs, type Graded, type KeyValueStore, type Sender } from "./outbox";

function memory(): KeyValueStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: async (k) => data.get(k) ?? null,
    setItem: async (k, v) => {
      data.set(k, v);
    },
    removeItem: async (k) => {
      data.delete(k);
    },
  };
}

const args = (itemId: string, extra: Partial<AttemptArgs> = {}): AttemptArgs => ({
  itemId,
  chosenIndex: 1,
  sessionId: "s1",
  elapsedMs: 12_345,
  thinkMs: 9_000,
  replays: 0,
  peeked: false,
  standsFor: null,
  ...extra,
});

const offline = { message: "TypeError: Failed to fetch", details: "", hint: "", code: "" };
const dayOver = { message: "daily limit reached", hint: "daily_limit_reached", code: "23514" };
const gone = { message: "item unavailable", hint: "item_unavailable", code: "P0001" };
const broken = { message: "column does not exist", hint: "", code: "42703" };
const right: Graded = { isCorrect: true, chosenRole: "correct" };

/** A database that records what it was sent, answering from a script. */
function database(script: (a: AttemptArgs) => Graded | { throws: unknown }, existing: AttemptArgs[] = []) {
  const posted: AttemptArgs[] = [];
  const sender: Sender = {
    post: async (a) => {
      const out = script(a);
      if ("throws" in out) throw out.throws;
      posted.push(a);
      return out;
    },
    find: async (a) => {
      const hit = [...existing, ...posted].find(
        (e) =>
          e.itemId === a.itemId &&
          e.chosenIndex === a.chosenIndex &&
          e.elapsedMs === a.elapsedMs &&
          e.thinkMs === a.thinkMs &&
          e.replays === a.replays
      );
      return hit ? right : null;
    },
  };
  return { sender, posted };
}

describe("sending an answer", () => {
  it("returns the database's verdict when the insert lands", async () => {
    const box = makeOutbox(memory());
    const db = database(() => right);
    expect(await box.send("u", args("q1"), db.sender, 1)).toEqual({ kind: "saved", graded: right });
    expect(await box.read("u")).toEqual([]);
  });

  it("queues the exact insert when the request never arrived", async () => {
    const box = makeOutbox(memory());
    const db = database(() => ({ throws: offline }));
    expect(await box.send("u", args("q1"), db.sender, 1)).toEqual({ kind: "queued" });
    const [entry] = await box.read("u");
    expect(entry.args).toEqual(args("q1"));
    // Nothing that looks like a grade is kept: the database grades it later.
    expect(JSON.stringify(entry)).not.toMatch(/is_?correct|role/i);
  });

  it("names the database's two refusals, and queues neither", async () => {
    const box = makeOutbox(memory());
    expect((await box.send("u", args("q1"), database(() => ({ throws: dayOver })).sender, 1)).kind).toBe("day_over");
    expect((await box.send("u", args("q2"), database(() => ({ throws: gone })).sender, 1)).kind).toBe("unavailable");
    expect(await box.read("u")).toEqual([]);
  });

  it("reports any other error as a failure, not queued", async () => {
    const box = makeOutbox(memory());
    const out = await box.send("u", args("q1"), database(() => ({ throws: broken })).sender, 1);
    expect(out.kind).toBe("failed");
    expect(await box.read("u")).toEqual([]);
  });

  it("keeps each account's answers apart", async () => {
    const box = makeOutbox(memory());
    await box.send("a", args("q1"), database(() => ({ throws: offline })).sender, 1);
    expect(await box.read("b")).toEqual([]);
    expect(await box.read("a")).toHaveLength(1);
  });
});

describe("flushing the queue", () => {
  it("sends what waited, oldest first, and empties the queue", async () => {
    const box = makeOutbox(memory());
    const down = database(() => ({ throws: offline }));
    await box.send("u", args("q1"), down.sender, 1);
    await box.send("u", args("q2"), down.sender, 2);
    const up = database(() => right);
    const result = await box.flush("u", up.sender);
    expect(up.posted.map((a) => a.itemId)).toEqual(["q1", "q2"]);
    expect(result).toEqual({
      saved: [
        { itemId: "q1", graded: right },
        { itemId: "q2", graded: right },
      ],
      dropped: [],
      left: 0,
    });
  });

  it("does not post an answer the database already has", async () => {
    const box = makeOutbox(memory());
    await box.send("u", args("q1"), database(() => ({ throws: offline })).sender, 1);
    // The first insert landed after all; only its reply was lost.
    const db = database(() => right, [args("q1")]);
    const result = await box.flush("u", db.sender);
    expect(db.posted).toEqual([]);
    expect(result.saved).toEqual([{ itemId: "q1", graded: right }]);
    expect(await box.read("u")).toEqual([]);
  });

  it("keeps everything, in order, while still offline", async () => {
    const box = makeOutbox(memory());
    const down = database(() => ({ throws: offline }));
    await box.send("u", args("q1"), down.sender, 1);
    await box.send("u", args("q2"), down.sender, 2);
    const result = await box.flush("u", down.sender);
    expect(result).toEqual({ saved: [], dropped: [], left: 2 });
    expect((await box.read("u")).map((e) => e.args.itemId)).toEqual(["q1", "q2"]);
  });

  it("drops what the database refuses: the day's door and a question gone", async () => {
    const box = makeOutbox(memory());
    const down = database(() => ({ throws: offline }));
    await box.send("u", args("q1"), down.sender, 1);
    await box.send("u", args("q2"), down.sender, 2);
    await box.send("u", args("q3"), down.sender, 3);
    const db = database((a) => (a.itemId === "q1" ? { throws: dayOver } : a.itemId === "q2" ? { throws: gone } : right));
    const result = await box.flush("u", db.sender);
    expect(result.dropped).toEqual([
      { itemId: "q1", reason: "day_over" },
      { itemId: "q2", reason: "unavailable" },
    ]);
    expect(result.saved.map((s) => s.itemId)).toEqual(["q3"]);
    expect(result.left).toBe(0);
  });

  it("gives up on an entry the database keeps rejecting, after MAX_FAILURES", async () => {
    const box = makeOutbox(memory());
    await box.send("u", args("q1"), database(() => ({ throws: offline })).sender, 1);
    const db = database(() => ({ throws: broken }));
    for (let i = 1; i < MAX_FAILURES; i++) {
      expect((await box.flush("u", db.sender)).left).toBe(1);
    }
    const last = await box.flush("u", db.sender);
    expect(last.dropped).toEqual([{ itemId: "q1", reason: "failed" }]);
    expect(last.left).toBe(0);
  });

  it("sends an entry once when two flushes are asked for together", async () => {
    const box = makeOutbox(memory());
    await box.send("u", args("q1"), database(() => ({ throws: offline })).sender, 1);
    const db = database(() => right);
    await Promise.all([box.flush("u", db.sender), box.flush("u", db.sender)]);
    expect(db.posted).toHaveLength(1);
  });

  it("does not lose an answer queued while a flush is running", async () => {
    const box = makeOutbox(memory());
    const down = database(() => ({ throws: offline }));
    await box.send("u", args("q1"), down.sender, 1);
    let release: () => void = () => {};
    const slow: Sender = {
      find: async () => null,
      post: () =>
        new Promise((resolve) => {
          release = () => resolve(right);
        }),
    };
    const flushing = box.flush("u", slow);
    await new Promise((r) => setTimeout(r, 0));
    await box.send("u", args("q2"), down.sender, 2);
    release();
    await flushing;
    expect((await box.read("u")).map((e) => e.args.itemId)).toEqual(["q2"]);
  });
});

describe("sending again by hand", () => {
  it("does not post an answer that landed after all", async () => {
    const box = makeOutbox(memory());
    const db = database(() => right, [args("q1")]);
    expect(await box.sendAgain("u", args("q1"), db.sender, 1)).toEqual({ kind: "saved", graded: right });
    expect(db.posted).toEqual([]);
  });

  it("posts one that did not, and queues it if the line is down", async () => {
    const box = makeOutbox(memory());
    const up = database(() => right);
    expect((await box.sendAgain("u", args("q1"), up.sender, 1)).kind).toBe("saved");
    expect(up.posted).toHaveLength(1);
    const down = database(() => ({ throws: offline }));
    down.sender.find = async () => {
      throw offline;
    };
    expect((await box.sendAgain("u", args("q2"), down.sender, 2)).kind).toBe("queued");
  });
});

describe("reading a refusal", () => {
  it("goes by the hint, not the wording", () => {
    expect(refusalOf(dayOver)).toBe("day_over");
    expect(refusalOf({ ...gone, message: "reworded" })).toBe("unavailable");
    expect(refusalOf(broken)).toBeNull();
    expect(refusalOf("daily_limit_reached")).toBeNull();
  });
});
