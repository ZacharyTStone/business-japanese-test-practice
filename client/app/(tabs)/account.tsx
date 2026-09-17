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
import { fetchProfile, fetchSectionLevels, updateProfile } from "../../src/lib/db";
import { countdownLine, daysUntil, formatExamDate, todayIso } from "../../src/lib/exam";
import { LANG_NAME, LANGS, useLang } from "../../src/lib/i18n";
import { SECTION_NAME, SECTION_ORDER, placedLevel } from "../../src/lib/levels";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../../src/lib/supabase";
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
  const { email, signOut, loading: authLoading, error: authError } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [levels, setLevels] = useState<SectionLevel[]>([]);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    if (!isConfigured || authLoading || authError) return;
    fetchProfile()
      .then(setProfile)
      .catch((e) => setProfileError(e instanceof Error ? e.message : String(e)));
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
      setError(e instanceof Error ? e.message : String(e));
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
        <Notice title={t("cant_connect")} body={authError} tone="warn" />
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
