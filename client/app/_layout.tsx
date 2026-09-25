import { Stack, useRouter } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { Pressable, Text } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../src/lib/auth";
import { LangProvider, useLang } from "../src/lib/i18n";
import { isConfigured } from "../src/lib/supabase";
import { Loading, Notice, ScreenMessage } from "../src/ui/components";
import { ClosedScreen, SignInScreen } from "../src/ui/gate";
import { Icon } from "../src/ui/icons";
import { colors, space, type } from "../src/ui/theme";
import { WelcomeScreen, useWelcome } from "../src/ui/welcome";

/**
 * The way out of 解いた問題.
 *
 * It needs one of its own because the screen is reached two ways and only one
 * of them leaves anything underneath: 記録 pushes it, but the result screen
 * *replaces* itself with it, and a replaced screen has no history to go back
 * through. On the web that meant a header with no back arrow and no browser
 * entry to press either — a room with the door painted on. So the control is
 * always drawn, and when there is nothing behind it, it goes to 記録, which is
 * where the screen belongs.
 */
function BackToRecord() {
  const router = useRouter();
  const { t } = useLang();
  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => (router.canGoBack() ? router.back() : router.replace("/progress"))}
      style={({ pressed }) => [
        { flexDirection: "row", alignItems: "center", gap: space.xs, paddingRight: space.md },
        pressed && { opacity: 0.6 },
      ]}
    >
      <Icon name="chevronLeft" size={18} color={colors.accent} strokeWidth={2} />
      <Text style={[type.small, { color: colors.accent, fontWeight: "700" }]}>{t("back")}</Text>
    </Pressable>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <LangProvider>
        <AuthProvider>
          <StatusBar style="dark" />
          <Navigator />
        </AuthProvider>
      </LangProvider>
    </SafeAreaProvider>
  );
}

/** Its own component so the titles can follow the language. */
function Navigator() {
  const { t } = useLang();
  // The introduction comes before the router, not as a route inside it. A route
  // would mount the tab bar and then push over it, which on a cold start shows a
  // flash of an app nobody has been introduced to yet.
  const welcome = useWelcome();
  const auth = useAuth();
  if (!welcome.ready) return <Loading />;
  if (!welcome.seen) return <WelcomeScreen onStart={welcome.dismiss} />;

  // The door. Testers only, for now: no session means sign in, and a session
  // the database does not recognise means a closed sign. Without a configured
  // project the screens inside show the setup notice instead, so the door
  // stands aside for them.
  if (isConfigured) {
    if (auth.loading) return <Loading />;
    if (!auth.session) return <SignInScreen />;
    // An RPC that failed to answer is not an RPC that said no: falling
    // through to ClosedScreen here used to tell a tester who hit a network
    // blip that their account was not approved. Only a confirmed `false`
    // means that; a stuck `null` with an error means try again.
    if (auth.isTester === null && auth.error) {
      return (
        <ScreenMessage>
          <Notice
            title={t("cant_connect")}
            body={auth.error}
            tone="warn"
            action={{ label: t("retry"), onPress: auth.retry }}
          />
        </ScreenMessage>
      );
    }
    if (auth.isTester === null) return <Loading />;
    if (auth.isTester !== true) return <ClosedScreen />;
  }

  return (
    <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontSize: 16 },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          {/* The tab bar draws its own headers, so this one gets out of the way. */}
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          {/* No back gesture mid-session: leaving halfway loses the set, and on
              a phone the swipe is easy to trigger by accident while reading. */}
          <Stack.Screen name="practice" options={{ title: t("title_practice"), gestureEnabled: false }} />
          <Stack.Screen name="result" options={{ title: t("title_result"), headerBackVisible: false }} />
          <Stack.Screen
            name="history"
            options={{ title: t("title_history"), headerLeft: () => <BackToRecord /> }}
          />
          <Stack.Screen
            name="vocab"
            options={{ title: t("title_vocab"), headerLeft: () => <BackToRecord /> }}
          />
        </Stack>
  );
}
