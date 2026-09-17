/**
 * The first screen anybody sees, and the only one in the app that explains
 * anything.
 *
 * It exists because the app's whole proposition is invisible: there is no level
 * picker, no section picker, no difficulty, no mode. A person who opens a study
 * app and is handed one button will assume it is a shallow app unless somebody
 * tells them that the choosing is being done for them. So this screen says the
 * three things that are true, in the order they matter:
 *
 *   1. the app works out your level from your answers;
 *   2. it aims the next questions at what you keep getting wrong;
 *   3. your part is to answer.
 *
 * Then it gets out of the way, once, for ever. The flag is on the device rather
 * than on the profile: it is about this copy of the app having been introduced,
 * not about who is holding it, and a person who reinstalls has forgotten the
 * explanation anyway.
 *
 * One button, which leads to the sign-in screen: while the app is in testing
 * the database admits nobody who is not on the tester list (see lib/auth.tsx),
 * so the explanation ends and the door is next.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang, type Key } from "../lib/i18n";
import { Button, IconBadge } from "./components";
import type { IconName } from "./icons";
import type { BadgeTone } from "./theme";
import { colors, space, type } from "./theme";

const STORAGE_KEY = "welcome_seen";

const POINTS: { icon: IconName; tone: BadgeTone; title: Key; body: Key }[] = [
  { icon: "spark", tone: "violet", title: "wel_p1_title", body: "wel_p1_body" },
  { icon: "target", tone: "pink", title: "wel_p2_title", body: "wel_p2_body" },
  { icon: "play", tone: "teal", title: "wel_p3_title", body: "wel_p3_body" },
];

type Welcome = { ready: boolean; seen: boolean; dismiss: () => void };

/**
 * Whether this device has been introduced to the app.
 *
 * `ready` is separate from `seen` so the root layout can hold still for one
 * frame rather than flashing the home screen at somebody who has never seen it.
 * Storage that throws — a private window, blocked site data — reads as "seen",
 * which shows the app rather than trapping a returning learner behind an
 * explanation they cannot dismiss.
 */
export function useWelcome(): Welcome {
  const [state, setState] = useState<{ ready: boolean; seen: boolean }>({
    ready: false,
    seen: false,
  });

  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (!cancelled) setState({ ready: true, seen: saved === "1" });
      })
      .catch(() => {
        if (!cancelled) setState({ ready: true, seen: true });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const dismiss = useCallback(() => {
    setState({ ready: true, seen: true });
    AsyncStorage.setItem(STORAGE_KEY, "1").catch(() => {
      // No storage: they see this once more next launch. Harmless.
    });
  }, []);

  return { ...state, dismiss };
}

export function WelcomeScreen({ onStart }: { onStart: () => void }) {
  const { t } = useLang();
  const insets = useSafeAreaInsets();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + space.xxl, paddingBottom: insets.bottom + space.xl },
      ]}
    >
      <View style={{ gap: space.sm }}>
        <Text style={type.label}>{t("wel_kicker")}</Text>
        <Text style={styles.title}>{t("wel_title")}</Text>
        <Text style={type.body}>{t("wel_lead")}</Text>
      </View>

      <View style={{ gap: space.lg }}>
        {POINTS.map((point) => (
          <View key={point.title} style={styles.point}>
            <IconBadge name={point.icon} tone={point.tone} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={type.h2}>{t(point.title)}</Text>
              <Text style={type.small}>{t(point.body)}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={{ gap: space.md }}>
        <Button label={t("wel_start")} icon="play" onPress={onStart} />
        <Text style={[type.small, styles.footnote]}>{t("wel_testers_note")}</Text>
        <Text style={[type.small, styles.footnote]}>{t("wel_honesty")}</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: {
    paddingHorizontal: space.lg,
    gap: space.xxl,
    backgroundColor: colors.bg,
    flexGrow: 1,
    justifyContent: "center",
  },
  title: { fontSize: 30, fontWeight: "700", color: colors.text, lineHeight: 42 },
  point: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  footnote: { textAlign: "center" },
});
