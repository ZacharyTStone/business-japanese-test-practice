/**
 * The way to the privacy policy (app/privacy.tsx), from the screens a person
 * meets before and after signing in. A link, not a button: on the web it is
 * an address that can be opened in a new tab.
 */
import { Link } from "expo-router";
import React from "react";

import { useLang } from "../lib/i18n";
import { colors, type } from "./theme";

export function PrivacyLink() {
  const { t } = useLang();
  return (
    <Link href="/privacy" style={[type.small, { color: colors.accent, textAlign: "center" }]}>
      {t("title_privacy")}
    </Link>
  );
}
