/**
 * Japanese nobody says, caught without a model — and the prompt that asks for
 * the other kind.
 *
 * The gates catch an item that is ambiguous, leaky or mis-keyed. They do not
 * catch one that is unnatural: a line a native speaker would never produce, in an
 * item that is otherwise answerable, un-leaky and correctly keyed. The commonest
 * single cause is the over-polite distractor. Asked for an option that is wrong
 * "by being too polite", a model does not reach for the wording a real person
 * over-uses — it invents a stack nobody says
 * (「お借りさせていただかせていただいてもよろしいでしょうか」), and a learner who
 * hears one learns only that the silly option is the wrong one.
 *
 * Two halves, for the two places an item can be stopped:
 *
 * * `PROMPT` is told to every generator, so the draft is written right.
 * * `faults()` is the mechanical part of the same rules. It needs no key and no
 *   model, so it runs on every draft inside `Generator.generate` (a draft that
 *   trips it is sent back with the reason) and on every committed bundle inside
 *   `batch.checkBundle` (a bundle that trips it fails, in CI as in a night). It
 *   catches only what a pattern can see and says nothing about the rest, which is
 *   the proofreader's job (`sanity.RULES`, `unnatural_japanese`).
 *
 * Nothing here second-guesses a deliberate non-word. 語彙・文法 has a distractor
 * role, `nonexistent_form`, whose whole job is to be morphologically plausible and
 * not a word; those options are exempt from the keigo patterns.
 */
import { get, KeyError, len, or, truthy, ValueError, WS } from "../py.ts";
import * as schemas from "../schemas.ts";
import * as document from "../render/document.ts";
import * as tts_plan from "../tts/plan.ts";
import type { Item } from "../types.ts";

/** Keigo no speaker produces. Every pattern here is taken from a real
 *  over-polite distractor: させていただく stacked on itself, できかねる given a
 *  させていただく, 申す given one, and the humble いただく made honorific. Real
 *  over-politeness sounds like 「おっしゃられる」 or 「お召し上がりになられる」 — one
 *  common 二重敬語 — and none of these patterns touches it. */
export const INVENTED_KEIGO = new RegExp(
  "いただかせていただ"   // お借りさせていただかせていただく
  + "|させていただかせ"    // the same stack, caught from its other end
  + "|かねさせていただ"    // できかねさせていただきます
  + "|申させていただ"      // 申させていただきます
  + "|いただかれ",         // お時間をいただかれまして
  "u",
);

/** A written placeholder where a name belongs. Read aloud, 〇〇商事 is
 *  「まるまるしょうじ」, and printed it is a template nobody filled in. */
export const PLACEHOLDER = /[〇○◯×✕△□]{2,}/u;

/** Written-only devices in something that is heard. The narrator either reads
 *  「先輩（営業部）」 as two unconnected nouns or skips the half in brackets. */
export const WRITTEN_ONLY = /[（）()［］[\]]/u;

/** The set phrases of written apologies and formal letters. One of them, said
 *  aloud in a place too ordinary for it, is the over-polite distractor real
 *  people produce. Three in one spoken line is a parody nobody says
 *  (「誠に恐縮至極ではございますが、僭越ながら…伏してお願い申し上げる次第でございます」),
 *  which is what the three withdrawn for it had. */
export const CEREMONIAL = /恐縮至極|伏して|慙愧|拝察|不徳の致すところ|次第でございます|ゆえ[、。に]|失態を演じ|幸甚|僭越ながら|汗顔|万死/gu;
export const CEREMONIAL_STACK = 3;

/** Words that live only on paper. 貴殿 is a letter's "you"; said to a colleague
 *  in a corridor it is not over-politeness anyone produces. (貴社 for 御社 is a
 *  slip people really make aloud, so it is not here.) */
export const PAPER_ONLY_WORD = /貴殿/u;

/** An honorific on a thing. 宅配便がお見えになる is not a mistake anybody makes:
 *  honorifics go on people. */
export const HONORIFIC_ON_THING = /(?:宅配便?|荷物|郵便物?|小包|書類|資料|メール|ファックス|FAX)が(?:お見えにな|いらっしゃ|おいでにな|お越しにな)/u;

/** A phrase that cancels itself: the predecessor's successor is the speaker. */
export const SELF_CANCELLING = /前任の後任|後任の前任/u;

/** 役不足 said of oneself. It means the part is too small for the person, so
 *  「私では役不足です」 boasts where the speaker meant 力不足. People really make
 *  this slip, so it may stand as a distractor marked as a word used where it
 *  does not fit (`real_form_wrong_context`); anywhere else — the key, the
 *  conversation, an option the 解説 calls merely over-polite — it teaches the
 *  misuse. */
