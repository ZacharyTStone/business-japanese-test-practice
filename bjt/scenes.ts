/**
 * The scene bank: which pictures the library needs, and which exist.
 *
 * Items name a `scene_id` from a small shared bank rather than a picture of their
 * own (画像把握, whose picture is the question, is the exception; see
 * PICTURE_PREFIX). That is an economic decision before it is an aesthetic one — a
 * thousand items cannot have a thousand commissioned drawings — but it has a
 * quality consequence that matters more: because one picture serves many items,
 * the picture cannot contain the answer. An illustration specific enough to give
 * the situation away would make the listening optional.
 *
 * Which is also why text, names and numbers are never drawn into the artwork. They
 * are overlaid by the app. One drawing serves many items, and nothing is at the
 * mercy of an image model's handwriting.
 *
 * This module does no image generation. It says what is needed, what is present,
 * and writes the SQL that points the database at what has been approved — the same
 * split as `bjt/tts`, and for the same reason: media arrives by review, not by a
 * job deciding it looks fine. The drawing, the review and the upload live in
 * `bjt/scene_art.ts`; the review there applies the brief in `promptFor` below,
 * rule by rule, and a draft that breaks one is rejected outright.
 */
import { existsSync } from "node:fs";
import path from "node:path";
// batch.ts imports this module (for `pictureSceneId`), and this one imports
// batch.ts to read the bundles. The cycle is safe because neither uses the
// other while it is being loaded: `batchmod` is only touched inside functions.
import * as batchmod from "./batch.ts";
import * as config from "./config.ts";
import { unreadable } from "./files.ts";
import * as publish from "./publish.ts";
import { FileNotFoundError, get, KeyError, or, repr, sorted, str, truthy, ValueError } from "./py.ts";
import * as seedtable from "./seedtable.ts";
import * as withdrawn from "./withdrawn.ts";
import type { Item } from "./types.ts";

/** Extensions accepted as artwork, in the order preferred when more than one
 *  exists for a scene. WebP first: these are flat illustrations, they are
 *  downloaded on a phone, and the size difference is not marginal. */
export const IMAGE_EXTENSIONS: readonly string[] = [".webp", ".png", ".jpg", ".jpeg", ".svg"];

export class Scene {
  scene_id: string;
  label_ja: string;
  /** Which item types ask for this scene. A scene wanted by four types earns
   *  its commission before one wanted by a single cell. */
  used_by: readonly string[];
  /** How many seed cells can land on it — the demand for this picture. */
  cell_count: number;
  /** The approved file, relative to the `scenes` bucket. null means the item
   *  ships without a picture, which is allowed for a bank scene and is why a
   *  per-item picture's item is not served until it exists. */
  path: string | null;
  /** Set for a per-item picture (画像把握): the English brief the item was
   *  written with, and the question it must answer visibly. A bank scene has
   *  none of these — it is drawn from SCENE_BRIEFS and must give nothing away. */
  brief: string | null;
  question: string;
  options: readonly string[];
  answer: number | null;

  constructor(init: {
    scene_id: string;
    label_ja: string;
    used_by: readonly string[];
    cell_count: number;
    path?: string | null;
    brief?: string | null;
    question?: string;
    options?: readonly string[];
    answer?: number | null;
  }) {
    this.scene_id = init.scene_id;
    this.label_ja = init.label_ja;
    this.used_by = init.used_by;
    this.cell_count = init.cell_count;
    this.path = init.path !== undefined ? init.path : null;
    this.brief = init.brief !== undefined ? init.brief : null;
    this.question = init.question !== undefined ? init.question : "";
    this.options = init.options !== undefined ? init.options : [];
    this.answer = init.answer !== undefined ? init.answer : null;
  }

  get has_art(): boolean {
    return this.path !== null;
  }

  get is_picture(): boolean {
    return this.brief !== null;
  }
}

export function storagePath(sceneId: string, suffix: string): string {
  return `${str(sceneId)}${str(suffix)}`;
}

