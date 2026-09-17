/**
 * The door, while the app is in testing.
 *
 * Two screens, and neither explains the app — that is the welcome screen's
 * job, and it has already happened by the time either of these shows.
 *
 *   SignInScreen  there is no session. One button: Google.
 *   ClosedScreen  there is a session, and the database says this account is
 *                 not on the tester list. Says which account, so a person who
 *                 signed in with the wrong one can see that, and offers the
 *                 way out.
 *
 * Neither screen is what keeps anybody out. Every row-level policy requires
 * the same check the database makes here, so a client that skipped these
 * screens would see nothing anyway. They exist to say so politely.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { useAuth } from "../lib/auth";
import { useLang } from "../lib/i18n";
import { Button, IconBadge, ScreenMessage } from "./components";
import { colors, space, type } from "./theme";

export function SignInScreen() {
  const { t } = useLang();
  const { signInWithGoogle, error: authError } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withGoogle() {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("gate_title")}</Text>
        <Text style={type.small}>{t("gate_body")}</Text>
        <Button
          label={busy ? t("wel_google_busy") : t("wel_google")}
          icon="user"
          disabled={busy}
          onPress={withGoogle}
        />
        {error ?? authError ? (
          <Text style={[type.small, { color: colors.wrong }]}>{error ?? authError}</Text>
        ) : null}
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
  card: { gap: space.md, alignItems: "flex-start" },
});
