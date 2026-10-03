/**
 * The door, while the app is in testing.
 *
 * Cloudflare Access is the sign-in, in front of the whole site, so the app has
 * no password form. Two screens are left, and neither explains the app — that
 * is the welcome screen's job, and it has already happened by the time either
 * of these shows.
 *
 *   SignInAgainScreen  the Access session ran out while the app was open. A
 *                 reload takes the learner through Access's sign-in and back.
 *   ClosedScreen  Access let this account in, and the database says it is not
 *                 on the tester list. Says which account, so a person who
 *                 signed in with the wrong one can see that, and offers the
 *                 way out.
 *
 * Neither screen is what keeps anybody out. Every row-level policy requires
 * the same check the database makes here, so a client that skipped these
 * screens would see nothing anyway. They exist to say so politely.
 */
import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../lib/auth";
import { useLang } from "../lib/i18n";
import { Button, IconBadge, ScreenMessage } from "./components";
import { space, type } from "./theme";

export function SignInAgainScreen() {
  const { t } = useLang();
  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("gate_title")}</Text>
        <Text style={type.small}>{t("err_session_expired")}</Text>
        <Button
          label={t("gate_sign_in")}
          icon="user"
          onPress={() => {
            if (Platform.OS === "web" && typeof window !== "undefined") window.location.reload();
          }}
        />
      </View>
    </ScreenMessage>
  );
}

export function ClosedScreen() {
  const { t } = useLang();
  const { email, signOut } = useAuth();
  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="clock" tone="amber" />
        <Text style={type.h2}>{t("closed_title")}</Text>
        <Text style={type.small}>{t("closed_body", { email: email ?? "?" })}</Text>
        <Button label={t("logout")} tone="secondary" onPress={signOut} />
      </View>
    </ScreenMessage>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md, alignItems: "stretch" },
});
