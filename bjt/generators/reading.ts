/**
 * The types whose stimulus is a document.
 *
 * Four of the nine put a business document in front of the learner: 状況把握,
 * 資料聴読解, 総合聴読解 and 総合読解. Three of them also play audio, and the whole
 * point of those three is that **neither source answers the question alone**. That
 * single requirement is what most of the prompt text below is defending, because it
 * is the one a generator will quietly drop: writing a document that contains the
 * answer, and a prompt that merely points at it, is much easier than writing a pair
 * that have to be combined — and the result looks fine until you notice the audio
 * is decorative.
 *
 * The document itself is data, never a picture (see `bjt/render`). The model
 * emits the structure and the template it was assigned; we render it.
 */
import { get, has, repr, truthy } from "../py.ts";
import * as render from "../render/index.ts";
import type { Cell } from "../seedtable.ts";
import { Generator, type Item, withRelationNote } from "./base.ts";

/** The constraint that defines every listening-and-reading type. Repeated in
 *  each prompt because it is the one that decays first. */
export const _BOTH_SOURCES = (
  "The answer MUST require both the document and the audio. Write the pair so that a "
  + "test-taker who reads only the document can narrow the options but not choose "
  + "between them, and one who hears only the audio cannot either. The usual way to "
  + "achieve this is for the audio to change, qualify, or select against something the "
  + "document states — a revised quantity, a cancelled slot, a condition that turns out "
  + "not to apply. The audio never restates what the document shows: if every date, "
  + "figure or place the answer turns on is said aloud, the document is decoration and "
  + "the item is a listening question (a 総合聴読解 whose conversation recited the whole "
  + "test schedule was withdrawn for this). Leave in the document the fact the audio "
  + "needs — the weekday, the row, the figure — and let the audio point at it (「二日目」, "
  + "「その翌営業日」) without saying it. "
  + "If you can answer your own item from one source, it is the wrong item. "
  + "Review checks exactly this: a reader is shown the document(s) and the four options "
  + "with the audio withheld, and the item is rejected if they can pick the answer; a "
  + "second reader with everything must then answer it with confidence."
);


/** When a graph earns its place in the 資料, and what it may not do. Told only
 *  to the two 聴読解 types that may draw one, and only for a cell that offers a
 *  template able to carry one (`Template.charts`) — a cell that assigns an
 *  email is not invited to draw a chart the validator will refuse. */
export const _CHARTS = (
  "A `chart` block draws figures as a bar or a line graph, and on the real paper the "
  + "資料 is often a graph. Use one when the question is about a comparison or a change — "
  + "which month fell, which branch overtook which, whether a figure cleared its target — "
  + "and a table when it is about looking a value up. A bar chart compares a few groups; a "
  + "line follows one quantity through time. At most three series, each named for the "
  + "legend; short labels; one `unit` for every figure; the figures as numbers.\n"
  + "The learner READS THE PICTURE, not the numbers: every difference the answer turns on "
  + "must be plain to the eye between two bars or two points (never 102 against 104). The "
  + "app prints every bar's figure on its bar, so an option may quote one; a line is read "
  + "against its gridlines, so ask about its shape — where it rises, falls, peaks or crosses "
  + "the other — and never for a figure off it.\n"
  + "A chart does not relax the rule above. The audio must still select, qualify or change "
  + "something the chart shows （「9月は障害の問い合わせを除いて見てください」, 「来期の"
  + "計画は大阪を除いた数字です」） so that neither the chart nor the audio answers alone: "
  + "a graph whose tallest bar is the answer is a graph with decorative audio."
);


/** Shared machinery for the four document types. */
export class _DocumentGenerator extends Generator {
  /** Which extra field holds the document(s), for the prompt text. */
  document_field: string = "document";
  /** The chart guidance above, for the types that may draw one; empty for
   *  the rest, which are then never told a chart exists. */
  chart_guidance: string = "";

