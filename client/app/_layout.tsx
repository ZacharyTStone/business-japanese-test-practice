import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/lib/auth";
import { LangProvider, useLang } from "../src/lib/i18n";
import { colors } from "../src/ui/theme";

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
