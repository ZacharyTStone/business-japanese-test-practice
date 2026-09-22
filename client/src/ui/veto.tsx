/**
 * "Take this question out of the bank" — one press, for everybody.
 *
 * This is the other half of `report.tsx`, and it is deliberately the opposite
 * shape. A report is an opinion: it is counted, somebody reads it later, and
 * the item keeps being served in the meantime, because an item that vanishes
 * on one press is a bank one press away from empty. A veto is the decision
 * itself, taken in the one moment when the evidence is in front of you.
 *
 * What keeps that safe is not the button, it is who has it. `may_i_veto()` is
 * false for every tester row by default and true for the owner's, and
 * `veto_item()` re-checks it rather than trusting the client that drew the
 * button. A tester sees the report button and nothing else.
 *
 * Three decisions:
 *
 * **It sits beside the options, before the answer.** The opposite of the report
 * button, and for the same reason: a report is about a question you have
 * engaged with, and a veto is about one you have decided not to. Waiting until
 * after the answer would mean answering a question you have already judged
 * broken, which is the thing being fixed.
 *
 * **It asks once.** Not a modal with a text field — that turns a one-press
 * decision into a form. One tap arms it, the second does it, and anything else
 * on screen disarms it. Undoing is `bjt publish` or one update; this is the app
 * being quick, not the app being the admin console.
 *
 * **Nothing is recorded against the learner.** Vetoing is instead of answering,
 * so no attempt is written, the day's ten is not spent, and the set simply gets
 * one shorter.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { vetoItem } from "../lib/db";
import { useLang } from "../lib/i18n";
import { colors, radius, space, type } from "./theme";

type Stage = "shut" | "armed" | "sending" | "failed";

export function VetoQuestion({
  itemId,
  onVetoed,
}: {
  itemId: string;
  /** Called once the item is out of the bank, so the set can move on. */
  onVetoed: () => void;
}) {
  const { t } = useLang();
  const [stage, setStage] = useState<Stage>("shut");

  async function confirm() {
    setStage("sending");
    try {
      await vetoItem(itemId);
      onVetoed();
    } catch {
      setStage("failed");
    }
  }

  if (stage === "shut" || stage === "failed") {
    return (
      <View style={styles.wrap}>
        <Pressable
          onPress={() => setStage("armed")}
          accessibilityRole="button"
          accessibilityLabel={t("veto_open")}
          style={styles.quiet}
        >
          <Text style={styles.quietText}>{t("veto_open")}</Text>
        </Pressable>
        {stage === "failed" ? <Text style={styles.failed}>{t("veto_failed")}</Text> : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.ask}>{t("veto_confirm")}</Text>
      <View style={styles.row}>
        <Pressable
          onPress={confirm}
          disabled={stage === "sending"}
          accessibilityRole="button"
          accessibilityLabel={t("veto_yes")}
          style={[styles.yes, stage === "sending" && styles.dim]}
        >
          <Text style={styles.yesText}>{t("veto_yes")}</Text>
        </Pressable>
        <Pressable
          onPress={() => setStage("shut")}
          accessibilityRole="button"
          accessibilityLabel={t("veto_cancel")}
          style={styles.no}
        >
          <Text style={styles.quietText}>{t("veto_cancel")}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: space.md, alignItems: "center", gap: space.xs },
  quiet: { paddingVertical: space.xs, paddingHorizontal: space.sm },
  quietText: { ...type.small, color: colors.muted },
  ask: { ...type.small, color: colors.text, textAlign: "center" },
  row: { flexDirection: "row", gap: space.sm },
  yes: {
    paddingVertical: space.xs,
    paddingHorizontal: space.md,
    borderRadius: radius.pill,
    backgroundColor: colors.wrong,
  },
  yesText: { ...type.small, color: colors.surface, fontWeight: "700" },
  no: { paddingVertical: space.xs, paddingHorizontal: space.md },
  dim: { opacity: 0.6 },
  failed: { ...type.small, color: colors.wrong },
});
