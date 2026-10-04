/**
 * The privacy policy, at /privacy (the text is src/lib/privacy.ts). The one
 * screen anybody may read without signing in or meeting the introduction:
 * the store listing and Google's consent screen link to it, and a person
 * deciding whether to sign in should be able to read it first. The root
 * layout lets it past the door (app/_layout.tsx).
 */
import React from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useLang } from "../src/lib/i18n";
import { privacyFooter, privacySections } from "../src/lib/privacy";
import { colors, page, space, type } from "../src/ui/theme";

export default function Privacy() {
  const { lang } = useLang();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + space.xl }]}>
      {/* The title is the header's (app/_layout.tsx). */}
      <View style={[page, styles.body]}>
        {privacySections(lang).map((section) => (
          <View key={section.title} style={styles.section}>
            <Text style={type.h2} accessibilityRole="header">
              {section.title}
            </Text>
            {section.paragraphs.map((p) => (
              <Text key={p} style={type.body}>
                {p}
              </Text>
            ))}
          </View>
        ))}
        <View style={styles.section}>
          {privacyFooter(lang).map((line) => (
            <Text key={line} style={type.small}>
              {line}
            </Text>
          ))}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { paddingHorizontal: space.lg, paddingTop: space.lg, backgroundColor: colors.bg, flexGrow: 1 },
  body: { gap: space.xl },
  section: { gap: space.sm },
});
