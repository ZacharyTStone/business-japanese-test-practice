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
import { useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../../src/lib/auth";
import { fetchProfile, fetchSectionLevels, resetProgress, updateProfile } from "../../src/lib/db";
import { countdownLine, daysUntil, formatExamDate, todayIso } from "../../src/lib/exam";
import { LANG_NAME, LANGS, useLang } from "../../src/lib/i18n";
import { SECTION_NAME, SECTION_ORDER, placedLevel } from "../../src/lib/levels";
import { errorText, isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
import type { Profile, SectionLevel } from "../../src/lib/types";
import {
  Button,
  Card,
  Chip,
  DateField,
  IconBadge,
  Loading,
  Notice,
  ScreenHeader,
  ScreenMessage,
  SectionLabel,
} from "../../src/ui/components";
import { colors, space, TAB_CLEARANCE, type } from "../../src/ui/theme";

export default function Account() {
  const router = useRouter();
  const { lang, setLang, t } = useLang();
  const {
    email,
    signOut,
    loading: authLoading,
    error: authError,
    retry: retryAuth,
  } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);
  /** Starting again, in three states: closed, asked, and done saying so. One
   *  press is not enough for something that cannot be undone, and a dialog box
   *  would be a screen explaining a feature — so the card asks in place. */
  const [confirming, setConfirming] = useState(false);
  const [wiping, setWiping] = useState(false);
  const [wiped, setWiped] = useState<number | null>(null);

  useEffect(() => {
    if (!isConfigured || authLoading || authError) return;
    fetchProfile()
      .then(setProfile)
      .catch((e) => setProfileError(errorText(e)));
    // Not fatal if it fails: with no levels every section reads 「—」, which is
    // a worse answer rather than a broken screen — and a safe one, since 「—」
    // is exactly what an unplaced section says anyway.
    fetchSectionLevels()
      .then(setLevels)
      .catch(() => setLevels([]));
  }, [authLoading, authError, reloads]);

  async function setExamDate(date: string | null) {
    setProfile((p) => (p ? { ...p, exam_date: date } : p));
    try {
      await updateProfile({ exam_date: date });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function setTimedReading(on: boolean) {
    setProfile((p) => (p ? { ...p, timed_reading: on } : p));
    try {
      await updateProfile({ timed_reading: on });
    } catch (e) {
      setError(errorText(e));
    }
  }

  async function wipe() {
    setWiping(true);
    setError(null);
    try {
      const counts = await resetProgress();
      setConfirming(false);
      setWiped(counts.attempts);
      // The levels on this screen are now the starting default and the profile
      // carries a new summary, so re-read both rather than leaving the old
      // numbers on screen under a line saying they are gone.
      setReloads((n) => n + 1);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setWiping(false);
    }
  }

  function retry() {
    setProfileError(null);
    setReloads((n) => n + 1);
  }

  if (!isConfigured) {
    return (
      <ScreenMessage>
        <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
      </ScreenMessage>
    );
  }
  if (authLoading) return <Loading />;
  if (authError) {
    return (
      <ScreenMessage>
        <Notice
          title={t("cant_connect")}
          body={authError}
          tone="warn"
          action={{ label: t("retry"), onPress: retryAuth }}
        />
      </ScreenMessage>
    );
  }
  if (profileError) {
    return (
      <ScreenMessage>
        <Notice
          title={t("cant_load")}
          body={profileError}
          tone="warn"
          action={{ label: t("retry"), onPress: retry }}
        />
      </ScreenMessage>
    );
  }
  if (!profile) return <Loading />;

  const days = daysUntil(profile.exam_date);
  const countdown = countdownLine(days, lang);

  return (
    <ScrollView contentContainerStyle={styles.page}>
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
            onChange={setExamDate}
            placeholder={t("acc_exam_placeholder")}
            min={todayIso()}
            accessibilityLabel={t("acc_exam")}
          />
          {profile.exam_date ? (
            <View style={styles.chips}>
              <Chip label={t("clear")} selected={false} onPress={() => setExamDate(null)} />
            </View>
          ) : null}
        </Card>
      </View>

      {/* The only thing in the app anybody chooses, and it is about how they
          practise rather than about which questions they get: the queue has
          never heard of it. On by default, because the reading block is timed
          whether or not it was practised that way. */}
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
              onPress={() => setTimedReading(true)}
            />
            <Chip
              label={t("acc_timer_off")}
              selected={!profile.timed_reading}
              onPress={() => setTimedReading(false)}
            />
          </View>
          <Text style={type.small}>{t("acc_timer_sub")}</Text>
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
              <Button
                label={wiping ? t("acc_reset_busy") : t("acc_reset_do")}
                tone="secondary"
                disabled={wiping}
                onPress={wipe}
              />
              <View style={styles.chips}>
                <Chip label={t("cancel")} selected={false} onPress={() => setConfirming(false)} />
              </View>
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
        </Card>
      </View>

      {error ? <Text style={[type.small, { color: colors.wrong }]}>{error}</Text> : null}

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
  page: { paddingHorizontal: space.lg, paddingBottom: TAB_CLEARANCE, gap: space.lg },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
