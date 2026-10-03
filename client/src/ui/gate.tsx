/**
 * The door, while the app is in testing.
 *
 * Cloudflare Access is the sign-in, in front of the whole site, so the app has
 * no password form. Two screens are left, and neither explains the app — that
 * is the welcome screen's job, and it has already happened by the time either
 * of these shows.
 *
 *   SignInAgainScreen  nobody is signed in: on the web, "Continue with Google"
 *                 (worker/auth.ts), and what went wrong if a sign-in came back
 *                 refused. While Access still stands in front of the site, an
 *                 Access session that ran out is the same screen, and a reload
 *                 takes the learner through Access's sign-in and back.
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
import { signInWithGoogle } from "../lib/authClient";
import { useLang } from "../lib/i18n";
import { signInRefusal } from "../lib/signin";
import { Button, IconBadge, ScreenMessage } from "./components";
import { space, type } from "./theme";

export function SignInAgainScreen() {
  const { t } = useLang();
  const { failure } = useAuth();
  const web = Platform.OS === "web" && typeof window !== "undefined";
  // Nobody signed in at all (the Worker's `signed_out`), rather than an Access
  // session that ran out: the Worker's own sign-in is the way in.
  const signedOut = (failure as { code?: unknown } | null)?.code === "signed_out";

  if (web && signedOut) {
    const refused = signInRefusal(window.location.search);
    const body = refused === "not_listed" ? "gate_refused" : refused === "failed" ? "gate_failed" : "gate_google_body";
    return (
      <ScreenMessage>
        <View style={styles.card}>
          <IconBadge name="user" tone="violet" />
          <Text style={type.h2}>{t("gate_title")}</Text>
          <Text style={type.small}>{t(body)}</Text>
          <Button label={t("gate_google")} icon="user" onPress={() => void signInWithGoogle()} />
        </View>
      </ScreenMessage>
    );
  }

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
            if (web) window.location.reload();
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
