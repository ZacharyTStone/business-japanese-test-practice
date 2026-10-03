/**
 * The door, while the app is in testing.
 *
 * Google, through the Worker's own sign-in (worker/auth.ts), is the way in, so
 * the app has no password form. Two screens are left, and neither explains the
 * app — that is the welcome screen's job, and it has already happened by the
 * time either of these shows.
 *
 *   SignInAgainScreen  nobody is signed in: on the web, "Continue with Google",
 *                 and what went wrong if a sign-in came back refused. While
 *                 Access still stands in front of the site, an Access session
 *                 that ran out is the same screen, and a reload takes the
 *                 learner through Access's sign-in and back. On a phone,
 *                 Google's own account sheet (lib/phoneSignIn.ts).
 *   ClosedScreen  somebody is signed in, and the Worker says the address is
 *                 not on the tester list. Says which account, so a person who
 *                 signed in with the wrong one can see that, and offers the
 *                 way out.
 *
 * Neither screen is what keeps anybody out. The Worker refuses every query
 * from an address the list does not name, so a client that skipped these
 * screens would see nothing anyway. They exist to say so politely.
 */
import React, { useState } from "react";
import { Platform, StyleSheet, Text, View } from "react-native";

import { useAuth } from "../lib/auth";
import { signInWithGoogle, type SignInStart } from "../lib/authClient";
import { useLang, type Key } from "../lib/i18n";
import { signInOnPhone } from "../lib/phoneSignIn";
import { signInRefusal, type PhoneSignInRefusal } from "../lib/signin";
import { Button, IconBadge, ScreenMessage } from "./components";
import { PrivacyLink } from "./privacyLink";
import { space, type } from "./theme";

export function SignInAgainScreen() {
  const { t } = useLang();
  const { failure } = useAuth();
  const web = Platform.OS === "web" && typeof window !== "undefined";
  // Nobody signed in at all (the Worker's `signed_out`), rather than an Access
  // session that ran out: the Worker's own sign-in is the way in.
  const signedOut = (failure as { code?: unknown } | null)?.code === "signed_out";

  // A phone has no Access in front of it: Google is the only way in.
  if (!web) return <PhoneGoogleSignIn />;
  if (signedOut) return <GoogleSignIn />;

  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("gate_title")}</Text>
        <Text style={type.small}>{t("err_session_expired")}</Text>
        <Button label={t("gate_sign_in")} icon="user" onPress={() => window.location.reload()} />
      </View>
    </ScreenMessage>
  );
}

/** "Continue with Google", and why the last try did not end signed in: the
 *  way back from Google says so in the address (lib/signin.ts), and a try
 *  that could not even start says so here. */
function GoogleSignIn() {
  const [busy, setBusy] = useState(false);
  const [start, setStart] = useState<SignInStart>(null);
  const refused = signInRefusal(window.location.search);
  const body =
    start === "not_configured"
      ? "gate_not_configured"
      : start === "failed" || refused === "failed"
        ? "gate_failed"
        : refused === "not_listed"
          ? "gate_refused"
          : "gate_google_body";

  async function onPress() {
    setBusy(true);
    setStart(null);
    // Null means the page is already on its way to Google.
    const why = await signInWithGoogle();
    if (why) {
      setStart(why);
      setBusy(false);
    }
  }

  return <GoogleCard body={body} busy={busy} onPress={() => void onPress()} />;
}

/** The same button on a phone: Google's account sheet, then the Worker, then
 *  the door asks who this is again. Closing the sheet says nothing. */
function PhoneGoogleSignIn() {
  const { retry } = useAuth();
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState<PhoneSignInRefusal | null>(null);
  const body: Key =
    refused === "not_listed"
      ? "gate_refused"
      : refused === "no_account"
        ? "gate_no_account"
        : refused === "not_configured"
          ? "gate_not_configured"
          : refused === "failed"
            ? "gate_failed"
            : "gate_google_body";

  async function onPress() {
    setBusy(true);
    setRefused(null);
    const why = await signInOnPhone();
    if (why === null) {
      retry();
      return;
    }
    setRefused(why);
    setBusy(false);
  }

  return <GoogleCard body={body} busy={busy} onPress={() => void onPress()} />;
}

function GoogleCard({ body, busy, onPress }: { body: Key; busy: boolean; onPress: () => void }) {
  const { t } = useLang();
  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("gate_title")}</Text>
        <Text style={type.small}>{t(body)}</Text>
        <Button label={t("gate_google")} icon="user" disabled={busy} onPress={onPress} />
        <PrivacyLink />
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
