/**
 * The four places the app lives, on a bar that is always there.
 *
 * Four and not five: every tab has to be somewhere a learner goes back to on
 * purpose, and 解いた問題 is somewhere they go *from* 記録, on the way to one
 * particular question. It sits under 記録 rather than taking a fifth of the bar.
 *
 * Practice, its result, and the review screen are deliberately **not** tabs. They
 * are pushed on top of this bar and cover it, because a set of five is a thing
 * you finish: a tab bar under a listening item is an invitation to leave halfway,
 * and leaving halfway loses the set.
 */
import { Tabs } from "expo-router/js-tabs";
import React from "react";
import type { ColorValue } from "react-native";

import { useLang } from "../../src/lib/i18n";
import { Icon, type IconName } from "../../src/ui/icons";
import { colors, shadow, space } from "../../src/ui/theme";

function tabIcon(name: IconName) {
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Icon name={name} color={color as string} size={24} strokeWidth={focused ? 2.2 : 1.8} />
  );
}

export default function TabsLayout() {
  const { t } = useLang();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          paddingTop: space.sm,
          paddingBottom: space.sm,
          height: 76,
          ...shadow.bar,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "700", marginTop: 2 },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tab_home"), tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="choose" options={{ title: t("tab_choose"), tabBarIcon: tabIcon("grid") }} />
      <Tabs.Screen name="progress" options={{ title: t("tab_progress"), tabBarIcon: tabIcon("chart") }} />
      <Tabs.Screen name="account" options={{ title: t("tab_account"), tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