export const SELF_YAKUBUSOKU = /(?:私|わたくし|わたし|僕|自分)(?:では|には|じゃ|に|で)?(?:とても|まだ|少し)?役不足/u;
export const YAKUBUSOKU_AS_WRONG_WORD: ReadonlySet<string> = new Set(["real_form_wrong_context"]);

/** A date's weekday passed on as hearsay. Anyone at a desk can look at a
 *  calendar, so 「十八日が金曜だとかで」 is a figure smuggled into the line, not
 *  something a boss says. (「会議は十八日だそうです」 — an arrangement passed on —
 *  is ordinary, and does not name a weekday.) */
export const CALENDAR_HEARSAY = /[0-9０-９〇一二三四五六七八九十]+日(?:が|は)[月火水木金土日]曜日?(?:だとか|だそう|らしい|とのこと|だって|って聞)/u;

/** Two wordings that are both standard in the same sentence. A distractor that
 *  is the key with one of these swapped is a second right answer, marked wrong
 *  on feel: ご確認くださいますよう is as much the formula as ご確認いただきますよう,
 *  三人 is natural to one's boss beside 三名, and 〜たら fits wherever the key's
 *  〜れば does (not the other way: ば is the narrower). Each pair is [the key's
 *  wording, the distractor's], tried at every place the key has it; a swap that
 *  builds a non-word simply matches no option. 何名様 is a fixed formula, so a
 *  名 before 様 is left alone, as is a ば in 〜ればこそ or 〜れば〜ほど, where たら
 *  does not fit. */
export const STANDARD_TWINS: readonly (readonly [RegExp, string])[] = [
  [/いただきますよう/gu, "くださいますよう"],
  [/くださいますよう/gu, "いただきますよう"],
  [/(?<=[0-9０-９〇一二三四五六七八九十百千何])名(?!様)/gu, "人"],
  [/(?<=[0-9０-９〇一二三四五六七八九十百千何])人(?!様)/gu, "名"],
  [/れば(?!こそ)(?![^。]*ほど)/gu, "たら"],
];

/** The blank in a carrier sentence (語彙・文法). */
export const BLANK = "＿＿＿";

/** 画像把握 asks what one person in the picture is doing (「立っている人は何を
 *  していますか」). An option that opens with somebody else as its subject
 *  (「座っている人が立っている人に書類を渡しています」) does not answer that question,
 *  so the learner rules it out on grammar instead of on the picture. Only a
 *  subject that names a person counts: 「会議が終わって…」 opens a clause, not a
 *  sentence about someone else. */
export const ASKS_ABOUT_PERSON = /^(.+?)は、?何をしていますか/u;
export const OPENS_WITH_PERSON = /^([^、。がをにはで]{1,24}?(?:人|者|客|社員|上司|部下|同僚|先輩|後輩|課長|部長|男性|女性|スタッフ))が/u;
export const ONE_PERSON_TYPES: ReadonlySet<string> = new Set(["gazou_haaku"]);

/** Types whose narration describes the situation and whose options are short
 *  statements about it. For these, the correct option appearing word for word in
 *  the narration means the narration said the answer (「社内の会議室で、…」 before
 *  「ここはどこですか」). The other types quote their answer on purpose — a
 *  conversation states the figure the question asks about — so they are not held
 *  to it. */
export const NARRATION_MUST_NOT_SAY: ReadonlySet<string> = new Set(["bamen_haaku"]);

// `WS` is Python's `\s` (what `str.isspace()` says is whitespace), which is
// wider than JavaScript's, so the two remove the same characters.
export const _PUNCT = new RegExp(`[${WS}。、．，,.!?！？「」『』]`, "gu");

