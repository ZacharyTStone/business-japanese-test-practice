/**
 * The last moment of a question: the other person's face, one sentence about
 * what happened, the way on — and the explanation open under it, folded only
 * by whoever does not want it.
 */
import { useRef } from "react";
import { AccessibilityInfo, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import { useLang } from "../../lib/i18n";
import { NUMBERS } from "../../lib/labels";
import type { QuestionView, Verdict } from "../../lib/practice";
import { roleInfo, verdictFor } from "../../lib/roles";
import type { ItemOption, QueuedItem } from "../../lib/types";
import { MiniPlay, Transcript } from "../audio";
import { Button, Card } from "../components";
import { Face, moodFor, moodLabel } from "../face";
import { HAS_KEYBOARD } from "../keys";
import { RudenessMeter } from "../meters";
import { FadeIn } from "../motion";
import { ReportQuestion } from "../report";
import { colors, space, type } from "../theme";
import { shared } from "./styles";
import type { SendError } from "./usePostAnswer";

export function VerdictPanel({
  item,
  options,
  graded,
  view,
  chosen,
  spokenOptions,
  narrationUrl,
  showDetails,
  sendError,
  nextLabel,
  onToggleDetails,
  onResend,
  onNext,
  onArrive,
}: {
  item: QueuedItem;
  /** In position order. */
  options: ItemOption[];
  graded: Verdict;
  view: QuestionView;
  chosen: number | null;
  spokenOptions: string[] | null;
  narrationUrl: string | null;
  showDetails: boolean;
  /** The database's error on this answer, when it gave one. */
  sendError: SendError | null;
  nextLabel: string;
  onToggleDetails: () => void;
  onResend: () => void;
  onNext: () => void;
  /** Told once where the verdict landed, so the screen can bring it into view. */
  onArrive: (y: number) => void;
}) {
  const { lang, t } = useLang();
  // Around the Next button under the verdict, to put the keyboard's focus there
  // on the web.
  const nextWrap = useRef<View>(null);
  // onLayout fires again when the explanation is unfolded; the verdict arrives
  // once.
  const arrived = useRef(false);

  const { role, kind } = view;
  // The clock took it. Not a wrong answer about the Japanese, so the screen says
  // something different and the 失礼度メーター stays out of it: nobody was
  // offended, because nobody said anything.
  const ranOut = kind === "time";
  const mood = moodFor(role, graded.isCorrect);
  // Whether there is a listener's face to show. A misread table, a picture
  // looked at wrongly, a question the clock took: nobody heard anything, so
  // nobody is puzzled or pleased, and a face would be a sentence about
  // manners where the mistake was about reading.
  const faceShown = kind === "right" || kind === "manner";
  const correctOption = options[item.correct_index];
  const explanation = lang === "en" && item.explanation_en ? item.explanation_en : item.explanation_ja;
  const title = graded.isCorrect
    ? t("correct_title")
    : ranOut
      ? t("time_up")
      : verdictFor(role, item.listener_role, lang);
  // The one line under the verdict. For a right answer it is why that option
  // fits — and the per-option `why` is written in Japanese only, so in English
  // the item's own gloss is the sentence that exists. Wrong answers get the
  // listener's reaction instead, which is already translated — or, where there
  // is no listener to react, the name of the mistake.
  const sub = graded.isCorrect
    ? lang === "en" && item.explanation_en
      ? item.explanation_en
      : (correctOption?.why ?? "")
    : ranOut
      ? t("time_up_sub")
      : faceShown
        ? moodLabel(mood, lang)
        : roleInfo(role, lang).label;
  const correctIs = t("correct_is", { n: NUMBERS[item.correct_index] ?? "" });
  // What the explanation card below will show as heard; the same two values
  // it is given, so the toggle names the script exactly when there is one.
  const turns = view.dialogueAsText ? [] : (item.dialogue ?? []);
  const narration = view.stemAsText ? null : { text: item.stem, url: narrationUrl };
  const hasScript = turns.length > 0 || narration !== null;
  // The verdict as one sentence to be spoken: what happened, the line under it,
  // which one was right, and whether it is in the record yet.
  const spoken = [title, sub, graded.isCorrect ? "" : correctIs, graded.saved ? "" : t("unsent_short")]
    .filter(Boolean)
    .join("\n");

  return (
    <FadeIn
      style={{ gap: space.lg }}
      // Put the verdict at the top of the screen rather than wherever the
      // option happened to be. onLayout fires with the y it lands at, which is
      // the only number that is right on every item length.
      onLayout={(e) => {
        if (arrived.current) return;
        arrived.current = true;
        onArrive(e.nativeEvent.layout.y);
        // Said, where the card's live region is not heard: iOS has none.
        if (Platform.OS === "ios") AccessibilityInfo.announceForAccessibility(spoken);
        // On the web the keyboard's focus goes to Next, so Enter does what the
        // hint says whatever was clicked to answer — and a screen reader lands
        // on the way on. Not scrolled to: the verdict is.
        if (Platform.OS === "web") {
          const node = nextWrap.current as unknown as HTMLElement | null;
          const button = node?.querySelector?.<HTMLElement>('[role="button"]');
          button?.focus({ preventScroll: true });
        }
      }}
    >
      <Card
        // Said out loud the moment it appears: without this, answering with a
        // screen reader on changes the colours and announces nothing. A live
        // region is heard on Android and the web; iOS has none, and is told the
        // same thing in words when the card lands (above).
        accessibilityLiveRegion="polite"
        style={{
          gap: space.md,
          backgroundColor: graded.isCorrect ? colors.correctSoft : colors.wrongSoft,
        }}
      >
        <View style={styles.verdictRow}>
          {faceShown ? <Face mood={mood} size={68} /> : null}
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={[type.h2, graded.isCorrect && { color: colors.correct }]}>{title}</Text>
            <Text style={type.small}>{sub}</Text>
            {/* Which one it was, in so many words: the marked cards are above,
                scrolled out of sight by the move to this card. */}
            {graded.isCorrect ? null : (
              <Text style={[type.small, { color: colors.correct, fontWeight: "700" }]}>{correctIs}</Text>
            )}
          </View>
        </View>
        {!graded.isCorrect && !ranOut ? <RudenessMeter role={role} showLabel={false} /> : null}
        {/* Not yet in the record. Said on the card, because the verdict above is
            the phone's reading of the key until the database has it. */}
        {!graded.saved && sendError ? (
          <View style={{ gap: space.xs }}>
            <Text style={[type.small, { color: colors.wrong, fontWeight: "700" }]}>{t("send_failed")}</Text>
            <Text style={type.small}>{sendError.message}</Text>
            {sendError.detail ? <Text style={type.mono}>{sendError.detail}</Text> : null}
            <Button label={t("send_retry")} tone="secondary" disabled={sendError.busy} onPress={onResend} />
          </View>
        ) : !graded.saved ? (
          <Text style={[type.small, { fontWeight: "700" }]}>{t("unsent_offline")}</Text>
        ) : null}
        {/* Why this question was here, said once it can no longer be a hint: a
            類題 re-tests a trap that caught them before. */}
        {item.stands_for ? (
          <Text style={type.small}>
            {item.lesson_trap
              ? t("retest_note_trap", { trap: roleInfo(item.lesson_trap, lang).label })
              : t("retest_note")}
          </Text>
        ) : null}
      </Card>

      {/* The way on, once, right under the verdict: the explanation below can
          be long, and the screen scrolls to the verdict when it lands. */}
      <View ref={nextWrap}>
        <Button
          label={nextLabel}
          // The other half of the keyboard hint, where the key it names is the
          // one that does something.
          sub={HAS_KEYBOARD ? t("key_hint_next") : undefined}
          icon="chevron"
          onPress={onNext}
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
        onPress={onToggleDetails}
        style={({ pressed }) => [shared.link, pressed && { opacity: 0.85 }]}
      >
        <Text style={[type.small, shared.toggle]}>
          {hasScript
            ? showDetails ? t("details_close_script") : t("details_open_script")
            : showDetails ? t("details_close") : t("details_open")}
        </Text>
      </Pressable>

      {showDetails ? (
        <ExplanationCard
          item={item}
          options={options}
          chosen={chosen}
          spokenOptions={spokenOptions}
          // Skipped when the verdict line above already is it, which is the
          // English case for a right answer.
          explanation={explanation === sub ? null : explanation}
          turns={turns}
          narration={narration}
        />
      ) : null}

      {/* Every question gets one, and it is the last thing on the card: a
          report is worth making at the moment the oddness is still in view,
          and worth nobody's attention before then. */}
      <ReportQuestion key={`${item.id}-report`} itemId={item.id} />
    </FadeIn>
  );
}

/** Why each option is right or wrong, the words to know, and what was heard. */
function ExplanationCard({
  item,
  options,
  chosen,
  spokenOptions,
  explanation,
  turns,
  narration,
}: {
  item: QueuedItem;
  options: ItemOption[];
  chosen: number | null;
  spokenOptions: string[] | null;
  /** The item's explanation, or null when the verdict line already said it. */
  explanation: string | null;
  /** What was heard, a line at a time. Text-only narration is already on the
   *  card above, and a dialogue with no clips is already there as a script, so
   *  neither is repeated here. */
  turns: QueuedItem["dialogue"];
  narration: { text: string; url: string | null } | null;
}) {
  const { t } = useLang();
  return (
    <Card style={{ gap: space.md }}>
      {explanation ? <Text style={type.body}>{explanation}</Text> : null}
      <View style={{ gap: space.sm }}>
        {options.map((option, i) => {
          // The same two marks as the cards above and the review screen,
          // because this list is where a miss is read and the cards are by now
          // off the top of the screen.
          const isAnswer = i === item.correct_index;
          const isChosen = i === chosen && !isAnswer;
          return (
            <View key={option.position} style={styles.whyRow}>
              {/* A spoken option can be heard again beside its text: the right
                  one is the sentence worth saying out loud. */}
              {spokenOptions ? (
                <MiniPlay url={spokenOptions[i]} label={t("play_option", { label: NUMBERS[i] })} />
              ) : null}
              <View style={[styles.why, { flex: 1 }]}>
                <Text style={[type.small, { fontWeight: "700", color: colors.text }]}>
                  {NUMBERS[i]}　{option.text}
                </Text>
                {isAnswer || isChosen ? (
                  <Text
                    style={[type.small, { fontWeight: "700", color: isAnswer ? colors.correct : colors.wrong }]}
                  >
                    {isAnswer ? t("mark_correct") : t("mark_chosen")}
                  </Text>
                ) : null}
                <Text style={type.small}>{option.why}</Text>
              </View>
            </View>
          );
        })}
      </View>
      {item.vocab_notes?.length ? (
        <View style={{ gap: space.xs }}>
          {item.vocab_notes.map((note) => (
            <Text key={note.term} style={type.small}>
              {note.term}（{note.reading}）— {note.meaning}
            </Text>
          ))}
        </View>
      ) : null}
      <Transcript turns={turns} narration={narration} />
    </Card>
  );
}

const styles = StyleSheet.create({
  verdictRow: { flexDirection: "row", alignItems: "center", gap: space.lg },
  why: { gap: 2 },
  whyRow: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
});
