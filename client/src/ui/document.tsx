/**
 * A document stimulus, drawn to look like the thing it is.
 *
 * There are two renderers for one data model and that is deliberate.
 * `bjt/render/html.py` produces HTML — for the CLI preview and for anything that
 * wants a page. This one produces native views, because the app runs on iOS and
 * Android as well as the web and a WebView per question would be slow, would not
 * inherit the reader's text size, and would fight the scroll of the screen it
 * sits in.
 *
 * What the two share is the thing that matters: the document is **data**. A
 * screenshot of an email could not be selected, scaled, or read aloud — and for
 * a language exam aid, somebody reading with their ears is a real case. The
 * shape is enforced once, upstream, before an item is ever published.
 *
 * What this renderer adds is the *look* of the real artefact, per template. The
 * exam puts a quotation, an email, a notice in front of the candidate as they
 * would arrive on a desk or in an inbox — the date top right, 御中 after the
 * addressee, 以上 closing a memo, figures right-aligned in a bordered grid — and
 * a learner who has read fifty of these in the app should not be surprised by
 * the shape of the fifty-first on the day. So the app's own visual language
 * stops at the edge of the sheet: inside it is ink on paper, or a mail client,
 * and nothing is coloured purple. The owner asked for this (2026-09-17).
 *
 * Tables are the hard part on a phone. A business quotation has four columns and
 * a phone has none to spare, so below a threshold each row is drawn as a stack
 * of labelled fields instead — the same information, in the order somebody would
 * read it aloud, rather than a horizontal scroll nobody notices is there.
 */
import React from "react";
import { Platform, StyleSheet, Text, useWindowDimensions, View, type TextStyle } from "react-native";

import { useLang, type Key } from "../lib/i18n";
import type { DocBlock, StimulusDocument } from "../lib/types";
import { radius, space } from "./theme";

/** Below this width a table becomes stacked rows. Four columns of Japanese at
 *  16px need about this much before the cells start breaking mid-word. */
const TABLE_MIN_WIDTH = 420;

const TEMPLATE_KEY: Record<string, Key> = {
  email_external: "doc_email_external",
  email_thread: "doc_email_thread",
  memo_notice: "doc_memo_notice",
  meeting_minutes: "doc_meeting_minutes",
  schedule: "doc_schedule",
  progress_report: "doc_progress_report",
  quote_order: "doc_quote_order",
  office_sign: "doc_office_sign",
};

// ----- ink -------------------------------------------------------------------

/** The paper's own palette. Deliberately not the app theme: a quotation is
 *  black on white whoever's app it is being read in. */
const ink = {
  paper: "#FFFFFF",
  text: "#1F1F1F",
  faint: "#5C5C5C",
  rule: "#9A9A9A",
  ruleLight: "#D6D6D6",
  headFill: "#F2F2F2",
  mailFill: "#F7F7F7",
  postit: "#FFF8D6",
};

/** Formal paper documents are set in a mincho face where the platform has one.
 *  Web and iOS ship one; Android falls back to its system CJK face, which is
 *  still fine, so no font is bundled for this. */
const MINCHO: TextStyle = Platform.select({
  web: { fontFamily: '"Hiragino Mincho ProN", "Yu Mincho", "Noto Serif JP", "MS Mincho", serif' },
  ios: { fontFamily: "Hiragino Mincho ProN" },
  default: {},
}) as TextStyle;

const GOTHIC: TextStyle = Platform.select({
  web: { fontFamily: '"Hiragino Sans", "Hiragino Kaku Gothic ProN", "Yu Gothic", "Meiryo", sans-serif' },
  default: {},
}) as TextStyle;

/** A cell that is a figure — a price, a quantity, a percentage — sits on the
 *  right, as it does on any real form. */
const NUMERIC = /^[¥￥]?[\d,]+(\.\d+)?\s*(円|%|個|箱|冊|本|名|台|件|部|枚|袋|セット)?$/;

// ----- shared pieces ----------------------------------------------------------

type Face = "mincho" | "gothic";

function faceStyle(face: Face): TextStyle {
  return face === "mincho" ? MINCHO : GOTHIC;
}

