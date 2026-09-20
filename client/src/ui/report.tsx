/**
 * "This question is wrong" — on every question, and quiet until it is wanted.
 *
 * Every item in the bank was written by a model and passed by other models. That
 * catches a great deal, and what gets through is the item that is *defensible
 * but odd*: Japanese nobody would say, a situation that does not quite hang
 * together, a second option that is arguably as good. Nobody sees those except
 * the person meeting them one at a time, so this is where they say so.
 *
 * Three decisions:
 *
 * **It is a list of reasons, not a text box.** A box produces prose nobody
 * counts; a reason produces a number — "eleven 総合読解 items reported unnatural
 * this month" — and that is the shape the generator loop can act on. The
 * sentence underneath is for the part the categories cannot hold.
 *
 * **It appears after the answer, never before.** A report button beside the
 * options is a fifth thing to read while deciding, and an invitation to blame
 * the question for a question one has not answered yet.
 *
 * **A failure to send is said out loud.** The alternative — swallowing it, since
 * a report is not important — teaches somebody that reporting does nothing,
 * which is the one outcome that makes the feature worse than not having it.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { reportItem, type FeedbackReason } from "../lib/db";
import { useLang, type Key } from "../lib/i18n";
import { Chip } from "./components";
import { colors, radius, space, type } from "./theme";

/** The reasons, in the order they are offered. Audio comes last of the real
 *  ones because most items have none; `other` is always last. Must match the
 *  check constraint on `item_feedback.reason`. */
const REASONS: { id: FeedbackReason; key: Key }[] = [
  { id: "unnatural", key: "report_unnatural" },
  { id: "wrong_answer", key: "report_wrong_answer" },
  { id: "ambiguous", key: "report_ambiguous" },
  { id: "unclear", key: "report_unclear" },
  { id: "audio", key: "report_audio" },
  { id: "other", key: "report_other" },
];

type Stage = "shut" | "open" | "sending" | "sent" | "failed";

export function ReportQuestion({ itemId }: { itemId: string }) {
  const { t } = useLang();
  const [stage, setStage] = useState<Stage>("shut");
  const [reason, setReason] = useState<FeedbackReason | null>(null);
  const [note, setNote] = useState("");

  async function send() {
    if (!reason) return;
    setStage("sending");
    try {
      await reportItem({ itemId, reason, note });
      setStage("sent");
    } catch {
      // Which error it was does not change what the person can do about it, and
      // a Postgres message is not something to put in front of somebody
      // studying. Saying it failed, and that it can be tried again, is the whole
      // of the useful content.
      setStage("failed");
    }
  }

  if (stage === "sent") {
    return (
      <Text style={[type.small, styles.thanks]} accessibilityLiveRegion="polite">
        {t("report_thanks")}
      </Text>
    );
  }

  if (stage === "shut") {
    return (
      <Pressable
        accessibilityRole="button"
        onPress={() => setStage("open")}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Text style={[type.small, styles.toggle]}>{t("report_open")}</Text>
      </Pressable>
    );
  }

  const busy = stage === "sending";
  /** Whether the press does anything: a reason is chosen and nothing is in
   *  flight. One name, so the style below reads as a state and not as a sum. */
  const canSend = Boolean(reason) && !busy;
  return (
    <View style={styles.panel}>
      <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
        {t("report_title")}
      </Text>

      <View style={styles.chips}>
        {REASONS.map((r) => (
          <Chip
            key={r.id}
            label={t(r.key)}
            selected={reason === r.id}
            disabled={busy}
            onPress={() => setReason(r.id)}
          />
        ))}
      </View>

      <TextInput
        value={note}
        onChangeText={setNote}
        editable={!busy}
        placeholder={t("report_note")}
        placeholderTextColor={colors.muted}
        accessibilityLabel={t("report_note")}
        multiline
        // The column is capped at 500; stopping the typing at the same number is
        // kinder than a failed insert after somebody has written a paragraph.
        maxLength={500}
        style={styles.note}
      />

      {stage === "failed" ? (
        <Text style={[type.small, { color: colors.wrong }]} accessibilityLiveRegion="polite">
          {t("report_failed")}
        </Text>
      ) : null}

      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          onPress={() => setStage("shut")}
          disabled={busy}
          style={({ pressed }) => [pressed && { opacity: 0.85 }]}
        >
          <Text style={[type.small, styles.toggle]}>{t("report_close")}</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !canSend }}
          onPress={send}
          disabled={!canSend}
          style={({ pressed }) => [
            styles.send,
            // Drawn off rather than faded, as everywhere else: until a reason
            // is chosen this is not a button, and it should look like one that
            // is waiting rather than one that is half there.
            !canSend && styles.sendOff,
            pressed && canSend && { opacity: 0.85 },
          ]}
        >
          <Text style={[styles.sendText, !canSend && styles.sendTextOff]}>
            {busy ? t("report_sending") : t("report_send")}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { textAlign: "center", textDecorationLine: "underline" },
  thanks: { textAlign: "center" },
  panel: {
    gap: space.md,
    padding: space.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceAlt,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  note: {
    fontSize: 15,
    color: colors.text,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.md,
    minHeight: 64,
    textAlignVertical: "top",
  },
  actions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  send: {
    backgroundColor: colors.accentDeep,
    borderRadius: radius.pill,
    paddingHorizontal: space.xl,
    paddingVertical: space.md,
  },
  sendOff: { backgroundColor: colors.surfaceAlt, borderWidth: 1.5, borderColor: colors.border },
  sendText: { color: colors.onAccent, fontSize: 14, fontWeight: "700" },
  sendTextOff: { color: colors.muted },
});
