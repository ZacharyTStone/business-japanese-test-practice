/**
 * The door, while the app is in testing.
 *
 * Two screens, and neither explains the app — that is the welcome screen's
 * job, and it has already happened by the time either of these shows.
 *
 *   SignInScreen  there is no session. Email, password, sign in or create —
 *                 or, for a forgotten password, a link by mail.
 *   NewPasswordScreen  that link was opened: its session is good for choosing
 *                 a new password, and this is where it is chosen.
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
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";

import { useAuth } from "../lib/auth";
import { useLang } from "../lib/i18n";
import { Button, IconBadge, InlineError, ScreenMessage } from "./components";
import { colors, MIN_TOUCH, radius, space, type } from "./theme";

export function SignInScreen() {
  const { t } = useLang();
  const { signIn, signUp, resetPassword, failure: authFailure, linkFailure } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const hasEmail = email.includes("@");
  const ready = hasEmail && password.length >= 6;

  async function attempt(action: () => Promise<void>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError(e ?? "error");
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
        <TextInput
          style={styles.input}
          value={email}
          onChangeText={setEmail}
          placeholder={t("gate_email")}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t("gate_email")}
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          textContentType="emailAddress"
          editable={!busy}
        />
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t("gate_password")}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t("gate_password")}
          secureTextEntry
          autoComplete="password"
          textContentType="password"
          editable={!busy}
          onSubmitEditing={() => ready && attempt(() => signIn(email, password))}
        />
        <Button
          label={busy ? t("gate_busy") : t("gate_sign_in")}
          icon="user"
          disabled={busy || !ready}
          onPress={() => attempt(() => signIn(email, password))}
        />
        <Button
          label={t("gate_create")}
          tone="secondary"
          disabled={busy || !ready}
          onPress={() =>
            attempt(async () => {
              const usable = await signUp(email, password);
              if (!usable) setNotice(t("gate_check_email"));
            })
          }
        />
        <Text style={type.small}>{t("gate_password_hint")}</Text>
        {/* Only the address is needed for this, so it does not wait for a
            password; without an address it says what it needs instead. */}
        <Pressable
          accessibilityRole="button"
          disabled={busy}
          onPress={() => {
            if (!hasEmail) {
              setError(null);
              setNotice(t("gate_reset_need_email"));
              return;
            }
            void attempt(async () => {
              await resetPassword(email);
              setNotice(t("gate_reset_sent"));
            });
          }}
          style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.linkText}>{t("gate_forgot")}</Text>
        </Pressable>
        {linkFailure != null && notice === null ? (
          <Text style={[type.small, { color: colors.wrong }]}>{t("gate_link_expired")}</Text>
        ) : null}
        {notice ? (
          <Text style={[type.small, { color: colors.accentDeep }]} accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {/* A wrong password, an expired sign-in, no connection: each said as
            what to do, with the technical text in small print for the rest. */}
        {(error ?? authFailure) != null ? <InlineError error={error ?? authFailure} /> : null}
      </View>
    </ScreenMessage>
  );
}

/**
 * The far end of a reset email. The link's session is a real one, so the only
 * thing asked here is the new password; once it is set the learner carries on
 * into the app, signed in. Leaving without one does the same — they proved
 * the address is theirs by opening the mail — and the old password still works.
 */
export function NewPasswordScreen() {
  const { t } = useLang();
  const { updatePassword, endRecovery } = useAuth();
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ready = password.length >= 6;

  async function save() {
    if (!ready || busy) return;
    setBusy(true);
    setError(null);
    try {
      await updatePassword(password);
    } catch (e) {
      setError(e ?? "error");
      setBusy(false);
    }
  }

  return (
    <ScreenMessage>
      <View style={styles.card}>
        <IconBadge name="user" tone="violet" />
        <Text style={type.h2}>{t("reset_title")}</Text>
        <Text style={type.small}>{t("reset_body")}</Text>
        <TextInput
          style={styles.input}
          value={password}
          onChangeText={setPassword}
          placeholder={t("reset_password")}
          placeholderTextColor={colors.muted}
          accessibilityLabel={t("reset_password")}
          secureTextEntry
          autoComplete="new-password"
          textContentType="newPassword"
          editable={!busy}
          onSubmitEditing={save}
        />
        <Button
          label={busy ? t("reset_busy") : t("reset_save")}
          disabled={busy || !ready}
          onPress={save}
        />
        <Button label={t("cancel")} tone="secondary" disabled={busy} onPress={endRecovery} />
        {error != null ? <InlineError error={error} /> : null}
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
  // A text link that is still a thumb's width tall: padding, not hitSlop,
  // which the web ignores.
  link: { minHeight: MIN_TOUCH, justifyContent: "center", alignSelf: "flex-start" },
  linkText: { ...type.small, color: colors.accentDeep, fontWeight: "700" },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.inputBorder,
    borderWidth: 1,
    borderRadius: radius.md,
    paddingHorizontal: space.md,
    paddingVertical: space.sm + 2,
    fontSize: 16,
    color: colors.text,
  },
});