function Fields({
  pairs,
  face,
  wide,
}: {
  pairs: { label: string; value: string }[];
  face: Face;
  /** Column headings used as labels — a time range, a full heading — need
   *  more room than 宛先 does. */
  wide?: boolean;
}) {
  return (
    <View style={styles.fields}>
      {pairs.map((pair, i) => (
        <View key={`${pair.label}-${i}`} style={styles.field}>
          <Text style={[styles.fieldLabel, wide && styles.fieldLabelWide, faceStyle(face)]}>
            {pair.label}
          </Text>
          <Text style={[styles.fieldValue, faceStyle(face)]}>{pair.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ block, stacked, face }: { block: DocBlock; stacked: boolean; face: Face }) {
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];

  if (stacked) {
    return (
      <View style={{ gap: space.sm }}>
        {block.caption ? <Text style={[styles.caption, faceStyle(face)]}>{block.caption}</Text> : null}
        {rows.map((row, r) => (
          <View key={r} style={styles.stackedRow}>
            {/* The first cell heads the group: a reader hears "納期 — 4月22日"
                rather than a date with nothing attached to it. */}
            <Text style={[styles.stackedHead, faceStyle(face)]}>{row[0]}</Text>
            <Fields
              face={face}
              wide
              pairs={columns.slice(1).map((label, c) => ({ label, value: row[c + 1] ?? "" }))}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View>
      {block.caption ? <Text style={[styles.caption, faceStyle(face)]}>{block.caption}</Text> : null}
      <View style={styles.table}>
        <View style={[styles.tableRow, styles.tableHeadRow]}>
          {columns.map((column, i) => (
            <Text
              key={i}
              style={[styles.cell, styles.headCell, faceStyle(face), i > 0 && styles.cellLeftRule]}
              accessibilityRole="header"
            >
              {column}
            </Text>
          ))}
        </View>
        {rows.map((row, r) => (
          <View key={r} style={styles.tableRow}>
            {row.map((cell, c) => (
              <Text
                key={c}
                style={[
                  styles.cell,
                  faceStyle(face),
                  c > 0 && styles.cellLeftRule,
                  NUMERIC.test(cell.trim()) && styles.cellNumeric,
                ]}
              >
                {cell}
              </Text>
            ))}
          </View>
        ))}
      </View>
    </View>
  );
}

function Quoted({ block, face }: { block: DocBlock; face: Face }) {
  // A quoted message the way a mail client shows it: a rule, who and when in
  // small grey, then the text set in from a grey bar. Deeper replies step in.
  return (
    <View style={[styles.quote, { marginLeft: Math.min(block.depth ?? 0, 3) * space.md }]}>
      <View style={styles.mailRule} />
      <Text style={[styles.quoteFrom, faceStyle(face)]}>
        {block.sent_at ? `${block.sent_at}　` : ""}
        {block.sender}:
      </Text>
      <View style={styles.quoteBody}>
        <Text style={[styles.body, faceStyle(face)]}>{block.text}</Text>
      </View>
    </View>
  );
}

function Block({ block, stacked, face }: { block: DocBlock; stacked: boolean; face: Face }) {
  switch (block.type) {
    case "heading":
      return <Text style={[styles.heading, faceStyle(face)]}>{block.text}</Text>;
    case "paragraph":
      return <Text style={[styles.body, faceStyle(face)]}>{block.text}</Text>;
    case "bullets":
    case "numbered":
      return (
        <View style={{ gap: 2 }}>
          {(block.items ?? []).map((entry, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={[styles.bullet, faceStyle(face)]}>
                {block.type === "numbered" ? `${i + 1}.` : "・"}
              </Text>
              <Text style={[styles.body, faceStyle(face), { flex: 1 }]}>{entry}</Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return <Table block={block} stacked={stacked} face={face} />;
    case "key_values":
      return <Fields pairs={block.pairs ?? []} face={face} />;
    case "quoted_message":
      return <Quoted block={block} face={face} />;
    case "callout":
      // On paper a notice is a ※ line, not a coloured box.
      return (
        <View style={styles.callout} accessibilityRole="none">
          <Text style={[styles.body, faceStyle(face), { flex: 1 }]}>※ {block.text}</Text>
        </View>
      );
    default:
      // An unknown block type drops rather than throwing. A learner is in the
      // middle of reading this; losing one paragraph beats losing the screen.
      return null;
  }
}

function Blocks({ doc, stacked, face }: { doc: StimulusDocument; stacked: boolean; face: Face }) {
  return (
    <View style={styles.blocks}>
      {(doc.blocks ?? []).map((block, i) => (
        <Block key={i} block={block} stacked={stacked} face={face} />
      ))}
    </View>
  );
}

/** Pull the header fields a template lays out itself; whatever is left is
 *  drawn as plain fields, so an extra label the model added is not lost. */
function takeMeta(doc: StimulusDocument, labels: string[]) {
  const got: Record<string, string> = {};
  const rest: { label: string; value: string }[] = [];
  for (const pair of doc.meta ?? []) {
    if (labels.includes(pair.label) && !(pair.label in got)) got[pair.label] = pair.value;
    else rest.push(pair);
  }
  return { got, rest };
}

// ----- the templates ----------------------------------------------------------

type Chrome = (props: { doc: StimulusDocument; stacked: boolean }) => React.ReactElement;

/** 社外メール / メールのやりとり: a mail client's reading pane. */
const Email: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["差出人", "宛先", "件名", "日時"]);
  const face: Face = "gothic";
  return (
    <View style={styles.mail}>
      <View style={styles.mailHead}>
        <Text style={[styles.mailSubject, faceStyle(face)]}>{got["件名"] ?? doc.title}</Text>
        <View style={styles.mailRow}>
          <Text style={[styles.mailLabel, faceStyle(face)]}>差出人</Text>
          <Text style={[styles.mailValue, faceStyle(face), { fontWeight: "700" }]}>{got["差出人"]}</Text>
          {got["日時"] ? <Text style={[styles.mailDate, faceStyle(face)]}>{got["日時"]}</Text> : null}
        </View>
        <View style={styles.mailRow}>
          <Text style={[styles.mailLabel, faceStyle(face)]}>宛先</Text>
          <Text style={[styles.mailValue, faceStyle(face)]}>{got["宛先"]}</Text>
        </View>
        {rest.length ? <Fields pairs={rest} face={face} /> : null}
      </View>
      <View style={styles.mailBody}>
        <Blocks doc={doc} stacked={stacked} face={face} />
      </View>
    </View>
  );
};

/** 社内通知・回覧: date and sender top right, 各位 top left, a ruled title,
 *  the body, 以上. */
const Notice: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["発信者", "発信日", "対象"]);
  const face: Face = "mincho";
  return (
    <View style={styles.paper}>
      <View style={styles.paperTopRow}>
        <Text style={[styles.body, faceStyle(face)]}>{got["対象"] ? `${got["対象"]}各位` : ""}</Text>
        <View style={{ alignItems: "flex-end" }}>
          {got["発信日"] ? <Text style={[styles.body, faceStyle(face)]}>{got["発信日"]}</Text> : null}
          {got["発信者"] ? <Text style={[styles.body, faceStyle(face)]}>{got["発信者"]}</Text> : null}
        </View>
      </View>
      <Text style={[styles.paperTitle, faceStyle(face)]}>{doc.title}</Text>
      {rest.length ? <Fields pairs={rest} face={face} /> : null}
      <Blocks doc={doc} stacked={stacked} face={face} />
      <Text style={[styles.ijou, faceStyle(face)]}>以上</Text>
    </View>
  );
};

/** 見積書・注文書: the title spaced across the top, the addressee with 御中,
 *  issuer and date on the right, a ruled grid with the figures right-aligned. */
const Quote: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["宛先", "発行者", "発行日"]);
  const face: Face = "mincho";
  return (
    <View style={styles.paper}>
      <Text style={[styles.formTitle, faceStyle(face)]}>{doc.title}</Text>
      {/* On paper the addressee sits left and the issuer right; on a phone
          there is no right, so the issuer block drops under it, still ranged
          right as a letterhead would be. */}
      <View style={stacked ? styles.paperTopStack : styles.paperTopRow}>
        <View style={stacked ? undefined : { flex: 1 }}>
          {got["宛先"] ? (
            <Text style={[styles.addressee, faceStyle(face)]}>{got["宛先"]}</Text>
          ) : null}
        </View>
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {got["発行日"] ? <Text style={[styles.body, faceStyle(face)]}>{got["発行日"]}</Text> : null}
          {got["発行者"] ? <Text style={[styles.body, faceStyle(face)]}>{got["発行者"]}</Text> : null}
        </View>
      </View>
      {rest.length ? <Fields pairs={rest} face={face} /> : null}
      <Blocks doc={doc} stacked={stacked} face={face} />
    </View>
  );
};

/** 議事録: the title, then a boxed header of when, where and who, then the
 *  agenda, then 以上. */
const Minutes: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["日時", "場所", "出席者"]);
  const face: Face = "mincho";
  const header: { label: string; value: string }[] = ["日時", "場所", "出席者"]
    .filter((k) => got[k])
    .map((k) => ({ label: k, value: got[k] }))
    .concat(rest);
  return (
    <View style={styles.paper}>
      <Text style={[styles.paperTitle, faceStyle(face)]}>{doc.title}</Text>
      <View style={styles.grid}>
        {header.map((pair, i) => (
          <View key={i} style={[styles.gridRow, i > 0 && styles.gridRowRule]}>
            <Text style={[styles.gridLabel, faceStyle(face)]}>{pair.label}</Text>
            <Text style={[styles.gridValue, faceStyle(face)]}>{pair.value}</Text>
          </View>
        ))}
      </View>
      <Blocks doc={doc} stacked={stacked} face={face} />
      <Text style={[styles.ijou, faceStyle(face)]}>以上</Text>
    </View>
  );
};

/** 予定表: a title, the period under it, the grid, the author bottom right. */
const Schedule: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["期間", "作成者"]);
  const face: Face = "gothic";
  return (
    <View style={styles.paper}>
      <Text style={[styles.paperTitle, faceStyle(face)]}>{doc.title}</Text>
      {got["期間"] ? <Text style={[styles.subline, faceStyle(face)]}>{got["期間"]}</Text> : null}
      {rest.length ? <Fields pairs={rest} face={face} /> : null}
      <Blocks doc={doc} stacked={stacked} face={face} />
      {got["作成者"] ? (
        <Text style={[styles.signoff, faceStyle(face)]}>作成：{got["作成者"]}</Text>
      ) : null}
    </View>
  );
};

/** 進捗報告書: a report sheet, date and reporter top right, the project as
 *  the first line, 以上 at the end. */
const Report: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["報告者", "報告日", "案件"]);
  const face: Face = "mincho";
  return (
    <View style={styles.paper}>
      <View style={styles.paperTopRow}>
        <View style={{ flex: 1 }} />
        <View style={{ alignItems: "flex-end", gap: 2 }}>
          {got["報告日"] ? <Text style={[styles.body, faceStyle(face)]}>{got["報告日"]}</Text> : null}
          {got["報告者"] ? <Text style={[styles.body, faceStyle(face)]}>{got["報告者"]}</Text> : null}
        </View>
      </View>
      <Text style={[styles.paperTitle, faceStyle(face)]}>{doc.title}</Text>
      <Fields
        pairs={(got["案件"] ? [{ label: "案件", value: got["案件"] }] : []).concat(rest)}
        face={face}
      />
      <Blocks doc={doc} stacked={stacked} face={face} />
      <Text style={[styles.ijou, faceStyle(face)]}>以上</Text>
    </View>
  );
};

