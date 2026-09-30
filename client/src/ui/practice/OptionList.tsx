/**
 * The four answers, and what is said around them before one is chosen.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useLang, type Key } from "../../lib/i18n";
import { NUMBERS } from "../../lib/labels";
import type { QuestionView } from "../../lib/practice";
import type { ItemOption, QueuedItem } from "../../lib/types";
import { MiniPlay } from "../audio";
import { HAS_KEYBOARD } from "../keys";
import { FadeIn } from "../motion";
import { colors, radius, shadow, space, type } from "../theme";
import { VetoQuestion } from "../veto";
import { shared } from "./styles";

/** What to tell the learner to do. The act is the same everywhere, but the
 *  instruction is not: "最も適切な言い方" makes no sense for a reading item. */
const PROMPT_KEY: Record<string, Key> = {
  hatsugen_choukai: "prompt_hatsugen_choukai",
  gazou_haaku: "prompt_gazou_haaku",
  hyougen: "prompt_hyougen",
  goi_bunpou: "prompt_goi_bunpou",
  bamen_haaku: "prompt_bamen_haaku",
  sougou_choukai: "prompt_sougou_choukai",
  joukyou_haaku: "prompt_joukyou_haaku",
  shiryou_choudokkai: "prompt_shiryou_choudokkai",
  sougou_choudokkai: "prompt_sougou_choudokkai",
  sougou_dokkai: "prompt_sougou_dokkai",
};

export function OptionList({
  item,
  options,
  view,
  spokenOptions,
  optionsAsText,
  chosen,
  canVeto,
  onChoose,
  onPlay,
  onToggleText,
  onVetoed,
}: {
  item: QueuedItem;
  /** In position order. */
  options: ItemOption[];
  view: QuestionView;
  /** The four option clips, when the options are heard. */
  spokenOptions: string[] | null;
  optionsAsText: boolean;
  chosen: number | null;
  canVeto: boolean;
  onChoose: (index: number) => void;
  onPlay: () => void;
  onToggleText: () => void;
  onVetoed: () => void;
}) {
  const { t } = useLang();
  const { revealed, optionTextHidden, locked, stage } = view;
  return (
    <>
      {stage === "answer" ? (
        <Text style={[type.small, shared.hint]}>{t(PROMPT_KEY[item.item_type] ?? "prompt_default")}</Text>
      ) : null}

      {/* A shortcut nobody is told about is a shortcut nobody uses. One quiet
          line, only where there is a keyboard to press, and naming the key
          that works at this moment rather than both. */}
      {HAS_KEYBOARD && !revealed ? <Text style={[type.mono, shared.hint]}>{t("key_hint_answer")}</Text> : null}

      {spokenOptions !== null && stage === "answer" ? (
        <Pressable
          accessibilityRole="button"
          // Reading the spoken options is help the exam does not give, and the
          // reducer notes it (`peeked`) when it is turned on.
          onPress={onToggleText}
          style={({ pressed }) => [shared.link, pressed && { opacity: 0.85 }]}
        >
          <Text style={[type.small, shared.toggle]}>
            {optionsAsText ? t("hide_options_text") : t("show_options_text")}
          </Text>
        </Pressable>
      ) : null}

      <FadeIn key={`${item.id}-options`} style={{ gap: space.md }}>
        {options.map((option, i) => (
          <OptionCard
            key={option.position}
            index={i}
            text={option.text}
            textHidden={optionTextHidden}
            spokenUrl={spokenOptions !== null && !revealed ? spokenOptions[i] : null}
            revealed={revealed}
            chosen={chosen === i}
            answer={i === item.correct_index}
            locked={locked}
            onChoose={onChoose}
            onPlay={onPlay}
          />
        ))}
      </FadeIn>

      {/* Before the answer, not after — the opposite of the report button and
          for the same reason. A report is about a question you engaged with; a
          veto is about one you have decided not to. */}
      {canVeto && !revealed && chosen === null ? (
        <VetoQuestion key={`${item.id}-veto`} itemId={item.id} onVetoed={onVetoed} />
      ) : null}
    </>
  );
}

/**
 * One of the four answers.
 *
 * Its own component, and memoised, for two reasons. The pointer over it is its
 * own state: held on the screen, every hover in and out redrew the documents
 * and the chart above. And a spoken option's play button sits *beside* the
 * answer rather than inside it — nested, a screen reader could not reach the
 * inner button at all, and "play 1" answered 1. Side by side they are two
 * controls, each saying what it does.
 */