/** Per-item pictures are scenes whose id is the item's id under this prefix,
 *  so they use the same table, bucket and SQL as the bank and nothing else in
 *  the app had to learn a second kind of picture. */
export const PICTURE_PREFIX = "pic_";

export function pictureSceneId(itemId: string): string {
  return `${PICTURE_PREFIX}${str(itemId)}`;
}

/** A bank scene with no picture of its own borrows its neighbour's, so an item
 *  shows a related room rather than nothing while the real drawing is pending
 *  (or given up on). The pairs are settings a listener would not tell apart
 *  from the narration: the narration says where you are, the picture only
 *  sets a tone. Never the other way round for the per-item pictures, which ARE
 *  the question. */
export const STAND_INS: Record<string, string> = {
  "scene_phone_mobile_outside": "scene_phone_desk",
  "scene_phone_desk": "scene_office_desk_pair",
  "scene_entrance_lobby": "scene_reception_counter",
  "scene_reception_counter": "scene_entrance_lobby",
  "scene_elevator_hall": "scene_corridor",
  "scene_corridor": "scene_elevator_hall",
  "scene_client_office_sofa": "scene_client_meeting_room",
  "scene_client_meeting_room": "scene_meeting_room_table",
  "scene_meeting_room_table": "scene_client_meeting_room",
  "scene_izakaya_table": "scene_restaurant_private",
  "scene_restaurant_private": "scene_izakaya_table",
  "scene_expo_booth": "scene_seminar_hall",
  "scene_seminar_hall": "scene_meeting_room_table",
  "scene_office_open_floor": "scene_office_desk_pair",
  "scene_office_desk_pair": "scene_office_open_floor",
};

/** The scene whose picture this one may borrow tonight, if any: its named
 *  stand-in when that has art of its own. One hop only, so a chain of
 *  missing pictures never lands on something unrelated. */
export function standInFor(scene: Scene, surveyResult: readonly Scene[]): Scene | null {
  if (scene.has_art || scene.is_picture) {
    return null;
  }
  const other: string | null = get(STAND_INS, scene.scene_id);
  if (other === null) {
    return null;
  }
  const match = surveyResult.find((s) => s.scene_id === other) ?? null;
  return match !== null && match.has_art ? match : null;
}

/**
 * Every scene the committed seed tables can ask for, and whether it exists.
 *
 * Demand is counted across all item types, because the bank is shared: a
 * reception counter used by 場面把握 and 状況把握 and 発言聴解 is one drawing,
 * and the point of the survey is to commission it before a scene that only one
 * cell wants.
 *
 * `remote` is the listing of the storage bucket, when the caller has one. A
 * scene whose file is already in the bucket has art even on a machine with an
 * empty `media/` — the nightly runner, every night — and must not be drawn
 * again. A local file wins over a remote one, because local is what has just
 * been made and is about to be uploaded.
 */
