/**
 * The one thing every screen used to check for itself: whether the app has
 * been pointed at a project at all.
 *
 * A fresh clone has no `EXPO_PUBLIC_SUPABASE_*`, and every screen then shows
 * the setup notice instead of a stack trace. Seven screens carried their own
 * copy of that branch, and of an `isConfigured` guard in each of their loads;
 * this is the one copy. A screen's default export wraps its body in it, so the
 * body — its effects included — runs only when there is a project to ask.
 *
 * Nothing else lives here. Whether somebody is signed in, and a tester, is
 * the root layout's door (app/_layout.tsx): no screen behind it can be drawn
 * while auth is loading or has failed, so no screen checks that again.
 */
import React from "react";

import { useLang } from "../lib/i18n";
import { isConfigured, MISSING_CONFIG_MESSAGE } from "../lib/supabase";
import { Notice, ScreenMessage } from "./components";

export function ScreenGate({
  children,
  underHeader = false,
}: {
  children: React.ReactNode;
  /** A stack screen, whose header already stands clear of the status bar. */
  underHeader?: boolean;
}) {
  const { t } = useLang();
  if (isConfigured) return <>{children}</>;
  return (
    <ScreenMessage underHeader={underHeader}>
      <Notice title={t("config_needed")} body={MISSING_CONFIG_MESSAGE} tone="warn" />
    </ScreenMessage>
  );
}
