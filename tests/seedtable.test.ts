/**
 * The seed table: constraint enforcement, spread, and exhaustion.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";
import { FileNotFoundError, get, has, sorted, truthy } from "../bjt/py.ts";
import * as seedtable from "../bjt/seedtable.ts";
import { getGenerator } from "../bjt/generators/index.ts";
import { RELATION_NOTES } from "../bjt/generators/base.ts";
import * as tts_plan from "../bjt/tts/plan.ts";
import { sameSet, setConfig, tmpPath } from "./helpers.ts";

type Item = Record<string, any>;

const BATCHES = path.resolve(import.meta.dirname, "..", "batches");
const TABLES = seedtable.available();

function table(): seedtable.SeedTable {
  return seedtable.load("hatsugen_choukai");
}

/** `set(a) == set(b)`, as sorted arrays. */
describe("seedtable", () => {
  test.each(TABLES)("every cell satisfies all three constraints %s", (itemType) => {
    const t = seedtable.load(itemType);
    const data = t.data;
    const settings: Record<string, Item> = Object.fromEntries(data["settings"].map((s: Item) => [s["id"], s]));
    const functions: Record<string, Item> = Object.fromEntries(data["functions"].map((f: Item) => [f["id"], f]));
    for (const cell of t.cells()) {
      const setting = settings[cell.setting];
      const fn = functions[cell.function];
      expect(data["setting_relations"][cell.setting]).toContain(cell.relation);
      expect(fn["relations"]).toContain(cell.relation);
      expect(fn["channels"]).toContain(setting["channel"]);
      expect(cell.channel).toBe(setting["channel"]);
      if (truthy(get(fn, "settings"))) {
        expect(fn["settings"]).toContain(cell.setting);
      }
    }
  });

  test.each(TABLES)("every id a table names is one it declares %s", (itemType) => {
    // A typo in a constraint list does not fail loudly: the enumeration simply
    // skips a relation it cannot find, and the cells somebody meant to add are
    // never there. So a table that names an id it does not declare is wrong.
    const data = seedtable.load(itemType).data;
    const settings = new Set<string>(data["settings"].map((s: Item) => s["id"]));
    const relations = new Set<string>(data["relations"].map((r: Item) => r["id"]));
    sameSet(Object.keys(data["setting_relations"]), settings);
    for (const [sid, rels] of Object.entries(data["setting_relations"] as Record<string, string[]>)) {
      const unknown = rels.filter((r) => !relations.has(r));
      expect(unknown, `${sid}: ${unknown}`).toEqual([]);
    }
    for (const f of data["functions"] as Item[]) {
      const unknown = (f["relations"] as string[]).filter((r) => !relations.has(r));
      expect(unknown, `${f["id"]}: ${unknown}`).toEqual([]);
      const badSettings = ((get(f, "settings") || []) as string[]).filter((s) => !settings.has(s));
      expect(badSettings, `${f["id"]} names a setting that is not one`).toEqual([]);
    }
  });

  function* _committedItems(): Generator<[string, string, Item]> {
    for (const name of sorted(readdirSync(BATCHES).filter((n) => n.endsWith(".json")))) {
      if (name.endsWith(".source.json")) {
        continue;
      }
      const bundle = JSON.parse(readFileSync(path.join(BATCHES, name), "utf8"));
      for (const item of bundle["items"]) {
        yield [name, bundle["item_type"], item];
      }
    }
  }

  test("every committed item is still a cell of its table", () => {
    // The tables only ever grow. `itemId` hashes (type, cell), so a cell that
    // stops existing — a setting renamed, a relation dropped, a channel changed
    // under it — orphans the item that spent it: `importbatch` cannot rebuild
    // it, and a later item written for the renamed cell would be a second
    // copy of a question the bank already has. Additions are free; this is what
    // says the rest were additions.
    const problems: string[] = [];
    for (const [name, itemType, item] of _committedItems()) {
      const cell = seedtable.load(itemType).get(get(get(item, "seed_cell") || {}, "id", ""));
      if (cell === null) {
        problems.push(`${name}: ${item["seed_cell"]["id"]} is not a cell any more`);
        continue;
      }
      if (truthy(get(item, "channel")) && item["channel"] !== cell.channel) {
        problems.push(`${name}: ${cell.id} is ${cell.channel}, the item ${item["channel"]}`);
      }
      for (const doc of (get(item, "documents") || []) as Item[]) {
        if (cell.templates.length > 0 && !cell.templates.includes(get(doc, "template"))) {
          problems.push(`${name}: ${cell.id} no longer offers ${get(doc, "template")}`);
        }
      }
      if (cell.scenes.length > 0 && truthy(get(item, "scene_id")) && !truthy(get(item, "image_brief"))
          && !cell.scenes.includes(item["scene_id"])) {
        problems.push(`${name}: ${cell.id} no longer offers ${item["scene_id"]}`);
      }
    }
    expect(problems).toEqual([]);
  });

  test.each(TABLES)("every relation is cast %s", (itemType) => {
    // The voice follows the relation. A relation with no entry in the cast
    // would be spoken by whichever voice the fallback happens to be — and would
    // move the day somebody noticed and gave it one, which re-voices every clip
    // already live.
    for (const relation of seedtable.load(itemType).data["relations"] as Item[]) {
      expect(has(tts_plan.RELATION_VOICES, relation["id"]), relation["id"]).toBe(true);
    }
  });

  // ----- ウチ/ソト as a relation --------------------------------------------

  const UCHI_SOTO_TYPES = ["hatsugen_choukai", "hyougen", "bamen_haaku"];

  test.each(UCHI_SOTO_TYPES)("a batch can aim at uchi soto %s", (itemType) => {
    // ウチ/ソト is a relation with cells of its own at every level, not only a
    // distractor role (`wrong_uchi_soto`), so a batch can be asked to be about
    // it.
    const t = seedtable.load(itemType);
    for (const level of t.levels) {
      expect(t.cells({ level }).some((c) => c.relation === "uchi_to_soto"), level).toBe(true);
    }
  });

  test("uchi soto is spoken by the voice that speaks to clients", () => {
    // A staff member talking to an outsider about their boss is the same
    // person as one talking to the outsider about anything else. The cast is
    // fixed; a relation added later borrows a voice rather than adding one.
    const voices = tts_plan.RELATION_VOICES;
    expect(voices["uchi_to_soto"]).toBe(voices["staff_to_client"]);
  });

  test("uchi soto never happens where there is no outsider", () => {
    for (const itemType of UCHI_SOTO_TYPES) {
      const t = seedtable.load(itemType);
      const inward = new Set(
        Object.entries(t.data["setting_relations"] as Record<string, string[]>)
          .filter(([, rels]) => !rels.some((r) => r.startsWith("staff_to_")))
          .map(([s]) => s),
      );
      for (const cell of t.cells()) {
        if (cell.relation === "uchi_to_soto") {
          expect(inward.has(cell.setting), cell.id).toBe(false);
        }
      }
    }
  });

  test.each(TABLES)("a relation that needs explaining is explained %s", (itemType) => {
    // 「自社 → 社外（身内のことを話す）」 is the arrow; the note is what a writer
    // needs to know about it — that the item turns on the colleague being talked
    // about, not on the two people talking. Every prompt for such a cell says so.
    const t = seedtable.load(itemType);
    const gen = getGenerator(itemType);
    for (const [relation, note] of Object.entries(RELATION_NOTES)) {
      const cell = t.cells().find((c) => c.relation === relation) ?? null;
      if (cell !== null) {
        expect(gen.userPrompt(cell.level, [], { cell })).toContain(note);
      }
    }
    const ordinary = t.cells().find((c) => !has(RELATION_NOTES, c.relation));
    if (ordinary === undefined) {
      throw new Error("StopIteration");
    }
    const prompt = gen.userPrompt(ordinary.level, [], { cell: ordinary });
    expect(Object.values(RELATION_NOTES).some((note) => prompt.includes(note))).toBe(false);
  });

  test("phone only functions never land in person", () => {
    // The constraint that stops 「来客を迎えて案内する」 over the phone, and
    // 「電話を取り次ぐ」 in a restaurant.
    for (const cell of table().cells()) {
      if (cell.function.startsWith("phone_")) {
        expect(cell.channel).toBe("phone");
      }
      if (["greet_and_guide", "offer_food"].includes(cell.function)) {
        expect(cell.channel).toBe("in_person");
      }
    }
  });

  test("cell ids are unique", () => {
    const ids = table().cells().map((c) => c.id);
    expect(ids.length).toBe(new Set(ids).size);
  });

  test("sample spreads across settings and functions", () => {
    const cells = table().sample(10, { level: "J2", seed: 3 });
    expect(cells.length).toBe(10);
    // Ten picks, ten different functions — that is the whole point of sampling
    // greedily rather than uniformly.
    expect(new Set(cells.map((c) => c.function)).size).toBe(10);
    expect(new Set(cells.map((c) => c.setting)).size).toBeGreaterThanOrEqual(7);
  });

  test("sample never returns an excluded cell", () => {
    const t = table();
    const first = t.sample(5, { level: "J2", seed: 1 });
    const used = new Set(first.map((c) => c.id));
    const second = t.sample(5, { level: "J2", excludeIds: used, seed: 1 });
    expect(second.filter((c) => used.has(c.id))).toEqual([]);
  });

  test("sample is capped by the pool rather than repeating", () => {
    const t = table();
    const everything = new Set(t.cells({ level: "J3" }).map((c) => c.id));
    const got = t.sample(everything.size + 50, { level: "J3", excludeIds: everything });
    expect(got).toEqual([]);
  });

  test("every setting offers at least one scene", () => {
    const t = table();
    for (const cell of t.cells()) {
      expect(cell.scenes.length > 0, `${cell.setting} has no scene to draw`).toBe(true);
    }
    // The bank stays small on purpose — images are reused, not generated per item.
    expect(t.scene_bank.length).toBeLessThanOrEqual(100);
  });

  test("coverage counts only cells in this table", () => {
    const t = table();
    const some = t.cells({ level: "J2" }).slice(0, 3).map((c) => c.id);
    const cov = t.coverage([...some, "not_a_real_cell@J2"]);
    expect(cov["used_cells"]).toBe(3);
    expect(cov["total_cells"]).toBe(t.cells().length);
  });

  test("missing table raises rather than silently degrading", () => {
    setConfig({ SEEDTABLE_DIR: tmpPath() });
    expect(() => seedtable.load("hyougen")).toThrow(FileNotFoundError);
  });

  test("every referenced scene has a label", () => {
    // The bank is a commissioning list: an id with no description is a picture
    // nobody can draw.
    const t = table();
    const labels = t.scene_labels;
    for (const scene of t.scene_bank) {
      expect(truthy(get(labels, scene)), `${scene} has no label`).toBe(true);
    }
  });

  test("no orphan labels", () => {
    const t = table();
    sameSet(Object.keys(t.scene_labels), t.scene_bank);
  });

  test.each(TABLES)("every scene any table asks for has a label %s", (itemType) => {
    // `bjt publish` labels a scene from its table. A setting that offers a
    // scene its table has no words for publishes a picture with a blank label.
    const t = seedtable.load(itemType);
    for (const scene of t.scene_bank) {
      expect(truthy(get(t.scene_labels, scene)), `${itemType}: ${scene} has no label`).toBe(true);
    }
  });

  // ----- the situations the exam tests -----------------------------------------
  //
  // Negotiation, the meeting, instructions, consulting, introductions,
  // appointments and condolences must be in the tables: a situation no table
  // offers cannot be written about however a batch is prompted. They are
  // functions where the type is about what somebody says, and settings where it
  // is about what somebody understands.

  const SPOKEN_ACTS = ["negotiate_price", "negotiate_terms", "state_opinion", "object_politely",
                       "chair_meeting", "instruct", "consult", "introduce_other",
                       "make_appointment", "condolence"];

  const ACT_CASES: [string, string][] = [];
  for (const fn of SPOKEN_ACTS) {
    for (const itemType of ["hatsugen_choukai", "hyougen"]) {
      ACT_CASES.push([itemType, fn]);
    }
  }

  test.each(ACT_CASES)("every missing speech act now has cells %s %s", (itemType, fn) => {
    const t = seedtable.load(itemType);
    for (const level of t.levels) {
      expect(t.cells({ level }).some((c) => c.function === fn), `${fn} ${level}`).toBe(true);
    }
  });

  test.each([
    ["sougou_choukai", ["negotiation", "regular_meeting"]],
    ["sougou_choudokkai", ["negotiation", "regular_meeting"]],
    ["shiryou_choudokkai", ["negotiation"]],
    ["sougou_dokkai", ["negotiation_thread", "meeting_record", "condolence_notice"]],
    ["bamen_haaku", ["negotiation_table"]],
  ] as [string, string[]][])("the comprehension types gain situations not questions %s %s", (itemType, settings) => {
    // Their function axis is what the question asks — who decided, what
    // changed, what comes next — and those questions already fit a negotiation or
    // a regular meeting. What the table supplies is the situation to ask them
    // about.
    const t = seedtable.load(itemType);
    for (const setting of settings) {
      for (const level of t.levels) {
        expect(t.cells({ level }).some((c) => c.setting === setting), `${setting} ${level}`).toBe(true);
      }
    }
  });

  test.each(["hatsugen_choukai", "hyougen"])("the meeting acts happen in meetings %s", (itemType) => {
    // An opinion, an objection and the chair belong to a meeting — face to
    // face or online, or (for a written objection) in the email thread about it —
    // never at the reception counter or over a dinner table.
    const meetings = new Set(["meeting_room", "client_office", "video_call",
                              "email_external", "email_internal", "chat_internal"]);
    for (const cell of seedtable.load(itemType).cells()) {
      if (["state_opinion", "object_politely", "chair_meeting"].includes(cell.function)) {
        expect(meetings.has(cell.setting), cell.id).toBe(true);
      }
      if (cell.function === "chair_meeting") {
        expect(["in_person", "video"], cell.id).toContain(cell.channel);
      }
    }
  });

  test.each(["hatsugen_choukai", "hyougen"])("condolences are never sent by chat or a screen %s", (itemType) => {
    // お見舞い and お悔やみ are said in person, on the phone, or in a considered
    // email. A chat message, a posted notice or a video call is the wrong
    // medium, and an item set there would teach that it is not.
    for (const cell of seedtable.load(itemType).cells()) {
      if (cell.function === "condolence") {
        expect(["in_person", "phone", "written"], cell.id).toContain(cell.channel);
        expect(["chat_internal", "notice_document"], cell.id).not.toContain(cell.setting);
      }
    }
  });

  test.each(["hatsugen_choukai", "hyougen"])("only a superior gives instructions %s", (itemType) => {
    for (const cell of seedtable.load(itemType).cells()) {
      if (cell.function === "instruct") {
        expect(cell.relation, cell.id).toBe("superior_to_subordinate");
      }
    }
  });
});
