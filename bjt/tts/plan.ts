/**
 * TTS planning — what to synthesise, in which voice, over which channel.
 *
 * No audio is generated here and nothing is called. This module turns a gated item
 * into a manifest of clips; a separate offline step feeds that manifest to a TTS
 * provider and drops the files somewhere the app can fetch them. Splitting it this
 * way is what keeps the running cost at zero: synthesis happens once, per clip,
 * only for items that already passed every gate, and never at practice time.
 *
 * Two decisions are encoded here.
 *
 * **Voices are cast by role, not per item.** A learner who hears a different voice
 * for every question is doing speaker identification instead of 敬語. The seed
 * cell's 関係 decides who is speaking, so the voice follows from the relation and
 * stays the same across the whole library.
 *
 * **Clip ids are content hashes.** 「かしこまりました。」 occurs in dozens of items;
 * hashing (voice, channel, text) means it is synthesised once and cached forever,
 * and re-running a batch re-uses every clip whose text did not change.
 */
import { createHash } from "node:crypto";
import { get, getitem, has, or, str, truthy, utf8 } from "../py.ts";
import type { Item } from "../types.ts";

/** The narrator who reads the situation. Always the same, always neutral — the
 *  narration is not part of what is being tested. */
export const NARRATOR_VOICE = "narrator_f";

/** The four option numbers, spoken. The screen shows nothing but 1 / 2 / 3 / 4
 *  while a listening item's options play, so without these the learner hears
 *  four candidates with nothing tying any of them to a button — which is a
 *  memory test rather than a listening one. The exam reads its numbers aloud
 *  for the same reason.
 *
 *  Kana rather than "1", so the reading is 「いち」 and does not depend on a
 *  provider guessing which language a bare digit is in, and 「よん」 rather than
 *  「し」, which is the reading a list of choices uses. The narrator speaks them
 *  whoever is speaking in the item, because a number belongs to the exam rather
 *  than to anybody in the scene — which, with the content-hashed clip id, is
 *  what makes these four files for the whole library rather than four per item.
 *
 *  **Numbers, not letters.** Spoken English letters differ only in their onset:
 *  「ビー」 and 「ディー」 are misheard for each other, and 「デー」 sounds like
 *  "day" rather than the letter. いち / に / さん / よん share no sound with each
 *  other, and they are what the exam's answer sheet prints.
 *
 *  The app names the same four strings (`OPTION_LABELS` in client/src/lib/db.ts),
 *  which is how it finds the clips; a test holds the two equal. */
export const OPTION_LABELS = ["いち", "に", "さん", "よん"] as const;

/** Relation → the voice of the person doing the speaking (the left side of the
 *  関係 arrow). Fixed for the life of the library.
 *
 *  A new relation borrows a voice from the cast rather than bringing its own:
 *  the seven roles are the cast (`providers.VOICE_IDS`), a live clip is never
 *  re-made, and a new voice would be one more the learner has to tell apart.
 *  `uchi_to_soto` — talking to an outsider about one's own boss — is the same
 *  staff member facing the same outsider as `staff_to_client`, so it is that
 *  voice. */
export const RELATION_VOICES: Record<string, string> = {
  subordinate_to_superior: "staff_junior_m",
  junior_to_senior: "staff_junior_f",
  superior_to_subordinate: "manager_m",
  peer_to_peer: "staff_mid_f",
  other_department: "staff_mid_m",
  staff_to_client: "staff_mid_m",
  staff_to_visitor: "reception_f",
  staff_to_customer: "staff_mid_f",
  uchi_to_soto: "staff_mid_m",
};
export const _FALLBACK_VOICE = "staff_mid_m";

/** How one channel's clips are post-processed (bjt/tts/channel.ts). */
export type ChannelProfile = {
  sample_rate: number;
  band: [number, number] | null;
  note: string;
};

/** Channel → how the clip is post-processed. The phone profile is deliberately
 *  degraded: business phone Japanese is harder to hear than studio audio, and an
 *  item about a phone call that sounds like a studio recording is easier than the
 *  real thing. */
export const CHANNEL_PROFILES: Record<string, ChannelProfile> = {
  in_person: { sample_rate: 24000, band: null, note: "clean room tone" },
  phone: {
    sample_rate: 8000,
    band: [300, 3400],
    note: "band-limited to a telephone line",
  },
  video: {
    sample_rate: 16000,
    band: [120, 7000],
    note: "slight compression, as an online meeting",
  },
};

/** What one item type speaks (see TYPE_AUDIO). */
export type AudioPolicy = {
  stem: boolean;
  options: boolean;
  dialogue: boolean;
  options_by_narrator?: boolean;
};