export function survey(opts: { mediaDir?: string | null; remote?: Iterable<string> } = {}): Scene[] {
  const mediaDir = path.join(truthy(opts.mediaDir) ? opts.mediaDir! : config.MEDIA_DIR, "scenes");
  const remote = new Set<string>(opts.remote ?? []);

  const labels: Record<string, string> = {};
  const usedBy = new Map<string, Set<string>>();
  const demand = new Map<string, number>();

  for (const itemType of seedtable.available()) {
    const table = seedtable.load(itemType);
    Object.assign(labels, table.scene_labels);
    for (const cell of table.cells()) {
      for (const sceneId of cell.scenes) {
        if (!usedBy.has(sceneId)) usedBy.set(sceneId, new Set());
        usedBy.get(sceneId)!.add(itemType);
        demand.set(sceneId, (demand.get(sceneId) ?? 0) + 1);
      }
    }
  }

  const existing = (sceneId: string): string | null => {
    for (const ext of IMAGE_EXTENSIONS) {
      if (existsSync(path.join(mediaDir, `${sceneId}${ext}`))) {
        return storagePath(sceneId, ext);
      }
    }
    for (const ext of IMAGE_EXTENSIONS) {
      if (remote.has(storagePath(sceneId, ext))) {
        return storagePath(sceneId, ext);
      }
    }
    return null;
  };

  const scenes: Scene[] = [];
  for (const sceneId of sorted(usedBy.keys())) {
    scenes.push(
      new Scene({
        scene_id: sceneId,
        label_ja: get(labels, sceneId, sceneId),
        used_by: sorted(usedBy.get(sceneId)!),
        cell_count: demand.get(sceneId)!,
        path: existing(sceneId),
      }),
    );
  }
  // Then the per-item pictures the committed bundles ask for. They come
  // after the bank in the commissioning order: a bank picture serves many
  // items, one of these serves one.
  for (const [itemType, item] of pictureItems()) {
    const sceneId: string = item["scene_id"];
    scenes.push(
      new Scene({
        scene_id: sceneId,
        label_ja: or(get(item, "topic", ""), sceneId),
        used_by: [itemType],
        cell_count: 1,
        path: existing(sceneId),
        brief: item["image_brief"],
        question: get(item, "stem", ""),
        options: (get(item, "options", []) as Item[]).map((o) => o["text"]),
        answer: get(item, "correct_index"),
      }),
    );
  }
  // Most-wanted first: this list is a commissioning order.
  return sorted(scenes, { key: (s) => [s.has_art, s.is_picture, -s.cell_count, s.scene_id] });
}

/** Python's `except (OSError, ValueError)` around reading a bundle: what
 *  `files.unreadable` names, a ValueError, or our own FileNotFoundError. */
function _unreadable(e: unknown): boolean {
  return unreadable(e) || e instanceof ValueError || e instanceof FileNotFoundError;
}

/**
 * Every committed item that carries its own picture brief, with its type.
 *
 * Read from the bundles rather than the seed tables, because a per-item
 * picture is decided by the item (the generator writes the brief with the
 * options) and not by the setting. A withdrawn item is left out: nobody will
 * see its picture, so nobody should pay for one.
 */
export function pictureItems(): [string, Item][] {
  const out: [string, Item][] = [];
  const gone = withdrawn.ids();
  for (const p of batchmod.bundles()) {
    let bundle: Record<string, any>;
    try {
      bundle = batchmod.load(p);
    } catch (e) {
      if (_unreadable(e)) continue;
      throw e;
    }
    for (const item of withdrawn.liveItems(bundle, { withdrawn: gone })) {
      if (truthy(get(item, "image_brief")) && str(get(item, "scene_id", "")).startsWith(PICTURE_PREFIX)) {
        out.push([get(bundle, "item_type", ""), item]);
      }
    }
  }
  return out;
}

/** The style every scene shares. One sentence, so that sixteen pictures drawn
 *  on sixteen different nights still look like one bank. */
export const STYLE = "A clean editorial illustration of a Japanese workplace, flat colour, consistent " +
  "line weight across the whole bank, neutral professional clothing, landscape 3:2.";

/** What each scene is, in the words an image model draws from. The seed
 *  tables carry only a Japanese label, and a generic gloss ("a Japanese office
 *  setting") draws the restaurant's private room as a meeting room and the
 *  outdoor phone call indoors. So the place is stated here, once per scene,
 *  with the channel the picture must show.
 *  Channel: in_person — the speaker is in the room with the viewer;
 *  phone — the speaker is on a call, the viewer is the other end of the line;
 *  video — the speaker is on the viewer's screen. */
