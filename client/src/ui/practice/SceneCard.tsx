/**
 * The first moment of a question: who you are, who you are talking to, where.
 * A picture, a document if there is one. Nothing to answer yet.
 */
import React from "react";
import { Image, StyleSheet, Text, View } from "react-native";

import { useLang } from "../../lib/i18n";
import { CHANNEL_KEY } from "../../lib/labels";
import type { QueuedItem } from "../../lib/types";
import { Button, Card } from "../components";
import { DocumentView } from "../document";
import { colors, radius, shadow, space, type } from "../theme";
import { shared } from "./styles";

/** How the words travel, as a picture. It is the one part of the scene that
 *  changes the right answer without being in the sentence — on the phone you
 *  name yourself and your company, face to face you do not — so it is worth
 *  being the thing the eye finds first in the strip. */
const CHANNEL_EMOJI: Record<string, string> = {
  in_person: "🤝",
  phone: "📞",
  video: "💻",
  written: "✉️",
};

/** The scene card: the picture, the documents, and the one button that starts
 *  the question — listening, or reading. */
export function SceneCard({
  item,
  sceneImage,
  listenable,
  onGo,
}: {
  item: QueuedItem;
  sceneImage: string | null;
  listenable: boolean;
  onGo: () => void;
}) {
  const { t } = useLang();
  return (
    <Card style={{ gap: space.lg }}>
      {sceneImage ? <SceneImage uri={sceneImage} /> : null}
      {item.documents?.map((doc, i) => (
        <DocumentView key={`${item.id}-doc-${i}`} doc={doc} />
      ))}
      <Text style={[type.small, shared.hint]}>
        {listenable ? t("scene_hint_listen") : t("scene_hint_read")}
      </Text>
      <Button
        label={listenable ? t("btn_listen") : t("btn_to_q")}
        icon={listenable ? "headphones" : "chevron"}
        onPress={onGo}
      />
    </Card>
  );
}

/** Who you are, who you are talking to, and how. Big while entering the scene,
 *  a quiet row once the question is on screen. */
export function SceneStrip({ item, big }: { item: QueuedItem; big: boolean }) {
  const { t } = useLang();
  const parts: { k: string; v: string }[] = [];
  if (item.speaker_role) parts.push({ k: t("you"), v: item.speaker_role });
  if (item.listener_role) parts.push({ k: t("other"), v: item.listener_role });
  if (item.channel) {
    const key = CHANNEL_KEY[item.channel];
    const emoji = CHANNEL_EMOJI[item.channel];
    const name = key ? t(key) : item.channel;
    parts.push({ k: "", v: emoji ? `${emoji} ${name}` : name });
  }
  if (!parts.length) return null;
  return (
    <View style={styles.strip}>
      {parts.map((p) => (
        <View key={p.k + p.v} style={[styles.stripPill, big && styles.stripPillBig]}>
          {p.k ? <Text style={type.label}>{p.k}</Text> : null}
          <Text style={big ? styles.stripValueBig : styles.stripValue}>{p.v}</Text>
        </View>
      ))}
    </View>
  );
}

export function SceneImage({ uri }: { uri: string }) {
  return (
    // Not described to a screen reader on purpose. For most types the scene is
    // one of sixteen shared drawings that cannot contain the answer, so a
    // description would be of a stock illustration; for 画像把握 the picture IS
    // the question, and a description would be the answer.
    <Image
      source={{ uri }}
      style={styles.scene}
      resizeMode="cover"
      accessible={false}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
}

const styles = StyleSheet.create({
  strip: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  stripPill: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    gap: 1,
    // The channel pill carries no label above its value, so on its own it would
    // sit its one line against the top of a row whose other pills are two lines
    // tall. Centring holds the three of them on one line.
    justifyContent: "center",
    ...shadow.card,
  },
  stripPillBig: { paddingHorizontal: space.lg, paddingVertical: space.md },
  stripValue: { fontSize: 14, fontWeight: "700", color: colors.text },
  stripValueBig: { fontSize: 17, fontWeight: "700", color: colors.text, lineHeight: 24 },
  // Full width on a phone; on a desktop no more than 480 wide, which is 320
  // tall — a picture the size of the screen pushes the question below it.
  scene: {
    width: "100%",
    maxWidth: 480,
    alignSelf: "center",
    aspectRatio: 3 / 2,
    borderRadius: radius.md,
    backgroundColor: colors.accentSoft,
  },
});