/** What is spoken, per item type.
 *
 *  This is the axis that actually differs between the nine types, and getting it
 *  wrong is expensive in both directions: synthesising a document would be
 *  nonsense and would also hand the learner the reading half for free, while
 *  failing to synthesise a dialogue leaves an integrated listening item with
 *  nothing to listen to.
 *
 *  `stem` — the narrator reads the situation or the question.
 *  `options` — the four options are spoken rather than printed. **Every type in
 *    第1部 聴解 does this**: the exam shows the picture and the bare numerals 1–4
 *    and reads the four candidates aloud （「…質問のあと、４つの選択肢を読み上げ
 *    ます」), and in 総合聴解 there is nothing on the screen at all. Printing them
 *    turns a listening item into a reading item with a soundtrack, which is the
 *    single biggest way a practice app drifts from this exam. The 聴読解 and 読解
 *    types print theirs, as the exam does — there, speaking them would turn a
 *    reading choice into a memory test.
 *  `options_by_narrator` — the options are read by the narrator rather than in
 *    the voice of the person speaking. True wherever the options are statements
 *    about a situation rather than utterances somebody makes: only 発言聴解 has
 *    the learner choosing what to *say*.
 *  `dialogue` — the multi-speaker exchange is played. */
export const TYPE_AUDIO: Record<string, AudioPolicy> = {
  // The four candidate readings of the moment, read by the narrator: nobody in
  // the scene is saying them.
  bamen_haaku:        { stem: true,  options: true,  dialogue: false,
                        options_by_narrator: true },
  // The four descriptions of the picture are read by the narrator, as on the
  // exam: nobody in the picture is speaking them. One voice across every
  // item of the type is also what lets a description recur as one clip.
  gazou_haaku:        { stem: true,  options: true,  dialogue: false,
                        options_by_narrator: true },
  hatsugen_choukai:   { stem: true,  options: true,  dialogue: false },
  // Nothing is on screen for this one on the exam — conversation, question and
  // all four answers exist only as audio — so the options are narrated too.
  sougou_choukai:     { stem: true,  options: true,  dialogue: true,
                        options_by_narrator: true },
  joukyou_haaku:      { stem: true,  options: false, dialogue: false },
  shiryou_choudokkai: { stem: true,  options: false, dialogue: false },
  sougou_choudokkai:  { stem: true,  options: false, dialogue: true },
  goi_bunpou:         { stem: false, options: false, dialogue: false },
  hyougen:            { stem: false, options: false, dialogue: false },
  sougou_dokkai:      { stem: false, options: false, dialogue: false },
};

/** Fallback for a type not yet in the table: narrate the stem and nothing else.
 *  Silent would be worse — a listening item with no audio at all is a bug that
 *  looks like a missing file. */
export const _DEFAULT_AUDIO: AudioPolicy = { stem: true, options: false, dialogue: false };

/** Voices for the extra speakers a dialogue needs. A conversation cast from
 *  RELATION_VOICES alone would put every turn in one voice, since the relation
 *  is a property of the item rather than of the turn. These are assigned in
 *  order of first appearance and stay stable for the life of an item, because
 *  the clip id hashes the voice: re-running a batch must not re-cast it. */
export const DIALOGUE_VOICES = ["manager_m", "staff_junior_m", "staff_mid_f", "staff_mid_m", "reception_f"];

export function audioPolicy(itemType: string): AudioPolicy {
  return typeof itemType === "string" && has(TYPE_AUDIO, itemType) ? TYPE_AUDIO[itemType] : _DEFAULT_AUDIO;
}

/** One clip as the bundle's `audio_manifest` carries it. */
export type ClipDict = {
  clip_id: string;
  item_id: string;
  kind: string;
  index: number | null;
  text: string;
  voice: string;
  channel: string;
};

export class Clip {
  clip_id: string;
  item_id: string;
  kind: string; // "narration" | "dialogue" | "option_label" | "option"
  index: number | null; // option or turn position, null for narration
  text: string;
  voice: string;
  channel: string;

  constructor(init: ClipDict) {
    this.clip_id = init.clip_id;
    this.item_id = init.item_id;
    this.kind = init.kind;
    this.index = init.index;
    this.text = init.text;
    this.voice = init.voice;
    this.channel = init.channel;
  }

  toDict(): ClipDict {
    return {
      clip_id: this.clip_id,
      item_id: this.item_id,
      kind: this.kind,
      index: this.index,
      text: this.text,
      voice: this.voice,
      channel: this.channel,
    };
  }
}

export function voiceFor(item: Item): string {
  const relation = get(or(get(item, "seed_cell"), {}), "relation", "");
  return typeof relation === "string" && has(RELATION_VOICES, relation) ? RELATION_VOICES[relation] : _FALLBACK_VOICE;
}