  /** The chart guidance, when this type draws charts and this cell offers
   *  a template that can carry one — and which of its templates those are. */
  _chartSpec(cell: Cell): string {
    if (!this.chart_guidance) {
      return "";
    }
    const carriers = cell.templates.filter(
      (t) => has(render.TEMPLATES, t) && render.TEMPLATES[t].charts,
    );
    if (carriers.length === 0) {
      return "";
    }
    const others = cell.templates.filter((t) => !carriers.includes(t));
    const where = ("Of the templates offered here, "
                   + carriers.map((t) => `\`${t}\``).join("、")
                   + " can carry one `chart` block"
                   + (others.length > 0 ? `; ${others.map((t) => `\`${t}\``).join("、")} cannot.` : "."));
    return `${this.chart_guidance}\n${where}`;
  }

  _templateSpec(cell: Cell): string {
    if (cell.templates.length === 0) {
      return "";
    }
    let chosen: string;
    if (cell.templates.length === 1) {
      chosen = `Use the template \`${cell.templates[0]}\`.`;
    } else {
      chosen = (
        "Choose exactly one of these templates and set `template` to it: "
        + cell.templates.join("、")
      );
    }
    // Spell out every offered template rather than only the chosen one: the
    // model picks, so it needs to know what it is picking between.
    const details = cell.templates.map((t) => render.spec(t)).join("\n\n");
    return `${chosen}\n\n${details}`;
  }

  override cellSpec(cell: Cell): string {
    const lines = [
      "Write this item for the following assigned situation. These are "
      + "requirements, not suggestions:",
      `- 場面: ${cell.setting_ja}`,
      `- 関係: ${cell.relation_ja}`,
      `- 設問が問うこと: ${cell.function_ja}`,
      `- channel: ${cell.channel}`,
    ];
    if (cell.scenes.length > 0) {
      lines.push(`- scene_id: choose exactly one of: ${cell.scenes.join("、")}`);
    }
    const spec = this._templateSpec(cell);
    const charts = this._chartSpec(cell);
    return (withRelationNote(lines.join("\n"), cell)
            + (spec ? `\n\n${spec}` : "")
            + (charts ? `\n\n${charts}` : ""));
  }

  /**
   * The template is an assignment, exactly as the scene id is.
   *
   * `schemas.validateItem` already checked that each document is
   * well-formed; what it cannot know is which templates this cell offered.
   */
  override validateExtra(item: Item, opts: { cell?: Cell | null } = {}): string[] {
    const cell = opts.cell ?? null;
    const errors: string[] = [];
    if (cell === null) {
      return errors;
    }

    const channel = get(item, "channel");
    if (cell.channel && !(channel === null || channel === cell.channel)) {
      errors.push(
        `channel ${repr(channel)} does not match the cell's ${repr(cell.channel)}`,
      );
    }
    if (cell.scenes.length > 0 && truthy(get(item, "scene_id")) && !cell.scenes.includes(item["scene_id"])) {
      errors.push(
        `scene_id ${repr(item["scene_id"])} is not one of this cell's scenes: `
        + `${repr([...cell.scenes])}`,
      );
    }

    if (cell.templates.length > 0) {
      const value = get(item, this.document_field);
      const docs: unknown[] = Array.isArray(value) ? value : [value];
      for (const doc of docs) {
        if (doc === null || typeof doc !== "object" || Array.isArray(doc)) {
          continue;
        }
        if (!cell.templates.includes(get(doc, "template"))) {
          errors.push(
            `template ${repr(get(doc, "template"))} is not one of this cell's `
            + `templates: ${repr([...cell.templates])}`,
          );
        }
      }
    }
    return errors;
  }
}


/** 状況把握問題 — read what is posted, hear what is asked, choose the action. */
export class JoukyouHaakuGenerator extends _DocumentGenerator {
  override item_type = "joukyou_haaku";
  override label = "状況把握問題 (situation grasp, listening+reading)";
  override requires_cell = true;
  override task_spec = (
    "Format: `document` is what the test-taker reads — a notice, a sign, or a "
    + "schedule. `stem` is what the NARRATOR reads aloud: the situation and somebody's "
    + "spoken request, ending with a question such as 「このあと、どうすればいいですか。」. "
    + "The four options are courses of action.\n"
    + `${_BOTH_SOURCES}\n`
    + "Do not describe the document's contents in the stem — it is read, not heard, and "
    + "repeating it aloud removes the reading half of the item.\n"
    + "Every option must be an action somebody could actually take here, phrased in "
    + "parallel. The trap roles for this type are all about using one source and not "
    + "the other, so build each distractor to be exactly right on one source and wrong "
    + "on the other."
  );
}


