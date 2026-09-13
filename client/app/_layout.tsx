import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import React from "react";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { AuthProvider } from "../src/lib/auth";
import { colors } from "../src/ui/theme";

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <StatusBar style="dark" />
        <Stack
          screenOptions={{
            headerStyle: { backgroundColor: colors.bg },
            headerShadowVisible: false,
            headerTintColor: colors.text,
            headerTitleStyle: { fontSize: 16 },
            contentStyle: { backgroundColor: colors.bg },
          }}
        >
          <Stack.Screen name="index" options={{ title: "ビジネス日本語ドリル" }} />
          {/* No back gesture mid-session: leaving halfway loses the set, and on
              a phone the swipe is easy to trigger by accident while reading. */}
          <Stack.Screen name="practice" options={{ title: "練習", gestureEnabled: false }} />
          <Stack.Screen name="result" options={{ title: "結果", headerBackVisible: false }} />
          <Stack.Screen name="progress" options={{ title: "記録" }} />
          <Stack.Screen name="account" options={{ title: "アカウント" }} />
        </Stack>
      </AuthProvider>
    </SafeAreaProvider>
  );
}