export const SCENE_BRIEFS: Record<string, readonly [string, string]> = {
  "scene_phone_desk": ["at their own desk in a Japanese office, on the desk telephone " +
                       "(a handset, cord to a desk phone), other desks behind", "phone"],
  "scene_phone_mobile_outside": ["outdoors on a city street or a station concourse in " +
                                 "Japan, daytime, on a mobile phone; buildings or a " +
                                 "platform behind, no office interior", "phone"],
  "scene_meeting_room_table": ["a meeting room in a Japanese office, across the table, " +
                               "whiteboard blank, glass wall to the corridor", "in_person"],
  "scene_office_desk_pair": ["two desks facing each other on an open office floor in " +
                             "Japan; the speaker has turned from their desk toward the " +
                             "viewer's", "in_person"],
  "scene_video_call_laptop": ["seen on a laptop screen in a video call, head and " +
                              "shoulders in a small home-office or meeting-room " +
                              "background, as the viewer's screen shows them", "video"],
  "scene_corridor": ["a corridor in a Japanese office building, stopped for a word, " +
                     "doors and a window along the wall", "in_person"],
  "scene_seminar_hall": ["a seminar hall with rows of chairs and a lectern, the " +
                         "speaker at the front or in the aisle", "in_person"],
  "scene_office_open_floor": ["an open-plan office floor in Japan, standing between the " +
                              "desks, colleagues working further back", "in_person"],
  "scene_izakaya_table": ["a table at a Japanese izakaya after work: wooden interior, " +
                          "lanterns, small dishes and glasses on the table, no readable " +
                          "menu", "in_person"],
  "scene_restaurant_private": ["a private room (個室) in a Japanese restaurant: tatami " +
                               "or a low table, closed sliding doors, no other diners " +
                               "visible at all — only the people at this table",
                               "in_person"],
  "scene_elevator_hall": ["an elevator hall in an office building, elevator doors and " +
                          "a call button, waiting for the lift", "in_person"],
  "scene_client_meeting_room": ["a meeting room at a client company, across the table, " +
                                "business cards and a glass of water on the table",
                                "in_person"],
  "scene_expo_booth": ["a trade-show booth in an exhibition hall, a counter with " +
                       "brochures (blank), banners without text, visitors in the " +
                       "distance", "in_person"],
  "scene_entrance_lobby": ["the entrance lobby of a Japanese office building: high " +
                           "ceiling, security gates, a reception counter further back",
                           "in_person"],
  "scene_reception_counter": ["the reception counter of the viewer's own company, the " +
                              "speaker standing at the counter", "in_person"],
  "scene_client_office_sofa": ["a reception room at a client company: sofas and a low " +
                               "table, tea served, the speaker seated opposite",
                               "in_person"],
};

/** The English setting and the channel, or a safe generic for a scene the
 *  table does not know yet (a new seed table lands before its brief does). */
export function briefFor(sceneId: string): readonly [string, string] {
  return get(SCENE_BRIEFS, sceneId, ["a Japanese business setting", "in_person"]);
}

/** Who is in the picture. Every item that uses a scene is somebody speaking
 *  to the learner: in 発言聴解 the learner chooses the reply, so the learner is
 *  the one spoken to and is never in the picture — the viewer is the camera.
 *  The speaker is the one principal figure, addressing the viewer. On the
 *  phone the other end of the line is the viewer, so the speaker is alone;
 *  on a video call the speaker is on the viewer's screen. Anyone else is
 *  scenery: a crowd of equals, or a listener drawn beside the speaker, leaves
 *  it unclear who is speaking. What is being said stays invisible — this is
 *  who, not what. */
export const COMPOSITION: Record<string, string> = {
  "in_person": (
    "Composition: one principal figure — the person speaking — in the " +
    "foreground, turned toward the viewer and addressing them, mid-sentence, " +
    "with an open, addressing posture. The viewer is the person being spoken " +
    "to and is NOT drawn: no second figure faces the speaker, no listener in " +
    "the frame. If the setting needs other people, they are small, further " +
    "back, muted, and plainly not part of the conversation. The speaker's " +
    "expression and gesture are neutral and give nothing away about what is " +
    "being said."
  ),
  "phone": (
    "Composition: one principal figure — the person speaking — on the phone, " +
    "mid-call, in the foreground. The person they are talking to is the viewer, " +
    "on the other end of the line, so nobody in the picture is being addressed: " +
    "no listener beside them, no second principal figure. Others, if the " +
    "setting needs them, are small, distant and uninvolved. Expression and " +
    "gesture neutral; nothing about what is being said."
  ),
  "video": (
    "Composition: one principal figure — the person speaking — as they appear " +
    "in a video-call window on the viewer's screen: head and shoulders, facing " +
    "the camera and addressing it. The viewer is the other participant and is " +
    "not drawn. No readable interface, no text, no second person on screen. " +
    "Expression neutral; nothing about what is being said."
  ),
};

