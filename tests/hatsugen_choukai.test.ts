/**
 * 発言聴解: the seed cell is an assignment, and the schema enforces the fields
 * the audio and image pipelines depend on.
 */
import { describe, expect, test } from "vitest";
import * as batch from "../bjt/batch.ts";
import * as llm from "../bjt/llm.ts";
import { deepcopy, ValueError } from "../bjt/py.ts";
import * as schemas from "../bjt/schemas.ts";
import * as seedtable from "../bjt/seedtable.ts";
import { getGenerator } from "../bjt/generators/index.ts";
import * as tts_plan from "../bjt/tts/plan.ts";
import { patch } from "./helpers.ts";

type Item = Record<string, any>;

const CELL_ID = "phone_external+staff_to_client+phone_absence@J2";

function cell(): seedtable.Cell {
  const c = seedtable.load("hatsugen_choukai").get(CELL_ID);
  if (c === null) {
    throw new Error(`${CELL_ID} is not a cell`);
  }
  return c;
}

/** A minimal valid item for the cell above. */
function item(): Item {
  return {
    "item_type": "hatsugen_choukai",
    "level": "J2",
    "topic": "不在の伝達",
    "stem": "取引先から上司あてに電話がかかってきました。上司は外出中です。こんなとき、何と言いますか。",
    "scene_id": "scene_phone_desk",
    "speaker_role": "電話を受けた社員",
    "listener_role": "取引先の担当者",
    "channel": "phone",
    "options": [
      { "text": "田中はただいま外出しております。", "role": "correct",
        "why": "社外には身内を呼び捨てにし、謙譲語で述べるのが原則。" },
      { "text": "田中部長は外出されています。", "role": "wrong_uchi_soto",
        "why": "社外に対して身内の上司を尊敬語で高めている。" },
      { "text": "田中、今出ちゃってます。", "role": "register_too_casual",
        "why": "取引先に向ける丁寧さがない話し言葉になっている。" },
      { "text": "少々お待ちいただけますでしょうか。", "role": "content_mismatch",
        "why": "丁寧だが不在という肝心の情報を伝えていない。" },
    ],
    "explanation_ja": "社外には身内を低めて言う。",
    "explanation_en": "Own side takes humble forms toward outsiders.",
    "vocab_notes": [],
  };
}

describe("hatsugen_choukai", () => {
  test("item validates", () => {
    expect(schemas.validateItem("hatsugen_choukai", item())).toEqual([]);
  });

  test("missing listening fields are rejected", () => {
    const it = item();
    for (const field of ["scene_id", "speaker_role", "listener_role", "channel"]) {
      const broken = deepcopy(it);
      delete broken[field];
      const errs = schemas.validateItem("hatsugen_choukai", broken);
      expect(errs.some((e) => e.includes(field)), `${field} was not enforced`).toBe(true);
    }
  });

  test("unknown channel is rejected", () => {
    const it = item();
    it["channel"] = "telepathy";
    expect(schemas.validateItem("hatsugen_choukai", it).some((e) => e.includes("channel"))).toBe(true);
  });

  test("option without why is rejected", () => {
    const it = item();
    delete it["options"][2]["why"];
    expect(schemas.validateItem("hatsugen_choukai", it).some((e) => e.includes("missing why"))).toBe(true);
  });

  test("scene outside the cell is rejected", () => {
    const it = item();
    it["scene_id"] = "scene_restaurant_private";   // real scene, wrong setting
    const errs = getGenerator("hatsugen_choukai").validateExtra(it, { cell: cell() });
    expect(errs.some((e) => e.includes("scene_id"))).toBe(true);
  });

  test("channel disagreeing with the cell is rejected", () => {
    const it = item();
    it["channel"] = "in_person";                   // the cell is a phone cell
    const errs = getGenerator("hatsugen_choukai").validateExtra(it, { cell: cell() });
    expect(errs.some((e) => e.includes("channel"))).toBe(true);
  });

  test("generation refuses to run without a cell", async () => {
    await expect(getGenerator("hatsugen_choukai").generate({ level: "J2" })).rejects.toThrow(ValueError);
  });

  test("generation stamps the cell and takes its level", async () => {
    const it = item();
    const c = cell();
    patch(llm, "generateStructured", async () => deepcopy(it));
    const got = await getGenerator("hatsugen_choukai").generate({ cell: c, seed: 0 });
    expect(got["seed_cell"]["id"]).toBe(CELL_ID);
    expect(got["level"]).toBe(c.level);
  });

  test("generation retries when the model ignores the assigned scene", async () => {
    const it = item();
    const c = cell();
    const calls = { n: 0 };

    const fake = async () => {
      calls.n += 1;
      const out = deepcopy(it);
      if (calls.n === 1) {
        out["scene_id"] = "scene_izakaya_table";  // not one of this cell's scenes
      }
      return out;
    };

    patch(llm, "generateStructured", fake);
    const got = await getGenerator("hatsugen_choukai").generate({ cell: c, seed: 0 });
    expect(calls.n).toBe(2);
    expect(c.scenes).toContain(got["scene_id"]);
  });

  test("prompt carries the cell not a plea for variety", () => {
    const c = cell();
    const prompt = getGenerator("hatsugen_choukai").userPrompt("J2", [], { cell: c });
    expect(prompt).toContain(c.setting_ja);
    expect(prompt).toContain(c.relation_ja);
    expect(prompt).toContain(c.function_ja);
    for (const scene of c.scenes) {
      expect(prompt).toContain(scene);
    }
  });

  // ----- TTS planning ------------------------------------------------------

  test("voice follows the relation so it stays fixed across items", () => {
    const it = item();
    const c = cell();
    it["seed_cell"] = c.toDict();
    expect(tts_plan.voiceFor(it)).toBe(tts_plan.RELATION_VOICES[c.relation]);
  });

  test("narration stays clean even on a phone item", () => {
    const clips = tts_plan.planItem(item(), "x");
    expect(clips[0].kind).toBe("narration");
    // Only what is said *inside* the scene goes down the phone line. The
    // narrator is outside it, and so is the voice that reads the option
    // numbers — a number is the exam speaking, not anybody in the room.
    const outside = clips.filter((c) => ["narration", "option_label"].includes(c.kind));
    expect(outside.length).toBe(5);
    expect(outside.every((c) => c.channel === "in_person")).toBe(true);
    expect(clips.filter((c) => c.kind === "option").every((c) => c.channel === "phone")).toBe(true);
  });

  test("identical utterances share one clip", () => {
    const it = item();
    const a = tts_plan.planItem(it, "item-a");
    const b = tts_plan.planItem(it, "item-b");
    expect(new Set(a.map((c) => c.clip_id))).toEqual(new Set(b.map((c) => c.clip_id)));
    // The question, the four options, and the four numbers — and the numbers
    // are the same four files for every item in the library, which is the
    // point of hashing a clip id from (voice, channel, text).
    expect(tts_plan.manifest([["item-a", it], ["item-b", it]]).length).toBe(9);
  });

  test("bundle item keeps the listening fields and resolves the answer", () => {
    const it = item();
    it["seed_cell"] = cell().toDict();
    const bi = batch.toBundleItem(it);
    expect(bi["correct_index"]).toBe(0);
    expect(bi["channel"]).toBe("phone");
    expect(bi["scene_id"]).toBe("scene_phone_desk");
    expect(bi["audio"]["options"].length).toBe(4);
  });
});
