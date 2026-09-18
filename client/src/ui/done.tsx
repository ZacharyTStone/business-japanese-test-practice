/**
 * The day is over. The one screen in the app that is a full stop.
 *
 * Fifteen answers in a day is the ceiling, and past it the database serves
 * nothing (see v_my_day and next_items). This screen is what that looks like
 * from the outside: not a card with a dimmer button under it, which still
 * reads as "more if you insist", but a friendly face and a sentence that
 * closes the day. Nothing here leads to a question, because there is none to
 * lead to. What it does say is when there will be: midnight in Japan, which
 * is when the streak counts a new day too.
 *
 * Shown on home once the ceiling is reached, and on the practice route if it
 * is opened past it — a deep link, a stale tab — so the door is the same
 * whichever way somebody walks up to it.
 */
import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useLang } from "../lib/i18n";
import { Button, Card } from "./components";
import { Face } from "./face";
import { Icon } from "./icons";
import { colors, radius, space, type } from "./theme";

export function DayDone({
  answered,
  streak,
  countdown,
  onHome,
}: {
  /** How many were answered today; the number this screen is closing on. */
  answered: number;
  streak: number;
  /** The exam countdown line, when a date is set. */
  countdown?: string;
  /** Only on routes that are not home: a way back, and nothing else. */
  onHome?: () => void;
}) {
  const { t } = useLang();
  return (
    <Card style={styles.card} accessibilityRole="summary" accessibilityLiveRegion="polite">
      <View style={styles.faceWrap}>
        <Face mood="happy" size={92} />
      </View>
      <Text style={styles.title}>{t("day_done_title")}</Text>
      <Text style={[type.body, styles.centre]}>{t("day_done_body", { n: answered })}</Text>

      <View style={styles.facts}>
        <View style={styles.fact}>
          <Icon name="check" size={16} color={colors.correct} strokeWidth={2.4} />
          <Text style={type.small}>{t("day_done_next")}</Text>
        </View>
        {streak > 0 ? (
          <View style={styles.fact}>
            <Icon name="flame" size={16} color={colors.warn} strokeWidth={2} />
            <Text style={type.small}>{t("streak_going", { n: streak })}</Text>
          </View>
        ) : null}
        {countdown ? (
          <View style={styles.fact}>
            <Icon name="target" size={16} color={colors.accent} strokeWidth={2} />
            <Text style={type.small}>{countdown}</Text>
          </View>
        ) : null}
      </View>

      {onHome ? <Button label={t("to_home")} tone="secondary" onPress={onHome} /> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { alignItems: "center", gap: space.lg, paddingVertical: space.xxl },
  faceWrap: {
    width: 124,
    height: 124,
    borderRadius: radius.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.correctSoft,
  },
  title: {
    fontSize: 24,
    fontWeight: "700",
    color: colors.text,
    lineHeight: 34,
    textAlign: "center",
  },
  centre: { textAlign: "center" },
  facts: { alignSelf: "stretch", gap: space.sm, alignItems: "center" },
  fact: { flexDirection: "row", alignItems: "center", gap: space.sm },
});
