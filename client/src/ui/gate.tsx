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
 *                 On a native build, which has no page to reload, the same
 *                 sign-in opens in a browser tab (lib/nativeAuth.ts) — and it
 *                 is also the first screen there, before any sign-in at all.
 *   ClosedScreen  Access let this account in, and the database says it is not
 *                 on the tester list. Says which account, so a person who
 *                 signed in with the wrong one can see that, and offers the
 *                 way out.
 *
 * Neither screen is what keeps anybody out. Every row-level policy requires
 * the same check the database makes here, so a client that skipped these
 * screens would see nothing anyway. They exist to say so politely.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../lib/auth";
import { useLang } from "../lib/i18n";
import { Button, IconBadge, ScreenMessage } from "./components";
import { space, type } from "./theme";

export function SignInAgainScreen() {
  const { t } = useLang();
  const { failure, signIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  // A native build that has never signed in on this device is not "expired".
  const first = (failure as { code?: unknown } | null)?.code === "signed_out";

  async function onPress() {
    if (Platform.OS === "web") {
      if (typeof window !== "undefined") window.location.reload();
      return;
    }
    setBusy(true);
    setFailed(false);
    const result = await signIn();
    setBusy(false);
    // Signed in, the door opens by itself; a closed tab is no failure.
    setFailed(result === "failed");
  }

  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("gate_title")}</Text>
        <Text style={type.small}>{t(first ? "gate_first_body" : "err_session_expired")}</Text>
        <Button label={t("gate_sign_in")} icon="user" disabled={busy} onPress={() => void onPress()} />
        {failed ? <Text style={type.small}>{t("gate_failed")}</Text> : null}
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
