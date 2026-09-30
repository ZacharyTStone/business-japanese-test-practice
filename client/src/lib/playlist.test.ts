/**
 * What an item plays: the order, and the all-four-or-none rule for options.
 */
import { describe, expect, it } from "vitest";

import { playlistFor, SPOKEN_OPTION_TYPES, spokenOptionUrls } from "./playlist";
import type { QueuedItem } from "./types";

/** Storage paths become URLs by a rule the test can read back. */
const clipUrl = (path: string | null) => (path ? `https://clips/${path}` : null);

function item(overrides: Partial<QueuedItem> = {}, optionPaths: (string | null)[] = ["o0", "o1", "o2", "o3"]): QueuedItem {
  return {
    id: "q1",
    item_type: "hatsugen_choukai",
    level: "J2",
    topic: "q1",
    stem: "何と言いますか。",
    scene_id: null,
    scene_image_path: null,
    speaker_role: null,
    listener_role: null,
    channel: null,
    seed_cell_id: null,
    correct_index: 0,
    explanation_ja: "",
    explanation_en: "",
    vocab_notes: [],
    documents: [],
    dialogue: [],
    narration_clip_id: null,
    narration_path: "stem",
    // Out of order on purpose: the screen sorts by position, and so must this.
    options: [3, 1, 0, 2].map((position) => ({
      position,
      text: `選択肢${position}`,
      role: position === 0 ? "correct" : "register_too_casual",
      why: "",
      clip_id: null,
      audio_path: optionPaths[position],
    })),
    times_seen: 0,
    stands_for: null,
    lesson_trap: null,
    ...overrides,
  };
}

const LABELS = ["いち.mp3", "に.mp3", "さん.mp3", "よん.mp3"];

describe("spoken options", () => {
  it("are the four clips in 1-4 order, for a type that speaks its options", () => {
    expect(spokenOptionUrls(item(), clipUrl)).toEqual([
      "https://clips/o0",
      "https://clips/o1",
      "https://clips/o2",
      "https://clips/o3",
    ]);
  });

  it("are all four or none: three clips print all four options", () => {
    expect(spokenOptionUrls(item({}, ["o0", "o1", null, "o3"]), clipUrl)).toBeNull();
  });

  it("are none for a type that prints its options, whatever clips it has", () => {
    expect(SPOKEN_OPTION_TYPES.has("sougou_dokkai")).toBe(false);
    expect(spokenOptionUrls(item({ item_type: "sougou_dokkai" }), clipUrl)).toBeNull();
  });
});

describe("the playlist", () => {
  it("plays the conversation, then the question, then each option behind its number", () => {
    const it2 = item({
      dialogue: [
        { speaker_role: "a", text: "一", clip_id: null, audio_path: "t0" },
        { speaker_role: "b", text: "二", clip_id: null, audio_path: "t1" },
      ],
    });
    expect(playlistFor(it2, LABELS, clipUrl)).toEqual([
      "https://clips/t0",
      "https://clips/t1",
      "https://clips/stem",
      "いち.mp3",
      "https://clips/o0",
      "に.mp3",
      "https://clips/o1",
      "さん.mp3",
      "https://clips/o2",
      "よん.mp3",
      "https://clips/o3",
    ]);
  });

  it("plays the options unnumbered until the numbers exist", () => {
    expect(playlistFor(item(), null, clipUrl)).toEqual([
      "https://clips/stem",
      "https://clips/o0",
      "https://clips/o1",
      "https://clips/o2",
      "https://clips/o3",
    ]);
  });

  it("steps over a turn with no clip rather than waiting for it", () => {
    const partial = item({
      dialogue: [
        { speaker_role: "a", text: "一", clip_id: null, audio_path: null },
        { speaker_role: "b", text: "二", clip_id: null, audio_path: "t1" },
      ],
      narration_path: null,
    });
    expect(playlistFor(partial, LABELS, clipUrl).slice(0, 2)).toEqual(["https://clips/t1", "いち.mp3"]);
  });

  it("is empty for an item with nothing synthesised: it is read instead", () => {
    const silent = item({ narration_path: null }, [null, null, null, null]);
    expect(playlistFor(silent, LABELS, clipUrl)).toEqual([]);
  });

  it("gives no numbers to options that are printed", () => {
    expect(playlistFor(item({ item_type: "sougou_dokkai" }), LABELS, clipUrl)).toEqual(["https://clips/stem"]);
  });
});
