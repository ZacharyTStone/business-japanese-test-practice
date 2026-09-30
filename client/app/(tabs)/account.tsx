/**
 * The account screen: who is signed in, the three levels, the exam date, the
 * language. While the app is in testing everybody here is on the tester list,
 * or they would not have got past the door (ui/gate.tsx), so there is nothing
 * to link and nothing to explain about it.
 *
 * The levels are shown, not chosen — three of them, one per exam section,
 * because almost nobody is the same at listening and at reading. A section
 * reads 「—」 until the database says it has placed it: it has to serve
 * something from the first question, but a starting level is a placeholder and
 * printing it as a level says the app has concluded something it has not.
 *
 * The exam date is the only thing a person is asked for, and it is a date, not
 * a rounding of one. It is asked here rather than on first launch: a countdown
 * helps, a form on the first screen does not.
 */
import { useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import {
  fetchDay,
  fetchProfile,
  fetchSectionLevels,
  resetProgress,
  updateProfile,
} from "../../src/lib/db";
import { countdownLine, daysUntil, formatExamDate, todayIso } from "../../src/lib/exam";
import { LANG_NAME, LANGS, useLang } from "../../src/lib/i18n";
import { SECTION_NAME, SECTION_ORDER, placedLevel } from "../../src/lib/levels";
import { settingSaver, type SettingSaver } from "../../src/lib/save";
import type { DayStatus, Profile, SectionLevel } from "../../src/lib/types";
import {
  Button,
  Card,
  Chip,
  DateField,
  IconBadge,
  InlineError,
  Loading,
  LoadFailed,
  Notice,
  NumberField,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
} from "../../src/ui/components";
import { ScreenGate } from "../../src/ui/screen";
import { useTabClearance } from "../../src/ui/tabbar";
import { colors, space, type } from "../../src/ui/theme";

/** The cards a save can fail under, so the failure is said in the card whose
 *  control it came from. */
type SettingCard = "exam" | "goal" | "timer" | "reset";

type Savers = {
  exam: SettingSaver<string | null>;
  goal: SettingSaver<number>;
  timer: SettingSaver<boolean>;
};

/** Behind the setup notice when no project is configured (ui/screen.tsx). */
export default function AccountScreen() {
  return (
    <ScreenGate>
      <Account />
    </ScreenGate>
  );
}

function Account() {
  const clearance = useTabClearance();
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const { email, session, signOut } = useAuth();
  // Read by the savers when they write, so they never hold on to a stale one.
  const userId = useRef<string | null>(null);
  userId.current = session?.user.id ?? null;
  const [profile, setProfile] = useState<Profile | null>(null);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  /** Only read for one thing here: whether this account may size its own day,
   *  which is `goal_max` being a number rather than null. */
  const [day, setDay] = useState<DayStatus | null>(null);
  const [profileError, setProfileError] = useState<unknown>(null);
  /** A write that failed, and the card it is said in. */
  const [failed, setFailed] = useState<{ card: SettingCard; error: unknown } | null>(null);
  const [reloads, setReloads] = useState(0);
  /** Starting again, in three states: closed, asked, and done saying so. One
   *  press is not enough for something that cannot be undone, and a dialog box
   *  would be a screen explaining a feature — so the card asks in place. */
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState<number | null>(null);

  // One saver per setting, made once (lib/save.ts): a press shows at once,
  // there is never more than one write out, the last press is the one
  // written, and a write that fails puts the setting back to what the
  // database holds and says so in its own card. Their callbacks reach only
  // for state setters, which React keeps stable, and the user id through its
  // ref.
  const savers = useRef<Savers | null>(null);
  if (savers.current === null) {
    const write = (patch: Parameters<typeof updateProfile>[1]) =>
      userId.current ? updateProfile(userId.current, patch) : Promise.reject(new Error("not signed in"));
    const failedIn = (card: SettingCard) => (error: unknown) => setFailed({ card, error });
    savers.current = {
      exam: settingSaver<string | null>({
        write: (exam_date) => write({ exam_date }),
        show: (exam_date) => setProfile((p) => (p ? { ...p, exam_date } : p)),
        failed: failedIn("exam"),
      }),
      // The day's size, for the one account that may choose it. The bound
      // comes from the database (`v_my_day.goal_max`) and the database checks
      // it again on the way in — the field is drawn from the answer, not
      // trusted with it — so a failure here is a real refusal and is shown
      // rather than swallowed.
      goal: settingSaver<number>({
        write: (daily_goal) => write({ daily_goal }),
        show: (daily_goal) => setProfile((p) => (p ? { ...p, daily_goal } : p)),
        // Home reads the goal from v_my_day, so keep the copy this screen is
        // holding in step rather than showing yesterday's number until a reload.
        saved: (goal) => setDay((d) => (d ? { ...d, goal } : d)),
        failed: failedIn("goal"),
      }),
      timer: settingSaver<boolean>({
        write: (timed_reading) => write({ timed_reading }),
        show: (timed_reading) => setProfile((p) => (p ? { ...p, timed_reading } : p)),
        failed: failedIn("timer"),
      }),
    };
  }
  const save = savers.current;

  /** A press on one card's control: its old failure, if any, is history. */
  function press<T>(card: SettingCard, saver: SettingSaver<T>, value: T) {
    setFailed((f) => (f?.card === card ? null : f));
    saver.set(value);
  }

  // Read on every visit, not once: a set finished since the last visit may
  // have moved a level, and this screen is where the three are printed.
  useFocusEffect(
    useCallback(() => {
        let cancelled = false;
      fetchProfile()
        .then((p) => {
          if (cancelled) return;
          // A save still out wins over a read that may have left before it.
          if (save.exam.busy() || save.goal.busy() || save.timer.busy()) return;
          if (p) {
            save.exam.confirm(p.exam_date);
            save.goal.confirm(p.daily_goal);
            save.timer.confirm(p.timed_reading);
          }
          setProfile(p);
        })
        .catch((e) => !cancelled && setProfileError(e ?? "error"));
      // Not fatal: with no levels every section reads 「—」, which is what an
      // unplaced section says anyway.
      fetchSectionLevels()
        .then((lv) => !cancelled && setLevels(lv))
        .catch(() => !cancelled && setLevels([]));
      // Not fatal either: with no row the set-size card is simply absent, which
      // is what almost every account sees anyway.
      fetchDay()
        .then((d) => !cancelled && setDay(d))
        .catch(() => !cancelled && setDay(null));
      return () => {
        cancelled = true;
      };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `reloads` is the retry: bumping it is what reads again
    }, [reloads, save])
  );

  async function wipe() {
    if (wiping) return;
    setWiping(true);
    setFailed(null);
    try {
      const counts = await resetProgress();
      setConfirming(false);
      setWiped(counts.attempts);
      // The levels on this screen are now the starting default and the profile
      // carries a new summary, so re-read both rather than leaving the old
      // numbers on screen under a line saying they are gone.
      setReloads((n) => n + 1);
    } catch (e) {
      setFailed({ card: "reset", error: e });
    } finally {
      setWiping(false);
    }
  }

  function retry() {
    setProfileError(null);
    setReloads((n) => n + 1);
  }

  if (profileError != null) {
    return (
      <ScreenMessage>
        <LoadFailed error={profileError} onRetry={retry} />
      </ScreenMessage>
    );
  }
  if (!profile) return <Loading />;

  const days = daysUntil(profile.exam_date);
  const countdown = countdownLine(days, lang);

  return (
    <ScrollView contentContainerStyle={[styles.page, { paddingBottom: clearance }]}>
      <ScreenHeader title={t("tab_account")} subtitle={email ?? undefined} />

      <Card style={{ gap: space.md }}>
        <View style={styles.head}>
          <IconBadge name="check" tone="teal" />
          <View style={{ flex: 1 }}>
            <Text style={type.h2}>{t("acc_signed_in")}</Text>
            <Text style={type.small}>{email ?? t("acc_google")}</Text>
          </View>
        </View>
      </Card>

      <View style={{ gap: space.md }}>
        <SectionLabel>{t("acc_level")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="layers" tone="blue" />
            <View style={{ flex: 1, gap: space.xs }}>
              {SECTION_ORDER.map((section) => (
                <View key={section} style={styles.levelRow}>
                  <Text style={[type.body, { flex: 1 }]}>{t(SECTION_NAME[section])}</Text>
                  <Text style={type.stat}>{placedLevel(levels, section) ?? "—"}</Text>
                </View>
              ))}
            </View>
          </View>
        </Card>
      </View>

      <View style={{ gap: space.md }}>
        <SectionLabel>{t("acc_exam")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="clock" tone="amber" />
            <View style={{ flex: 1 }}>
              <Text style={type.h2}>
                {profile.exam_date ? formatExamDate(profile.exam_date, lang) : t("acc_exam_unset")}
              </Text>
              {countdown ? <Text style={type.small}>{countdown}</Text> : null}
            </View>
          </View>
          <DateField
            value={profile.exam_date}
            onChange={(date) => press("exam", save.exam, date)}
            placeholder={t("acc_exam_placeholder")}
            min={todayIso()}
            accessibilityLabel={t("acc_exam")}
          />
          {profile.exam_date ? (
            <View style={styles.chips}>
              <Chip label={t("clear")} selected={false} onPress={() => press("exam", save.exam, null)} />
            </View>
          ) : null}
          {failed?.card === "exam" ? <InlineError error={failed.error} /> : null}
          {/* What the date is for, beyond the countdown: the ladder brings
              every review in ahead of it, and the last two weeks are set in
              the exam's own proportions. Said once, here, where it is set. */}
          <Text style={type.small}>{t("acc_exam_sub")}</Text>
        </Card>
      </View>

      {/* How long a sitting is, for the one account the database says may say
          so: `goal_max` is null for everybody else and this card is not drawn
          at all. It is on the same side of the line as the reading clock —
          how you practise, not what you are served — and `next_items()` takes
          a size and decides the rest from the record. */}
      {day?.goal_max != null ? (
        <View style={{ gap: space.md }}>
          <SectionLabel>{t("acc_setsize")}</SectionLabel>
          <Card style={{ gap: space.md }}>
            <View style={styles.head}>
              <IconBadge name="layers" tone="teal" />
              <Text style={[type.small, { flex: 1 }]}>{t("acc_setsize_body")}</Text>
            </View>
            <NumberField
              value={profile.daily_goal}
              onChange={(n) => press("goal", save.goal, n)}
              min={1}
              max={day.goal_max}
              accessibilityLabel={t("acc_setsize_label", { max: day.goal_max })}
            />
            {failed?.card === "goal" ? <InlineError error={failed.error} /> : null}
            <Text style={type.small}>{t("acc_setsize_sub", { max: day.goal_max })}</Text>
          </Card>
        </View>
      ) : null}

      {/* The other thing about how somebody practises, rather than about which
          questions they get: the queue has never heard of it. On by default,
          because the reading block is timed whether or not it was practised
          that way. */}
      <View style={{ gap: space.md }}>
        <SectionLabel>{t("acc_timer")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="clock" tone="violet" />
            <Text style={[type.small, { flex: 1 }]}>{t("acc_timer_body")}</Text>
          </View>
          <View style={styles.chips}>
            <Chip
              label={t("acc_timer_on")}
              selected={profile.timed_reading}
              onPress={() => press("timer", save.timer, true)}
            />
            <Chip
              label={t("acc_timer_off")}
              selected={!profile.timed_reading}
              onPress={() => press("timer", save.timer, false)}
            />
          </View>
          {failed?.card === "timer" ? <InlineError error={failed.error} /> : null}
          <Text style={type.small}>{t("acc_timer_sub")}</Text>
          <Text style={type.small}>{t("acc_timer_exam")}</Text>
        </Card>
      </View>

      <View style={{ gap: space.md }}>
        <SectionLabel>{t("acc_lang")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.chips}>
            {LANGS.map((candidate) => (
              <Chip
                key={candidate}
                label={LANG_NAME[candidate]}
                selected={lang === candidate}
                onPress={() => setLang(candidate)}
              />
            ))}
          </View>
          <Text style={type.small}>{t("acc_lang_sub")}</Text>
        </Card>
      </View>

      {/* Everything the app knows about somebody is derived from their answers,
          so this one button is the whole of it: the three levels, the spacing
          ladder, the weakness arithmetic and today's count all follow from the
          rows it removes. The database does the removing — the client has no
          delete policy on an answer and is not getting one. */}
      <View style={{ gap: space.md }}>
        <SectionLabel>{t("acc_reset")}</SectionLabel>
        <Card style={{ gap: space.md }}>
          <View style={styles.head}>
            <IconBadge name="alert" tone="amber" />
            <Text style={[type.small, { flex: 1 }]}>{t("acc_reset_body")}</Text>
          </View>
          <Text style={type.small}>{t("acc_reset_keeps")}</Text>
          {confirming ? (
            <>
              <Text style={[type.body, { color: colors.wrong }]}>{t("acc_reset_confirm")}</Text>
              {/* The one red button in the app, and only once it has been
                  asked for: the press after this one is the one that erases. */}
              <Button
                label={wiping ? t("acc_reset_busy") : t("acc_reset_do")}
                tone="danger"
                disabled={wiping}
                onPress={wipe}
              />
              <Button label={t("cancel")} tone="secondary" disabled={wiping} onPress={() => setConfirming(false)} />
            </>
          ) : (
            <Button
              label={t("acc_reset")}
              tone="secondary"
              onPress={() => {
                setWiped(null);
                setConfirming(true);
              }}
            />
          )}
          {wiped !== null ? (
            <Text style={type.small} accessibilityLiveRegion="polite">
              {t("acc_reset_done", { n: wiped })}
            </Text>
          ) : null}
          {failed?.card === "reset" ? <InlineError error={failed.error} /> : null}
        </Card>
      </View>

      <Notice title={t("acc_noscore_title")} body={t("acc_noscore_body")} />

      <Button
        label={t("logout")}
        tone="secondary"
        onPress={async () => {
          await signOut();
          router.replace("/");
        }}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  levelRow: { flexDirection: "row", alignItems: "center", gap: space.md },
  page: { paddingHorizontal: space.lg, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
