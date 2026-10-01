/**
 * Who the user is — and, while the app is in testing, whether they are allowed
 * in at all.
 *
 * Cloudflare Access is the sign-in. It stands in front of the whole site, so
 * nobody reaches this code without having signed in with an address the
 * Access policy names; there is no password form in the app. What is left to
 * ask is who that is to the database, which the Worker answers from the
 * Access identity (`whoami`, worker/queries.ts): the user id, the email, and
 * whether the tester list has the address.
 *
 * The database, not this file, is what keeps anybody out: every row-level
 * policy requires `is_tester()`, so a client that skipped the check here would
 * simply see nothing. `isTester` exists to say so politely.
 *
 * An Access session runs out after a while. The next request then answers
 * `session_expired` (lib/api.ts), and the door offers to sign in again, which
 * is a reload: Access shows its own sign-in page and comes back here.
 */
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";

import { call, isConfigured, SIGN_OUT_URL } from "./api";
import { errorText } from "./errors";

/** The signed-in learner, in the shape the screens already read
 *  (`session?.user.id`). */
export type Session = { user: { id: string; email: string } };

type AuthState = {
  session: Session | null;
  /** True while we are still working out who this is. Screens wait on it. */
  loading: boolean;
  /** Set when the identity or the tester check could not be read — offline,
   *  an expired sign-in, or no Worker configured. The technical text of
   *  `failure`, kept for the screens that print it. */
  error: string | null;
  /** The failure itself, for `errorKind` / `friendlyError`: whether it was the
   *  network or the sign-in decides between "try again" and "sign in again". */
  failure: unknown;
  /** Whether the signed-in account is on the tester list. null until asked. */
  isTester: boolean | null;
  email: string | null;
  /** Out of Cloudflare Access, and so out of the app. */
  signOut: () => Promise<void>;
  /** Ask again. `error` is never cleared on its own, so this is the way back
   *  from a cold-start hiccup. A failed check sets `error` and leaves
   *  `isTester` alone, so it never reads as "not a tester". */
  retry: () => void;
};

const AuthContext = createContext<AuthState | null>(null);

type WhoAmI = { user_id: string; email: string; is_tester: boolean };

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failure, setFailure] = useState<unknown>(null);
  const [isTester, setIsTester] = useState<boolean | null>(null);
  // Bumped by retry(): the effect depends on it.
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    call<WhoAmI>("whoami")
      .then((me) => {
        if (cancelled) return;
        setFailure(null);
        setEmail(me.email);
        setSession({ user: { id: me.user_id, email: me.email } });
        setIsTester(me.is_tester === true);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        // Access let them in, but the Worker has no account for the address:
        // that is a "no", not a failure to ask.
        const fields = e && typeof e === "object" ? (e as { code?: unknown; details?: unknown }) : {};
        if (fields.code === "not_a_tester") {
          setFailure(null);
          setEmail(typeof fields.details === "string" ? fields.details : null);
          setSession(null);
          setIsTester(false);
          return;
        }
        setFailure(e ?? "error");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const value = useMemo<AuthState>(
    () => ({
      session,
      loading,
      error: failure == null ? null : errorText(failure),
      failure,
      isTester,
      email,

      async signOut() {
        setSession(null);
        setIsTester(null);
        if (Platform.OS === "web" && typeof window !== "undefined") window.location.assign(SIGN_OUT_URL);
      },

      retry() {
        setFailure(null);
        setLoading(true);
        setAttempt((n) => n + 1);
      },
    }),
    [session, loading, failure, isTester, email]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
