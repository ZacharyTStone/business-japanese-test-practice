/**
 * The three places the app lives, on a bar that is always there.
 *
 * There is no tab for picking a problem type or sitting a mock. The app decides
 * what you practise next from what you have answered, and a picker beside that
 * is an invitation to overrule the one thing the app is for — usually in favour
 * of whatever feels comfortable, which is the opposite of what raises a score.
 *
 * 解いた問題 is not a tab either: it is somewhere a learner goes *from* 記録, on
 * the way to one particular question, so it sits under 記録.
 *
 * Practice and its result are deliberately **not** tabs. They are pushed on top
 * of this bar and cover it, because a set is a thing you finish: a tab bar under
 * a listening item is an invitation to leave halfway, and leaving halfway loses
 * the set.
 */
import { Tabs } from "expo-router/js-tabs";
import React from "react";
import type { ColorValue } from "react-native";

import { useLang } from "../../src/lib/i18n";
import { ScreenCrash } from "../../src/ui/crash";
import { Icon, type IconName } from "../../src/ui/icons";
import { TAB_LABEL, useTabBarHeight } from "../../src/ui/tabbar";
import { colors, shadow, space } from "../../src/ui/theme";

function tabIcon(name: IconName) {
  return ({ color, focused }: { color: ColorValue; focused: boolean }) => (
    <Icon name={name} color={color as string} size={24} strokeWidth={focused ? 2.2 : 1.8} />
  );
}

/** A tab that throws while drawing is caught here, under the stack, so the
 *  way home still has a navigator to go through (ui/crash.tsx). */
export const ErrorBoundary = ScreenCrash;

export default function TabsLayout() {
  const { t } = useLang();
  const bar = useTabBarHeight();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        // The page behind a tab is the app's own, as it is behind every stack
        // screen (app/_layout.tsx). Left to the navigator it is its theme's
        // grey, a shade off `bg`, which shows as a seam the moment a tab's
        // content is shorter than the window.
        sceneStyle: { backgroundColor: colors.bg },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.muted,
        // Always stacked, at every width. Left to itself the bar puts the label
        // *beside* the icon on a wide viewport, where the label's top margin
        // (there to space it under the icon) drops it below the icon's centre
        // line.
        tabBarLabelPosition: "below-icon",
        tabBarStyle: {
          backgroundColor: colors.surface,
          borderTopWidth: 0,
          paddingTop: space.sm,
          // A height given here replaces the one the bar would work out for
          // itself, safe-area inset included — so the inset goes back in.
          paddingBottom: space.sm + bar.inset,
          height: bar.height,
          ...shadow.bar,
        },
        // The icon and its word are one thing; centring them together is what
        // keeps the three tabs sitting on the same line as each other.
        tabBarItemStyle: { justifyContent: "center", alignItems: "center" },
        // Twelve, not eleven: the one word under each icon is the only thing
        // that says what the tab is. It scales with the system text size, and
        // the bar's height follows it (ui/tabbar.ts).
        tabBarLabelStyle: { ...TAB_LABEL, fontWeight: "700", marginTop: 2, textAlign: "center" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: t("tab_home"), tabBarIcon: tabIcon("home") }} />
      <Tabs.Screen name="progress" options={{ title: t("tab_progress"), tabBarIcon: tabIcon("chart") }} />
      <Tabs.Screen name="account" options={{ title: t("tab_account"), tabBarIcon: tabIcon("user") }} />
    </Tabs>
  );
}
