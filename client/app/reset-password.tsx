/**
 * Where a password-reset email's link lands: `/reset-password` on the web,
 * `bizjadrill://reset-password` in the app.
 *
 * The route exists so the address resolves — the web build exports one page
 * per route, and anything else is a 404 — and so a deep link has somewhere to
 * go. The work is not done here. The link's session is read by lib/auth.tsx,
 * and while it is waiting for a new password the root layout draws
 * NewPasswordScreen (ui/gate.tsx) in place of every route. By the time this
 * screen is drawn at all, the password has been chosen or the choice put off,
 * and the only thing left is to go home.
 */
import { Redirect } from "expo-router";
import React from "react";

export default function ResetPassword() {
  return <Redirect href="/" />;
}
