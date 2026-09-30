/**
 * Who the user is — and, while the app is in testing, whether they are allowed
 * in at all.
 *
 * Only the people testing the app may use it, so there is a wall: sign in with
 * an email and a password, and the database says whether that email is on the
 * tester list. The database, not this file — every row-level policy requires
 * it, so a client that skipped this check would simply see nothing. `isTester`
 * here exists to say so politely.
 *
 * Email and password rather than Google, because it needs nothing outside
 * Supabase — no OAuth client, no consent screen. The tester list matches on the
 * email either way, so Google can be a second button.
 *
 * Opening the app means putting an anonymous sign-in in front of this wall. The
 * schema supports it; nothing about a user id changes.
 *
 * A forgotten password is the one way back in that needs the mail: Supabase
 * sends a link to `/reset-password` (`bizjadrill://reset-password` in the app)
 * carrying a session for exactly one thing, choosing a new password. While
 * that session is being used for it, `recovering` is true and the door shows
 * the new-password screen instead of the app.
 */
import type { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import * as Linking from "expo-linking";
import { AppState, Platform } from "react-native";

import { parseAuthLink } from "./authlink";
import { errorText } from "./errors";
import { isConfigured, LAUNCH_URL, supabase } from "./supabase";

/** Where a reset email's link lands: the web app's own route, or the app's. */
function resetRedirect(): string {
  if (Platform.OS === "web" && typeof window !== "undefined") return `${window.location.origin}/reset-password`;
  return Linking.createURL("reset-password");
}

/** This launch, if it came from a reset email — on the web, where the address
 *  is the only place that says so. */
const LAUNCH_LINK = LAUNCH_URL ? parseAuthLink(LAUNCH_URL) : null;

type AuthState = {
  session: Session | null;
  /** True while we are still working out who this is. Screens wait on it. */
  loading: boolean;
  /** Set when the session or the tester check could not be read — offline, or
   *  no project configured. The technical text of `failure`, kept for the
   *  screens that print it. */
  error: string | null;
  /** The failure itself, for `errorKind` / `friendlyError`: whether it was the
   *  network or the sign-in is what decides between "try again" and "sign in
   *  again", and the message alone does not always say. */
  failure: unknown;
  /** Whether the signed-in account is on the tester list. null until asked. */
  isTester: boolean | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to true when the account is usable at once, false when Supabase
   *  sent a confirmation email first ("Confirm email" left on in the project). */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  /** Mail a link for choosing a new password. Supabase answers the same for
   *  an address it does not know, so this says nothing about who has an account. */
  resetPassword: (email: string) => Promise<void>;
  /** True while a reset link's session is waiting for the new password. */
  recovering: boolean;
  /** A reset link that came with no session: too old, or already used. */
  linkFailure: unknown;
  /** Set the new password, and carry on signed in. */
  updatePassword: (password: string) => Promise<void>;
  /** Leave the new-password screen without choosing one. */
  endRecovery: () => void;
  /** Re-run the session read and the tester check. `error` is never cleared on
   *  its own, so this is the way back from a cold-start hiccup. A failed check
   *  sets `error` and leaves `isTester` alone, so it never reads as "not a
   *  tester". */
  retry: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [isTester, setIsTester] = useState<boolean | null>(null);
  const [recovering, setRecovering] = useState(Boolean(LAUNCH_LINK?.recovery && !LAUNCH_LINK.error));
  const [linkFailure, setLinkFailure] = useState<unknown>(
    LAUNCH_LINK?.recovery && LAUNCH_LINK.error ? LAUNCH_LINK.error : null
  );
  // Bumped by retry(): both effects below depend on it, so one call re-runs
  // the session read and the tester check together.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      // Read, not merged with what the tester-check effect might set next:
      // a clean session read clears a stale error from a previous attempt.
      setFailure(sessionError ?? null);
      setSession(data.session);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      // supabase-js says so itself when it read a reset link out of the
      // address — belt and braces with LAUNCH_LINK, which may have been read
      // on a page that was then navigated.
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
    });

    // Supabase's auto-refresh timer does not run while the app is backgrounded;
    // without this, coming back after a long pause can mean a dead token.
    // Native only: in a browser supabase-js already follows the tab's
    // visibility itself, and either call here would remove the handler it
    // does that with — leaving a tab that was hidden and shown again with no
    // refresh at all.
    const appState =
      Platform.OS === "web"
        ? null
        : AppState.addEventListener("change", (state) => {
            if (state === "active") supabase.auth.startAutoRefresh();
            else supabase.auth.stopAutoRefresh();
          });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      appState?.remove();
    };
  }, [attempt]);

  // A reset link opened on a phone. Nothing in supabase-js reads a deep link,
  // so the session it carries is set here — from the link that launched the
  // app, or one opened while it runs.
  useEffect(() => {
    if (!isConfigured || Platform.OS === "web") return;
    let cancelled = false;
    async function open(url: string | null) {
      const link = url ? parseAuthLink(url) : null;
      if (!link?.recovery) return;
      if (link.error) {
        if (!cancelled) setLinkFailure(link.error);
        return;
      }
      try {
        if (link.code) {
          const { error } = await supabase.auth.exchangeCodeForSession(link.code);
          if (error) throw error;
        } else if (link.accessToken && link.refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: link.accessToken,
            refresh_token: link.refreshToken,
          });
          if (error) throw error;
        } else {
          return;
        }
        if (!cancelled) {
          setLinkFailure(null);
          setRecovering(true);
        }
      } catch (e) {
        if (!cancelled) setLinkFailure(e ?? "error");
      }
    }
    Linking.getInitialURL()
      .then(open)
      .catch(() => {});
    const sub = Linking.addEventListener("url", ({ url }) => void open(url));
    return () => {
      cancelled = true;
      sub.remove();
    };
  }, []);

  // Ask the database whether this account may use the app. It is one RPC and
  // it is asked once per session, because the answer is a property of the
  // tester list, not of anything the client does.
  useEffect(() => {
    if (!session) {
      setIsTester(null);
      return;
    }
    let cancelled = false;
    supabase
      .rpc("is_tester")
      .then(({ data, error: rpcError }) => {
        if (cancelled) return;
        if (rpcError) {
          setFailure(rpcError);
          return;
        }
        setFailure(null);
        setIsTester(data === true);
      });
    return () => {
      cancelled = true;
    };
    // The account, not the session: a refreshed token is the same person, and
    // asking again every hour would be a round trip that cannot change the answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id, attempt]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user;
    return {
      session,
      loading,
      error: failure == null ? null : errorText(failure),
      failure,
      isTester,
      recovering,
      linkFailure,
      email: user?.email ?? null,

      async signIn(email, password) {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });
        if (signInError) throw signInError;
      },

      async signUp(email, password) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
        });
        if (signUpError) throw signUpError;
        return data.session !== null;
      },

      async signOut() {
        await supabase.auth.signOut();
        setSession(null);
        setIsTester(null);
        setRecovering(false);
      },

      async resetPassword(email) {
        const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
          redirectTo: resetRedirect(),
        });
        if (resetError) throw resetError;
      },

      async updatePassword(password) {
        const { error: updateError } = await supabase.auth.updateUser({ password });
        if (updateError) throw updateError;
        setLinkFailure(null);
        setRecovering(false);
      },

      endRecovery() {
        setRecovering(false);
      },

      retry() {
        setFailure(null);
        setLoading(true);
        setAttempt((n) => n + 1);
      },
    };
  }, [session, loading, failure, isTester, recovering, linkFailure]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
