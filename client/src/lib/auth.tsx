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
 */
import type { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";

import { isConfigured, supabase } from "./supabase";

type AuthState = {
  session: Session | null;
  /** True while we are still working out who this is. Screens wait on it. */
  loading: boolean;
  /** Set when the session or the tester check could not be read — offline, or
   *  no project configured. */
  error: string | null;
  /** Whether the signed-in account is on the tester list. null until asked. */
  isTester: boolean | null;
  email: string | null;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves to true when the account is usable at once, false when Supabase
   *  sent a confirmation email first ("Confirm email" left on in the project). */
  signUp: (email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
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
  const [error, setError] = useState<string | null>(null);
  const [isTester, setIsTester] = useState<boolean | null>(null);
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
      setError(sessionError ? sessionError.message : null);
      setSession(data.session);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // Supabase's auto-refresh timer does not run while the app is backgrounded;
    // without this, coming back after a long pause can mean a dead token.
    const appState = AppState.addEventListener("change", (state) => {
      if (state === "active") supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
      appState.remove();
    };
  }, [attempt]);

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
          setError(rpcError.message);
          return;
        }
        setError(null);
        setIsTester(data === true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id, attempt]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user;
    return {
      session,
      loading,
      error,
      isTester,
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
      },

      retry() {
        setError(null);
        setLoading(true);
        setAttempt((n) => n + 1);
      },
    };
  }, [session, loading, error, isTester]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