/** 掲示・案内: a sign on a wall — a heavy border, a big title, larger type,
 *  and who put it up in the corner. */
const Sign: Chrome = ({ doc, stacked }) => {
  const { got, rest } = takeMeta(doc, ["掲示者"]);
  const face: Face = "gothic";
  return (
    <View style={styles.sign}>
      <Text style={[styles.signTitle, faceStyle(face)]}>{doc.title}</Text>
      {rest.length ? <Fields pairs={rest} face={face} /> : null}
      <Blocks doc={doc} stacked={stacked} face={face} />
      {got["掲示者"] ? (
        <Text style={[styles.signoff, faceStyle(face)]}>{got["掲示者"]}</Text>
      ) : null}
    </View>
  );
};

/** Anything the template map does not know: plain paper, all fields shown. */
const Plain: Chrome = ({ doc, stacked }) => (
  <View style={styles.paper}>
    <Text style={[styles.paperTitle, MINCHO]}>{doc.title}</Text>
    {doc.meta?.length ? <Fields pairs={doc.meta} face="mincho" /> : null}
    <Blocks doc={doc} stacked={stacked} face="mincho" />
  </View>
);

const CHROME: Record<string, Chrome> = {
  email_external: Email,
  email_thread: Email,
  memo_notice: Notice,
  meeting_minutes: Minutes,
  schedule: Schedule,
  progress_report: Report,
  quote_order: Quote,
  office_sign: Sign,
};