export const PROMPT = (
  "Natural Japanese, every line of it. Everything in the item — the narration, the "
  + "conversation, the document, the correct option AND each distractor — must be "
  + "Japanese a native office worker would actually say or write. A distractor is "
  + "wrong the way real people are wrong, never by being malformed:\n"
  + "- An over-polite distractor is wording people really use, only in a more formal "
  + "situation than this one (a written formula such as ご高配を賜り said aloud; "
  + "お任せいただけませんでしょうか to a peer), or ONE 二重敬語 people really say "
  + "(おっしゃられる, お召し上がりになられる). Never stack させていただく on itself "
  + "（させていただかせていただく）, never 申させていただく, できかねさせていただく or "
  + "いただかれる, and never a parody chain of set phrases (…やに拝察いたしますゆえ, "
  + "伏してお願い申し上げる次第でございます).\n"
  + "- Honorifics go on people. 宅配便がお見えになる is not a mistake anybody makes, so "
  + "it is not a distractor.\n"
  + "- A casual distractor is how a person really talks to a close colleague, not a "
  + "caricature of slang.\n"
  + "- A misused word is not an over-polite option: 私では役不足です for 力不足 is a "
  + "different error, and a distractor must not teach it unremarked.\n"
  + "- Name fictional companies and people (山川商事の佐藤, みどり物産). Never a "
  + "placeholder: 〇〇商事 is read aloud as 「まるまる」, and 「A社の『A』の字」 points at "
  + "a kanji that does not exist.\n"
  + "- Nothing written-only in what is heard: no parentheses in a narration, a spoken "
  + "option or a turn of conversation, and no word only letters use (貴殿). Say "
  + "「営業部の先輩」, not 「先輩（営業部）」.\n"
  + "- The narration never states the answer, and the question is plain, grammatical "
  + "Japanese: 「二人はどこで話していますか」 or 「ここはどこですか」, never a blend of "
  + "the two.\n"
  + "- Every option answers the question as asked, about the person it names.\n"
  + "- A distractor marked wrong must be wrong in THIS sentence, not merely less usual. "
  + "If a native would accept it here — ご確認くださいますよう beside ご確認いただきます"
  + "よう, 〜たら beside 〜れば in minutes, 三人 beside 三名 to one's boss — the item has "
  + "two answers. The 解説 never calls a real expression nonexistent.\n"
  + "- The situation happens in real offices and hangs together: permission is asked of "
  + "a superior, not a peer; a request to another department goes by email or in "
  + "person, not on a posted notice; a date's weekday is a fact anyone can check, never "
  + "hearsay (十八日が金曜だとかで); cause and effect run the right way; and the 解説 "
  + "and every `why` describe the same situation as the stem.\n"
  + "- Every `why` is shown to a learner who picked that option, so its facts are "
  + "right (count the dates: the day after the 25th is the 26th, and a 翌営業日 is "
  + "never a Saturday), and each distractor's role is the mistake a person choosing it "
  + "would really be making — a date is not the wrong person's action, and a word "
  + "every option shares is not a surface match."
);

/** (where, text) for everything `bjt/tts/plan.ts` would synthesise. */
export function _spokenTexts(item: Item): [string, string][] {
  const policy = tts_plan.audioPolicy(get(item, "item_type", ""));
  const out: [string, string][] = [];
  if (truthy(get(policy, "stem")) && truthy(get(item, "stem"))) {
    out.push(["the narration", item["stem"]]);
  }
  if (truthy(get(policy, "options"))) {
    (or(get(item, "options"), []) as Item[]).forEach((o, i) => {
      out.push([`option ${i + 1}`, get(o, "text", "")]);
    });
  }
  if (truthy(get(policy, "dialogue"))) {
    (or(get(item, "dialogue"), []) as Item[]).forEach((t, i) => {
      out.push([`turn ${i + 1} of the conversation`, get(t, "text", "")]);
    });
  }
  return out;
}

/** (where, text, role) for everything a learner reads or hears. `role` is
 *  the option's distractor role, and empty for anything that is not an option. */
export function _allTexts(item: Item): [string, string, string][] {
  const out: [string, string, string][] = [["the stem", get(item, "stem", ""), ""]];
  (or(get(item, "options"), []) as Item[]).forEach((o, i) => {
    out.push([`option ${i + 1}`, get(o, "text", ""), get(o, "role", "")]);
  });
  (or(get(item, "dialogue"), []) as Item[]).forEach((t, i) => {
    out.push([`turn ${i + 1} of the conversation`, get(t, "text", ""), ""]);
  });
  for (const doc of schemas.documentsOf(item)) {
    out.push(["the document", document.textOf(doc), ""]);
  }
  return out;
}

/** (index, text) of every distractor that is the key with one `STANDARD_TWINS`
 *  swap. Compared as the learner reads them: in a carrier sentence the blank
 *  is filled first, so 「ご確認＿＿＿よう」 with いただきます and くださいます is
 *  seen as the two whole formulas. A deliberate non-word is never a twin. */
export function twinsOfKey(item: Item): [number, string][] {
  const options: Item[] = or(get(item, "options"), []);
  let key: number;
  try {
    key = schemas.correctIndex(options);
  } catch (e) {
    if (!(e instanceof ValueError || e instanceof KeyError)) throw e;
    return [];
  }
  const stem: string = get(item, "stem", "");
  const inContext = (text: string): string => (stem.includes(BLANK) ? stem.replace(BLANK, text) : text);
  const keyText = inContext(get(options[key], "text", ""));
  const out: [number, string][] = [];
  options.forEach((o, i) => {
    if (i === key || get(o, "role", "") === "nonexistent_form") return;
    const text = inContext(get(o, "text", ""));
    const isTwin = STANDARD_TWINS.some(([pattern, swap]) =>
      [...keyText.matchAll(pattern)].some((m) =>
        keyText.slice(0, m.index) + swap + keyText.slice(m.index! + m[0].length) === text));
    if (isTwin) out.push([i, get(o, "text", "")]);
  });
  return out;
}

