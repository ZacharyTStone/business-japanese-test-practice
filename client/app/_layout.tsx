import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider, useAuth } from "../src/lib/auth";
import { LangProvider, useLang } from "../src/lib/i18n";
import { isConfigured } from "../src/lib/supabase";
import { Loading } from "../src/ui/components";
import { ClosedScreen, SignInScreen } from "../src/ui/gate";
import { colors } from "../src/ui/theme";
import { WelcomeScreen, useWelcome } from "../src/ui/welcome";

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
    if (auth.isTester === null && !auth.error) return <Loading />;
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
          <Stack.Screen name="history" options={{ title: t("title_history") }} />
        </Stack>
  );
}