export function DocumentView({ doc }: { doc: StimulusDocument }) {
  const { t } = useLang();
  const kindKey = TEMPLATE_KEY[doc.template];
  const kind = kindKey ? t(kindKey) : doc.template;
  const { width } = useWindowDimensions();
  const stacked = width < TABLE_MIN_WIDTH;
  const Render = CHROME[doc.template] ?? Plain;

  // The kind is for the screen reader only. On the page the document says what
  // it is by its shape, as it would on a desk.
  return (
    <View accessible={false} accessibilityLabel={`${kind}: ${doc.title}`}>
      <Render doc={doc} stacked={stacked} />
    </View>
  );
}

// ----- styles ------------------------------------------------------------------

const BODY: TextStyle = { fontSize: 15, lineHeight: 25, color: ink.text };

const styles = StyleSheet.create({
  // A sheet of paper: square corners, a hairline, a little lift off the card.
  paper: {
    backgroundColor: ink.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ink.rule,
    paddingHorizontal: space.lg,
    paddingVertical: space.lg,
    gap: space.md,
    shadowColor: "#000",
    shadowOpacity: 0.08,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  paperTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", gap: space.md },
  paperTopStack: { gap: space.md },
  paperTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: ink.text,
    textAlign: "center",
    lineHeight: 28,
    marginTop: space.xs,
  },
  formTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: ink.text,
    textAlign: "center",
    letterSpacing: 6,
    lineHeight: 32,
  },
  addressee: {
    fontSize: 17,
    lineHeight: 28,
    color: ink.text,
    borderBottomWidth: 1,
    borderBottomColor: ink.text,
    alignSelf: "flex-start",
    paddingRight: space.lg,
  },
  subline: { ...BODY, textAlign: "center", marginTop: -space.sm },
  ijou: { ...BODY, textAlign: "right", marginTop: space.sm },
  signoff: { ...BODY, textAlign: "right", color: ink.faint },
  blocks: { gap: space.md },
  body: BODY,
  heading: { fontSize: 15, fontWeight: "700", color: ink.text, lineHeight: 24 },
  caption: { fontSize: 13, color: ink.faint, marginBottom: space.xs },
  fields: { gap: 2 },
  field: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  fieldLabel: { ...BODY, fontSize: 14, color: ink.faint, width: 84 },
  fieldLabelWide: { width: 120 },
  fieldValue: { ...BODY, fontSize: 14, flex: 1 },
  listRow: { flexDirection: "row", gap: space.xs },
  bullet: { ...BODY, width: 24 },
  callout: { flexDirection: "row" },

  // The grid on a form: full rules, a grey head, figures on the right.
  table: { borderWidth: 1, borderColor: ink.rule },
  tableRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: ink.rule },
  tableHeadRow: { borderTopWidth: 0, backgroundColor: ink.headFill },
  cell: { flex: 1, paddingHorizontal: space.sm, paddingVertical: 6, fontSize: 14, lineHeight: 22, color: ink.text },
  cellLeftRule: { borderLeftWidth: 1, borderLeftColor: ink.rule },
  headCell: { textAlign: "center", fontWeight: "700" },
  cellNumeric: { textAlign: "right" },
  stackedRow: { borderWidth: 1, borderColor: ink.rule, padding: space.sm, gap: 2 },
  stackedHead: { fontSize: 14, fontWeight: "700", color: ink.text },

  // A boxed header on minutes: label cells shaded, one rule between rows.
  grid: { borderWidth: 1, borderColor: ink.rule },
  gridRow: { flexDirection: "row" },
  gridRowRule: { borderTopWidth: 1, borderTopColor: ink.rule },
  gridLabel: {
    ...BODY,
    fontSize: 14,
    width: 84,
    paddingHorizontal: space.sm,
    paddingVertical: 4,
    backgroundColor: ink.headFill,
    borderRightWidth: 1,
    borderRightColor: ink.rule,
    textAlign: "center",
  },
  gridValue: { ...BODY, fontSize: 14, flex: 1, paddingHorizontal: space.sm, paddingVertical: 4 },

  // A mail client's reading pane: a grey header strip over a white body.
  mail: {
    backgroundColor: ink.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: ink.rule,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  mailHead: {
    backgroundColor: ink.mailFill,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    gap: 4,
    borderBottomWidth: 1,
    borderBottomColor: ink.ruleLight,
  },
  mailSubject: { fontSize: 17, fontWeight: "700", color: ink.text, lineHeight: 26, marginBottom: 4 },
  mailRow: { flexDirection: "row", alignItems: "baseline", gap: space.sm },
  mailLabel: { fontSize: 12, color: ink.faint, width: 44 },
  mailValue: { fontSize: 14, color: ink.text, flex: 1, lineHeight: 22 },
  mailDate: { fontSize: 12, color: ink.faint },
  mailBody: { paddingHorizontal: space.md, paddingVertical: space.md },
  mailRule: { height: 1, backgroundColor: ink.ruleLight, marginBottom: space.xs },
  quote: { gap: 4 },
  quoteFrom: { fontSize: 12, color: ink.faint },
  quoteBody: { borderLeftWidth: 2, borderLeftColor: ink.ruleLight, paddingLeft: space.sm },

  // A sign on a wall: a heavy border, the title big, room around everything.
  sign: {
    backgroundColor: ink.paper,
    borderWidth: 3,
    borderColor: ink.text,
    padding: space.lg,
    gap: space.md,
  },
  signTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: ink.text,
    textAlign: "center",
    lineHeight: 32,
    marginBottom: space.xs,
  },
});