/** Every mechanical tell of unnatural Japanese in one item, each as a
 *  sentence the next draft can act on. Empty means none was found — which is
 *  not the same as natural: most of what makes a line unnatural takes a reader.
 *
 *  Takes an item in generator shape (`batch.asGeneratorShape` converts a
 *  bundle item), because that is what both callers hold. */
export function faults(item: Item): string[] {
  const found: string[] = [];

  for (const [where, text, role] of _allTexts(item)) {
    if (role !== "nonexistent_form") {
      const m = INVENTED_KEIGO.exec(text);
      if (m) {
        found.push(
          `${where} uses keigo no speaker produces (「${m[0]}」); an over-polite `
          + "distractor must be wording people really use in a more formal situation");
      }
    }
    const m = PLACEHOLDER.exec(text);
    if (m) {
      found.push(
        `${where} contains the placeholder 「${m[0]}」; name a fictional company `
        + "or person instead (山川商事, 佐藤)");
    }
    const thing = HONORIFIC_ON_THING.exec(text);
    if (thing) {
      found.push(
        `${where} puts an honorific on a thing (「${thing[0]}」); honorifics go on `
        + "people, so nobody makes this mistake");
    }
    const cancel = SELF_CANCELLING.exec(text);
    if (cancel) {
      found.push(
        `${where} says 「${cancel[0]}」, which cancels itself; say 前任 or 後任 alone`);
    }
    const boast = SELF_YAKUBUSOKU.exec(text);
    if (boast && !YAKUBUSOKU_AS_WRONG_WORD.has(role)) {
      found.push(
        `${where} says 「${boast[0]}」, the common misuse of 役不足 for 力不足; it may `
        + "only be a distractor that is wrong for that misuse, never over-politeness");
    }
    const hearsay = CALENDAR_HEARSAY.exec(text);
    if (hearsay) {
      found.push(
        `${where} passes on a date's weekday as hearsay (「${hearsay[0]}」); a calendar `
        + "is a fact anybody can check, so say it plainly or let the document show it");
    }
  }

  for (const [i, other] of twinsOfKey(item)) {
    found.push(
      `option ${i + 1} (「${other}」) is the key with one standard wording swapped for `
      + "another, so it is right too; a distractor must be wrong in this sentence, "
      + "not merely less usual");
  }

  for (const [where, text] of _spokenTexts(item)) {
    const m = WRITTEN_ONLY.exec(text);
    if (m) {
      found.push(
        `${where} is heard but contains 「${m[0]}」, which a listener cannot `
        + "hear; say it as a phrase instead");
    }
    const paper = PAPER_ONLY_WORD.exec(text);
    if (paper) {
      found.push(
        `${where} is heard but uses 「${paper[0]}」, a word only letters use; an `
        + "over-polite line must be something people really say");
    }
    const stack = new Set(text.match(CEREMONIAL) ?? []);
    if (stack.size >= CEREMONIAL_STACK) {
      found.push(
        `${where} stacks ${stack.size} written set phrases (${[...stack].map((s) => `「${s}」`).join("")}) `
        + "into one spoken line, a parody nobody says; an over-polite distractor is "
        + "ONE formula used in too ordinary a place");
    }
  }

  if (ONE_PERSON_TYPES.has(get(item, "item_type"))) {
    const asked = ASKS_ABOUT_PERSON.exec(get(item, "stem", "") as string);
    if (asked) {
      (or(get(item, "options"), []) as Item[]).forEach((o, i) => {
        const who = OPENS_WITH_PERSON.exec(get(o, "text", "") as string);
        if (who && who[1] !== asked[1]) {
          found.push(
            `option ${i + 1} is about 「${who[1]}」, but the question asks what `
            + `「${asked[1]}」 is doing; every option must be a sentence about `
            + `「${asked[1]}」, wrong in what they do or to whom`);
        }
      });
    }
  }

  if (NARRATION_MUST_NOT_SAY.has(get(item, "item_type"))) {
    const options: Item[] = or(get(item, "options"), []);
    let answer: string;
    try {
      answer = get(options[schemas.correctIndex(options)], "text", "");
    } catch (e) {
      if (!(e instanceof ValueError || e instanceof KeyError)) throw e;
      answer = "";
    }
    const needle = answer.replace(_PUNCT, "");
    if (len(needle) >= 4 && (get(item, "stem", "") as string).replace(_PUNCT, "").includes(needle)) {
      found.push(
        `the narration says the answer outright (「${answer}」); describe the `
        + "moment so that the listener has to work it out");
    }
  }

  return found;
}