/** `d[key]`: a KeyError when the key is absent, as Python's subscript
 *  raises. */
function _at<T>(d: Record<string, T>, key: string): T {
  if (!Object.prototype.hasOwnProperty.call(d, key)) {
    throw new KeyError(repr(key));
  }
  return d[key];
}

export function compositionFor(sceneId: string): string {
  return _at(COMPOSITION, briefFor(sceneId)[1]);
}

/** What a draft may not contain. Each clause is here because its absence
 *  produces an unusable image: readable text ruins reuse and gets the kanji
 *  wrong, a recognisable face makes the picture a person, and a scene that
 *  gives the scenario away makes the listening optional. The reviewer in
 *  `scene_art` checks these same clauses, one flag each. */
export const FORBIDDEN: readonly string[] = [
  "any readable text, signage, logo, brand mark, chart or user interface " +
  "(labels are overlaid by the app, so drawn text makes the picture single-use " +
  "and gets the kanji wrong)",
  "a recognisable likeness of any real person",
  "anything that fixes the situation more tightly than the setting does — this " +
  "picture is shared by many items, and an illustration that gives the scenario " +
  "away makes the listening optional",
  "malformed hands, extra limbs, or more people than the setting calls for",
  "a second principal figure — a listener or partner drawn as prominently as " +
  "the speaker, or a crowd of equals — so that it is not clear who is speaking " +
  "to the viewer (the viewer is the one spoken to and is never in the picture)",
];

/** What a per-item picture may not contain. Shorter than the bank's list on
 *  purpose: this picture is the question, so "gives the scenario away" and
 *  "a second principal figure" are not faults here — they are the point. */
export const PICTURE_FORBIDDEN: readonly string[] = [
  "any readable text, signage, logo, brand mark, chart or user interface " +
  "(the app overlays nothing on these, but drawn text gets the kanji wrong and " +
  "a sign would answer the question for the listener)",
  "a recognisable likeness of any real person",
  "malformed hands, extra limbs, or more people than the brief calls for",
  "anything the brief does not describe that a viewer could take for the " +
  "action being asked about — one clear thing is happening, and nothing " +
  "else in the picture competes with it",
];

/** The brief for one scene, as a contract rather than a wish. */
export function promptFor(scene: Scene): string {
  if (scene.is_picture) {
    return picturePromptFor(scene);
  }
  return [
    `scene_id: ${str(scene.scene_id)}`,
    `設定: ${str(scene.label_ja)}`,
    `使用する問題タイプ: ${scene.used_by.join("、")}`,
    "",
    STYLE,
    "",
    `The place: ${briefFor(scene.scene_id)[0]}.`,
    "",
    compositionFor(scene.scene_id),
    "",
    "Must NOT contain:",
    ...FORBIDDEN.map((clause) => `  - ${clause};`),
  ].join("\n");
}

/** The brief for a per-item picture, for the reviewer: what it must show,
 *  and the four descriptions it must separate. */
export function picturePromptFor(scene: Scene): string {
  const numbered = scene.options.map((o, i) => `  ${i}. ${str(o)}`).join("\n");
  return [
    `scene_id: ${str(scene.scene_id)}  (a picture drawn for one 画像把握 item)`,
    `題材: ${str(scene.label_ja)}`,
    "",
    STYLE,
    "",
    "What the picture must show, unmistakably, so that exactly one of the " +
    "descriptions below is true of it and the other three are visibly false:",
    or(scene.brief, ""),
    "",
    `The question the learner hears: ${str(scene.question)}`,
    "The four descriptions (the correct one is marked):",
    scene.answer !== null
      ? numbered.replaceAll(`  ${str(scene.answer)}. `, `  ${str(scene.answer)}. ✔ `)
      : numbered,
    "",
    "Must NOT contain:",
    ...PICTURE_FORBIDDEN.map((clause) => `  - ${clause};`),
  ].join("\n");
}