/** 資料聴読解問題 — a document on the page, a prompt in the ear. */
export class ShiryouChoudokkaiGenerator extends _DocumentGenerator {
  override item_type = "shiryou_choudokkai";
  override label = "資料聴読解問題 (document listening+reading)";
  override requires_cell = true;
  override chart_guidance = _CHARTS;
  override task_spec = (
    "Format: `document` is what the test-taker reads — an email, a schedule, a "
    + "quotation. `stem` is the spoken prompt the narrator reads, ending with the "
    + "question. The four options are usually values read out of the document: a date, "
    + "a quantity, a person, a room.\n"
    + `${_BOTH_SOURCES}\n`
    + "Give the document at least one plausible neighbouring row or entry that a "
    + "hurried reader would take instead of the right one — that is the "
    + "`reads_wrong_row` trap, and a document with a single row has no room for it.\n"
    + "Where the audio revises something the document says, state the original clearly "
    + "in the document: the `ignores_the_spoken_change` distractor must be the "
    + "document's own value, not an invented one.\n"
    + "**The audio must point at its answer indirectly.** This is how the real paper "
    + "makes both sources necessary, and it is not the same as splitting the facts "
    + "between them. On a 見積書 whose rows are 納期・引渡条件・支払条件・総額, the client "
    + "does not say 「支払条件を変更してください」 — they say 「支払条件がちょっと…」 and "
    + "trail off, or describe the consequence without naming the row, and the "
    + "salesperson's reply settles it. An audio line that names the answer outright "
    + "leaves the document decorative even though it is still needed to look the "
    + "answer up. Reluctance, hesitation and implication are the mechanism."
  );
}


/** 総合聴読解問題 — a longer exchange plus its documents. */
export class SougouChoudokkaiGenerator extends _DocumentGenerator {
  override item_type = "sougou_choudokkai";
  override label = "総合聴読解問題 (integrated listening+reading)";
  override requires_cell = true;
  override document_field = "documents";
  override chart_guidance = _CHARTS;
  override task_spec = (
    "Format: `dialogue` is the exchange the test-taker hears — three to eight turns "
    + "across two or three speaker ROLES (never personal names). `documents` holds one "
    + "or two documents they read alongside it. `stem` is the narrator's question "
    + "afterwards.\n"
    + `${_BOTH_SOURCES}\n`
    + "This is the hardest type and its distinctive trap is `combines_wrong_pair`: the "
    + "right document read against the wrong turn of the conversation. Build the "
    + "exchange so that more than one turn could plausibly attach to the document, and "
    + "only one actually does.\n"
    + "Keep both documents short. Two documents on a phone screen is already a lot to "
    + "hold; the difficulty should come from combining them, never from their length."
  );
}


/** 総合読解問題 — reading only. */
export class SougouDokkaiGenerator extends _DocumentGenerator {
  override item_type = "sougou_dokkai";
  override label = "総合読解問題 (integrated reading)";
  override requires_cell = true;
  override task_spec = (
    "Format: `document` is the passage — an email thread, a memo, a report, a notice. "
    + "`stem` is the question as the test-taker reads it. Nothing in this type is "
    + "heard, so there is no narrator and no audio.\n"
    + "This is the LONG one, and the only long one on the paper. The level guide "
    + "describes it as two to three minutes of reading; write a passage somebody has "
    + "to work through rather than glance at. A two-hundred-character notice is a "
    + "different, easier type of question wearing this one's name.\n"
    + "The best material for it is an exchange that CHANGED: several messages with an "
    + "outside party, or an internal 通知 that revises an earlier one. The question is "
    + "then what was newly decided and what that obliges somebody to do — and the "
    + "distractors are what was true at an earlier point in the thread: the original "
    + "date, the withdrawn request, the quantity before it was revised. A single "
    + "self-consistent document cannot carry this type, because it gives the traps "
    + "nothing to attach to.\n"
    + "The question must require an INFERENCE, not a lookup. 「何が書いてありますか」 is "
    + "not this type; 「この後、まず何をすべきですか」 and 「なぜ変更になったのですか」 are. "
    + "The answer must be genuinely derivable from the document — a reasonable reader "
    + "should agree it is the only defensible reading — while never being a sentence "
    + "you can point at. Review shows a reader the question and the four options with "
    + "the passage withheld and rejects the item if the answer can be picked; the "
    + "distractors must each be a reading somebody could take of SOME passage.\n"
    + "The four traps for this type are all near-misses against the passage: something "
    + "true of the world but unstated, something stated but answering a different "
    + "question, something from the wrong point in time, and something that reuses a "
    + "salient word with the wrong referent. Each needs real material in the document "
    + "to attach to, so give the passage more than the question strictly needs."
  );
}