/** Content-addressed, so identical utterances share one audio file. */
export function clipId(voice: string, channel: string, text: string): string {
  const h = createHash("sha1").update(utf8(`${str(voice)}|${str(channel)}|${str(text)}`)).digest("hex");
  return h.slice(0, 16);
}

/** speaker_role → voice, assigned in order of first appearance.
 *
 *  Stable by construction: the same dialogue always produces the same casting,
 *  so re-running a batch re-uses every clip instead of re-synthesising the lot
 *  under new voices. (A Map, as the Python dict: a role is looked up as it is,
 *  whatever it is.) */
export function _dialogueCasting(turns: Item[]): Map<unknown, string> {
  const casting = new Map<unknown, string>();
  for (const turn of turns) {
    const role = get(turn, "speaker_role");
    if (truthy(role) && !casting.has(role)) {
      casting.set(role, DIALOGUE_VOICES[casting.size % DIALOGUE_VOICES.length]);
    }
  }
  return casting;
}

/** Every clip one item needs, according to its type's audio policy.
 *
 *  The narration is always in-person regardless of the item's channel — the
 *  narrator is outside the scene. Only what happens *inside* the scene (the
 *  utterances, the dialogue turns) gets the phone or video treatment.
 *
 *  A type whose policy speaks nothing returns no clips at all. That is the
 *  right answer for 総合読解: it is a reading item, and an empty plan is how
 *  the pipeline says so. */
export function planItem(item: Item, itemId: string): Clip[] {
  const policy = audioPolicy(get(item, "item_type", ""));
  let channel = get(item, "channel", "in_person");
  if (!(typeof channel === "string" && has(CHANNEL_PROFILES, channel))) {
    // `written` reaches here for a type that nonetheless narrates something.
    // The narration is still spoken aloud by a person, so it gets the
    // ordinary in-person treatment rather than no treatment at all.
    channel = "in_person";
  }
  let voice = voiceFor(item);
  const clips: Clip[] = [];

  if (policy.stem && truthy(get(item, "stem"))) {
    clips.push(
      new Clip({
        clip_id: clipId(NARRATOR_VOICE, "in_person", getitem(item, "stem")),
        item_id: itemId,
        kind: "narration",
        index: null,
        text: getitem(item, "stem"),
        voice: NARRATOR_VOICE,
        channel: "in_person",
      }),
    );
  }

  if (policy.dialogue) {
    const turns: Item[] = or(get(item, "dialogue"), []);
    const casting = _dialogueCasting(turns);
    turns.forEach((turn, i) => {
      const role = get(turn, "speaker_role", "");
      const turnVoice = casting.has(role) ? casting.get(role)! : _FALLBACK_VOICE;
      clips.push(
        new Clip({
          clip_id: clipId(turnVoice, channel, getitem(turn, "text")),
          item_id: itemId,
          kind: "dialogue",
          index: i,
          text: getitem(turn, "text"),
          voice: turnVoice,
          channel,
        }),
      );
    });
  }

  if (policy.options) {
    if (truthy(get(policy, "options_by_narrator"))) {
      [voice, channel] = [NARRATOR_VOICE, "in_person"];
    }
    const options: Item[] = getitem(item, "options");
    options.forEach((opt, i) => {
      // The number first, in the narrator's voice and off the phone line
      // whatever the item's channel is: it is said by the exam, not from
      // inside the scene. An item with more options than there are
      // numbers gets none for the extras rather than a wrong one — the
      // app plays a number only where there is one for every option.
      if (i < OPTION_LABELS.length) {
        clips.push(
          new Clip({
            clip_id: clipId(NARRATOR_VOICE, "in_person", OPTION_LABELS[i]),
            item_id: itemId,
            kind: "option_label",
            index: i,
            text: OPTION_LABELS[i],
            voice: NARRATOR_VOICE,
            channel: "in_person",
          }),
        );
      }
      clips.push(
        new Clip({
          clip_id: clipId(voice, channel, getitem(opt, "text")),
          item_id: itemId,
          kind: "option",
          index: i,
          text: getitem(opt, "text"),
          voice,
          channel,
        }),
      );
    });
  }
  return clips;
}

/** One de-duplicated clip list for a whole bundle. */
export function manifest(itemsWithIds: [string, Item][]): ClipDict[] {
  const seen = new Set<string>();
  const out: ClipDict[] = [];
  for (const [itemId, item] of itemsWithIds) {
    for (const clip of planItem(item, itemId)) {
      if (seen.has(clip.clip_id)) {
        continue;
      }
      seen.add(clip.clip_id);
      out.push(clip.toDict());
    }
  }
  return out;
}