/**
 * The same brief, addressed to an image model rather than a person.
 *
 * The setting is stated first and positively, because that is what an image
 * model draws; the prohibitions follow in the same words the reviewer uses,
 * so a draft is judged by the rule it was given.
 */
export function imagePrompt(scene: Scene): string {
  if (scene.is_picture) {
    return [
      `${STYLE} This picture is a test question: it must show one clear, ` +
      "specific moment at work, readable at a glance, and nothing generic.",
      "",
      `Show exactly this: ${str(scene.brief)}`,
      "",
      "The people are in ordinary Japanese office clothing, drawn clearly, with " +
      "their action and posture unmistakable; the setting is recognisable and " +
      "uncluttered. Everything in the frame supports the one action described.",
      "",
      "The image must not contain:",
      ...PICTURE_FORBIDDEN.map((clause) => `- ${clause}.`),
      "",
      "No words or letters anywhere in the picture, in any language. Signs, " +
      "screens, papers and whiteboards are blank.",
    ].join("\n");
  }
  return [
    `${STYLE} The setting: ${str(scene.label_ja)} — ${briefFor(scene.scene_id)[0]}. ` +
    "Show that place, unmistakably, mid-moment, with nothing that says what " +
    "is being said.",
    "",
    compositionFor(scene.scene_id),
    "",
    "The image must not contain:",
    ...FORBIDDEN.map((clause) => `- ${clause}.`),
    "",
    "No words or letters anywhere in the picture, in any language. Signs, " +
    "screens, papers and whiteboards are blank.",
  ].join("\n");
}

/**
 * Point the database at the approved artwork.
 *
 * Only scenes that have a file. A scene with no art is left exactly as it is —
 * `image_path` stays null, the app draws the item without a picture, and
 * nothing about that is an error.
 */
export function toSql(scenes: readonly Scene[]): string {
  const withArt = scenes.filter((s) => s.has_art);
  const standIns: [Scene, Scene | null][] = scenes.map((s) => [s, standInFor(s, scenes)]);
  const borrowed = standIns.filter((pair): pair is [Scene, Scene] => pair[1] !== null);
  if (withArt.length === 0) {
    return (
      "-- No approved scene artwork found. Nothing to apply.\n" +
      "-- Put files in media/scenes/<scene_id>.webp and re-run bjt scenes.\n"
    );
  }

  const rows: [string, string, string | null][] = withArt.map((s) => [s.scene_id, s.label_ja, s.path]);
  // A scene without a picture of its own shows its stand-in's until its own
  // is drawn; the upsert overwrites the borrowed path the night that happens.
  rows.push(...borrowed.map(([s, other]): [string, string, string | null] => [s.scene_id, s.label_ja, other.path]));
  const upserts = sorted(rows).map(([sid, label, p]) =>
    "insert into scenes (id, label_ja, image_path) values " +
    `(${publish.lit(sid)}, ${publish.lit(label)}, ${publish.lit(p)}) ` +
    "on conflict (id) do update set label_ja = excluded.label_ja, " +
    "image_path = excluded.image_path;",
  );
  const notes = [`-- Artwork for ${withArt.length} scene(s).`];
  for (const [s, other] of sorted(borrowed, { key: (pair) => pair[0].scene_id })) {
    notes.push(`-- ${publish.comment(s.scene_id)} has no picture of its own and borrows the ` +
               `picture of ${publish.comment(other.scene_id)} until it does.`);
  }
  return [
    ...notes,
    "-- Produced by bjt scenes --sql. Idempotent: re-running sets the same values.",
    "-- For D1: wrangler d1 execute applies the file all or nothing.",
    "",
    ...upserts,
    "",
  ].join("\n");
}
