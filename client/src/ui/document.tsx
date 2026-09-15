/**
 * A document stimulus, drawn with React Native views.
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
 * Tables are the hard part on a phone. A business quotation has four columns and
 * a phone has none to spare, so below a threshold each row is drawn as a stack
 * of labelled fields instead — the same information, in the order somebody would
 * read it aloud, rather than a horizontal scroll nobody notices is there.
 */
import React from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";

import type { DocBlock, StimulusDocument } from "../lib/types";
import { colors, radius, space, type } from "./theme";

/** Below this width a table becomes stacked rows. Four columns of Japanese at
 *  16px need about this much before the cells start breaking mid-word. */
const TABLE_MIN_WIDTH = 420;

const TEMPLATE_LABEL: Record<string, string> = {
  email_external: "社外メール",
  email_thread: "メールのやりとり",
  memo_notice: "社内通知",
  meeting_minutes: "議事録",
  schedule: "予定表",
  progress_report: "進捗報告書",
  quote_order: "見積書・注文書",
  office_sign: "掲示・案内",
};

const TONE_COLOR: Record<string, string> = {
  info: colors.accent,
  warning: colors.warn,
  action: colors.wrong,
};

function Fields({ pairs }: { pairs: { label: string; value: string }[] }) {
  return (
    <View style={styles.fields}>
      {pairs.map((pair, i) => (
        <View key={`${pair.label}-${i}`} style={styles.field}>
          <Text style={styles.fieldLabel}>{pair.label}</Text>
          <Text style={styles.fieldValue}>{pair.value}</Text>
        </View>
      ))}
    </View>
  );
}

function Table({ block, stacked }: { block: DocBlock; stacked: boolean }) {
  const columns = block.columns ?? [];
  const rows = block.rows ?? [];

  if (stacked) {
    return (
      <View style={{ gap: space.md }}>
        {block.caption ? <Text style={type.small}>{block.caption}</Text> : null}
        {rows.map((row, r) => (
          <View key={r} style={styles.stackedRow}>
            {/* The first cell heads the group: a reader hears "納期 — 4月22日"
                rather than a date with nothing attached to it. */}
            <Text style={styles.stackedHead}>{row[0]}</Text>
            <Fields
              pairs={columns.slice(1).map((label, c) => ({ label, value: row[c + 1] ?? "" }))}
            />
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.table}>
      {block.caption ? <Text style={type.small}>{block.caption}</Text> : null}
      <View style={[styles.tableRow, styles.tableHeadRow]}>
        {columns.map((column, i) => (
          <Text key={i} style={[styles.cell, styles.headCell]} accessibilityRole="header">
            {column}
          </Text>
        ))}
      </View>
      {rows.map((row, r) => (
        <View key={r} style={styles.tableRow}>
          {row.map((cell, c) => (
            <Text key={c} style={[styles.cell, c === 0 && styles.rowHeadCell]}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function Block({ block, stacked }: { block: DocBlock; stacked: boolean }) {
  switch (block.type) {
    case "heading":
      return <Text style={styles.heading}>{block.text}</Text>;
    case "paragraph":
      return <Text style={type.body}>{block.text}</Text>;
    case "bullets":
    case "numbered":
      return (
        <View style={{ gap: space.xs }}>
          {(block.items ?? []).map((entry, i) => (
            <View key={i} style={styles.listRow}>
              <Text style={styles.bullet}>{block.type === "numbered" ? `${i + 1}.` : "・"}</Text>
              <Text style={[type.body, { flex: 1 }]}>{entry}</Text>
            </View>
          ))}
        </View>
      );
    case "table":
      return <Table block={block} stacked={stacked} />;
    case "key_values":
      return <Fields pairs={block.pairs ?? []} />;
    case "quoted_message":
      return (
        <View style={[styles.quote, { marginLeft: Math.min(block.depth ?? 0, 3) * space.md }]}>
          <Text style={type.small}>
            {block.sender}
            {block.sent_at ? ` · ${block.sent_at}` : ""}
          </Text>
          <Text style={type.body}>{block.text}</Text>
        </View>
      );
    case "callout":
      return (
        <View
          style={[styles.callout, { borderLeftColor: TONE_COLOR[block.tone ?? "info"] }]}
          accessibilityRole="none"
        >
          <Text style={type.body}>{block.text}</Text>
        </View>
      );
    default:
      // An unknown block type drops rather than throwing. A learner is in the
      // middle of reading this; losing one paragraph beats losing the screen.
      return null;
  }
}

export function DocumentView({ doc }: { doc: StimulusDocument }) {
  const { width } = useWindowDimensions();
  const stacked = width < TABLE_MIN_WIDTH;

  return (
    <View
      style={styles.doc}
      accessible={false}
      accessibilityLabel={TEMPLATE_LABEL[doc.template] ?? doc.template}
    >
      <Text style={styles.kind}>{TEMPLATE_LABEL[doc.template] ?? doc.template}</Text>
      <Text style={styles.title}>{doc.title}</Text>
      {doc.meta?.length ? <Fields pairs={doc.meta} /> : null}
      <View style={styles.body}>
        {(doc.blocks ?? []).map((block, i) => (
          <Block key={i} block={block} stacked={stacked} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  doc: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: space.lg,
    gap: space.xs,
  },
  kind: { fontSize: 11, letterSpacing: 1, color: colors.muted },
  title: { fontSize: 17, fontWeight: "700", color: colors.text, lineHeight: 26 },
  body: { gap: space.md, marginTop: space.md },
  heading: { fontSize: 15, fontWeight: "700", color: colors.text, lineHeight: 24 },
  fields: { gap: space.xs, marginTop: space.sm },
  field: { flexDirection: "row", gap: space.sm, alignItems: "flex-start" },
  fieldLabel: { ...type.small, width: 72 },
  fieldValue: { ...type.body, fontSize: 14, lineHeight: 22, flex: 1 },
  listRow: { flexDirection: "row", gap: space.sm },
  bullet: { ...type.body, color: colors.muted, width: 22 },
  table: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  tableRow: { flexDirection: "row", borderTopWidth: 1, borderTopColor: colors.border },
  tableHeadRow: { borderTopWidth: 0, backgroundColor: colors.accentSoft },
  cell: { flex: 1, padding: space.sm, fontSize: 13, lineHeight: 20, color: colors.text },
  headCell: { fontWeight: "700", color: colors.muted },
  rowHeadCell: { fontWeight: "700" },
  stackedRow: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    padding: space.md,
  },
  stackedHead: { fontSize: 14, fontWeight: "700", color: colors.text },
  quote: {
    borderLeftWidth: 3,
    borderLeftColor: colors.border,
    paddingLeft: space.md,
    gap: space.xs,
  },
  callout: {
    borderLeftWidth: 3,
    backgroundColor: colors.accentSoft,
    borderRadius: radius.sm,
    padding: space.md,
  },
});
