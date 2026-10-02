/**
 * The document templates — the visual grammar a reading item borrows.
 *
 * A generic paragraph card would make every reading item look the same and feel
 * like a textbook. Real business reading is done against a shape you already
 * recognise: you know where a subject line lives, you know the action items are at
 * the bottom of the minutes. Recognising the shape *is* part of the skill, so the
 * templates supply it and the generated content supplies only the original
 * business writing that goes inside.
 *
 * Each template declares the header fields it cannot do without, the item types it
 * suits, and whether it may carry a graph. `required_meta` and `charts` are
 * enforced by `document.validateDocument`: an email with no 件名 is not an
 * email, and an item built on one would be testing something other than what it
 * claims.
 *
 * Every template is our own design and the content is always fictional — invented
 * companies, people, dates and amounts. No real brand, and no transcription of any
 * existing document, ever goes in here.
 */
import { KeyError, repr } from "../py.ts";

export class Template {
  readonly id: string;
  readonly ja: string;
  /** What the reader is looking at, one line, used in prompts. */
  readonly description: string;
  /** Header labels the document must carry. Japanese, because they render as
   *  written. */
  readonly required_meta: readonly string[];
  /** Item types this template is a sensible stimulus for. */
  readonly suits: readonly string[];
  /** Ways this template is allowed to vary, so a library of them does not
   *  become visually predictable. Handed to the generator as a menu. */
  readonly variations: readonly string[];
  /** Whether a `chart` block may appear in it. A graph belongs on a handout of
   *  figures and in a progress report; in an email body, on a sign or on a
   *  quotation it is not what arrives on a desk, so `validateDocument`
   *  refuses it there rather than drawing it. */
  readonly charts: boolean;

  constructor(init: {
    id: string;
    ja: string;
    description: string;
    required_meta: readonly string[];
    suits: readonly string[];
    variations?: readonly string[];
    charts?: boolean;
  }) {
    this.id = init.id;
    this.ja = init.ja;
    this.description = init.description;
    this.required_meta = init.required_meta;
    this.suits = init.suits;
    this.variations = init.variations ?? [];
    this.charts = init.charts ?? false;
  }
}

const _ALL_DOC_TYPES = ["shiryou_choudokkai", "sougou_choudokkai", "sougou_dokkai"] as const;