const OptionCard = React.memo(function OptionCard({
  index,
  text,
  textHidden,
  spokenUrl,
  revealed,
  chosen,
  answer,
  locked,
  onChoose,
  onPlay,
}: {
  index: number;
  text: string;
  /** A spoken option before the answer: the number, and no words. */
  textHidden: boolean;
  /** The option's clip, while it may be played before answering. */
  spokenUrl: string | null;
  revealed: boolean;
  chosen: boolean;
  answer: boolean;
  /** An answer is in, or on its way. */
  locked: boolean;
  onChoose: (index: number) => void;
  onPlay: () => void;
}) {
  const { t } = useLang();
  /** Under a pointer, on a machine that has one. */
  const [hovered, setHovered] = useState(false);
  const label = NUMBERS[index];
  const show = revealed && (chosen || answer);
  const dim = revealed && !show;
  const open = !revealed && !locked;
  const card = (
    <Pressable
      accessibilityRole="button"
      // One label for the whole option, so a screen reader says
      // "1. 承知いたしました" rather than reading a lone number and then a
      // sentence with nothing tying them together — and, once answered, says
      // which one this was. A spoken option says that pressing it answers:
      // the play button beside it is the one that plays.
      accessibilityLabel={
        (textHidden ? t("option_spoken", { label }) : `${label}. ${text}`) +
        (show ? ` — ${answer ? t("mark_correct") : t("mark_chosen")}` : "")
      }
      accessibilityState={{ disabled: revealed || locked }}
      disabled={revealed || locked}
      onPress={() => onChoose(index)}
      onHoverIn={() => setHovered(true)}
      onHoverOut={() => setHovered(false)}
      style={({ pressed }) => [
        styles.option,
        spokenUrl !== null && { flex: 1 },
        open && hovered && styles.optionHover,
        pressed && !revealed && { opacity: 0.85 },
        chosen && !revealed && styles.optionPending,
        show && (answer ? styles.optionCorrect : styles.optionWrong),
        // Set aside, not faded. After the answer these two are neither the
        // choice nor the key, and they step back by going flat and grey —
        // which leaves them legible, since "what were the other two?" is a
        // question worth being able to answer.
        dim && styles.optionAside,
      ]}
    >
      <View style={styles.optionHeader}>
        <View style={[styles.numberBadge, show && (answer ? styles.numberBadgeCorrect : styles.numberBadgeWrong)]}>
          <Text style={[styles.number, show && { color: answer ? colors.correct : colors.wrong }]}>{label}</Text>
        </View>
        {show ? (
          // A word as well as a colour: the marker has to survive being read
          // by someone who cannot tell the green from the red.
          <Text style={[type.small, { color: answer ? colors.correct : colors.wrong, fontWeight: "700" }]}>
            {answer ? t("mark_correct") : t("mark_chosen")}
          </Text>
        ) : null}
      </View>
      {textHidden ? null : <Text style={[type.option, dim && { color: colors.muted }]}>{text}</Text>}
    </Pressable>
  );
  if (spokenUrl === null) return card;
  return (
    <View style={styles.optionRow}>
      <MiniPlay url={spokenUrl} label={t("play_option", { label })} onPlay={onPlay} />
      {card}
    </View>
  );
});

const styles = StyleSheet.create({
  option: {
    backgroundColor: colors.surface,
    borderWidth: 2,
    borderColor: "transparent",
    borderRadius: radius.lg,
    padding: space.lg,
    gap: space.xs,
    ...shadow.card,
  },
  optionHeader: { flexDirection: "row", alignItems: "center", gap: space.sm },
  optionRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  optionAside: { backgroundColor: colors.surfaceAlt, borderColor: colors.border },
  // A pointer over an option that can still be chosen: the card lifts and its
  // edge takes the soft accent, which is "this one, if you press" without
  // the full border that means "this one, pressed".
  optionHover: { borderColor: colors.accentSoft, ...shadow.cardRaised },
  optionPending: { borderColor: colors.accent },
  optionCorrect: { borderColor: colors.correct, backgroundColor: colors.correctSoft },
  optionWrong: { borderColor: colors.wrong, backgroundColor: colors.wrongSoft },
  // A floor, not a size: at a large text setting the numeral grows and the
  // badge grows with it rather than cropping it.
  numberBadge: {
    minWidth: 26,
    minHeight: 26,
    paddingHorizontal: 4,
    borderRadius: 9,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.accentSoft,
  },
  numberBadgeCorrect: { backgroundColor: "rgba(14,159,110,0.16)" },
  numberBadgeWrong: { backgroundColor: "rgba(217,58,75,0.16)" },
  number: { fontSize: 13, fontWeight: "700", color: colors.accent },
});