export const TEMPLATES: Record<string, Template> = {
  email_external: new Template({
    id: "email_external",
    ja: "社外メール",
    description: "A single email to or from someone outside the company.",
    required_meta: ["差出人", "宛先", "件名", "日時"],
    suits: ["hyougen", ..._ALL_DOC_TYPES],
    variations: [
      "one recipient, or one recipient plus a CC",
      "a request, a reply to a request, or an unprompted notification",
      "with or without an attachment line",
    ],
  }),
  email_thread: new Template({
    id: "email_thread",
    ja: "メールのやりとり",
    description: "A reply chain: the newest message on top, earlier ones quoted below.",
    required_meta: ["差出人", "宛先", "件名", "日時"],
    suits: _ALL_DOC_TYPES,
    variations: [
      "two, three, or four messages",
      "the decision in the newest message, or buried in the middle one",
      "one participant added partway down the chain",
    ],
  }),
  memo_notice: new Template({
    id: "memo_notice",
    ja: "社内通知・回覧",
    description: "An internal notice: a change of procedure, and what staff must do.",
    required_meta: ["発信者", "発信日", "対象"],
    suits: ["joukyou_haaku", ..._ALL_DOC_TYPES],
    variations: [
      "effective immediately, or from a stated date",
      "one action for everyone, or different actions per department",
    ],
  }),
  meeting_minutes: new Template({
    id: "meeting_minutes",
    ja: "議事録",
    description: "Minutes: attendees, numbered agenda, decisions, and who owns each action.",
    required_meta: ["日時", "場所", "出席者"],
    suits: ["sougou_choukai", "sougou_choudokkai", "sougou_dokkai"],
    variations: [
      "decisions settled, or one item carried over",
      "action owners named, or one action left unassigned on purpose",
    ],
  }),
  schedule: new Template({
    id: "schedule",
    ja: "予定表",
    description: "A schedule or room-booking grid with times, people and places.",
    required_meta: ["期間", "作成者"],
    suits: ["joukyou_haaku", "shiryou_choudokkai", "sougou_choudokkai"],
    variations: [
      "one open slot, a double booking, or a provisional reservation",
      "a changed location on one row",
    ],
  }),
  progress_report: new Template({
    id: "progress_report",
    ja: "進捗報告書",
    description: "A project update: status, milestones, risks, next steps.",
    required_meta: ["報告者", "報告日", "案件"],
    suits: ["sougou_dokkai", "sougou_choudokkai"],
    variations: [
      "a summary paragraph, a milestone table, or a risks-and-actions list",
      "on schedule, slipping, or recovered after a slip",
    ],
    charts: true,
  }),
  quote_order: new Template({
    id: "quote_order",
    ja: "見積書・注文書",
    description: "A quotation or order: sender and recipient blocks, line items, totals, delivery date.",
    required_meta: ["宛先", "発行者", "発行日"],
    suits: ["shiryou_choudokkai", "sougou_dokkai"],
    variations: [
      "two to five line items",
      "one revised quantity or unit price against an earlier version",
      "a note about delivery separate from the table",
    ],
  }),
  office_sign: new Template({
    id: "office_sign",
    ja: "掲示・案内",
    description: "A sign or short form: a heading, the rules, and where or by when.",
    required_meta: ["掲示者"],
    suits: ["bamen_haaku", "joukyou_haaku", "sougou_dokkai"],
    variations: [
      "rules as a list, or as a short procedure",
      "a deadline, a location, or a contact as the tested detail",
    ],
  }),
  // The 資料 as a graph: what 資料聴読解 puts in front of the candidate when
  // the question is about a trend or a comparison rather than a cell. Its
  // header is a schedule's — the period the figures cover and who compiled
  // them — because that is what a handout of figures carries, and the app
  // draws it on the same sheet.
  figures: new Template({
    id: "figures",
    ja: "集計資料",
    description: "A handout of figures: a bar or line chart of results over a " +
    "period, with a line or two of notes, as handed round at a meeting.",
    required_meta: ["期間", "作成者"],
    suits: ["shiryou_choudokkai", "sougou_choudokkai"],
    variations: [
      "a bar chart comparing branches, products or periods, or a line chart of a trend",
      "one series, or two or three compared (this year against last, plan against actual)",
      "a note under the chart about one figure (a one-off, an estimate, a change of method)",
    ],
    charts: true,
  }),
};

/** The templates a given item type is allowed to be set in. */
export function forItemType(itemType: string): Template[] {
  return Object.values(TEMPLATES).filter((t) => t.suits.includes(itemType));
}

/** The template rendered as prompt text: what it is, what it must carry, and
 *  the ways it is allowed to vary. */
export function spec(templateId: string): string {
  if (!Object.prototype.hasOwnProperty.call(TEMPLATES, templateId)) {
    throw new KeyError(repr(templateId));
  }
  const t = TEMPLATES[templateId];
  const lines = [
    `Document template: ${t.id}（${t.ja}） — ${t.description}`,
    "Required header fields (`meta`), with these exact labels: " +
    t.required_meta.join("、"),
  ];
  if (t.variations.length > 0) {
    lines.push(
      "Pick one option from each axis below, so a library of these documents " +
      "does not become visually predictable:\n" +
      t.variations.map((v) => `  - ${v}`).join("\n"),
    );
  }
  lines.push(
    "All names, companies, dates, amounts and phone numbers are fictional and " +
    "original. Never use a real brand, and never reproduce an existing document.",
  );
  return lines.join("\n");
}
