/**
 * Who the user is — and, while the app is in testing, whether they are allowed
 * in at all.
 *
 * The app used to sign everybody in anonymously before it showed anything, so
 * that nobody was stopped at a login wall to try five questions. That is the
 * right shape for a public app and the wrong one for an app that is not open
 * yet: the owner asked (2026-09-17) that only the people testing it can use it.
 * So now there is a wall, and it is Google: sign in, and the database says
 * whether that account is on the tester list. The database, not this file —
 * every row-level policy requires it, so a client that skipped this check would
 * simply see nothing. `isTester` here exists to say so politely.
 *
 * Opening the app later means putting the anonymous sign-in back in front of
 * this wall, and the linking path that came with it. The schema still supports
 * both; nothing about a user id changes.
 */
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import type { Session } from "@supabase/supabase-js";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { AppState, Platform } from "react-native";

import { isConfigured, supabase } from "./supabase";

WebBrowser.maybeCompleteAuthSession();

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
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTester, setIsTester] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data, error: sessionError } = await supabase.auth.getSession();
      if (cancelled) return;
      if (sessionError) setError(sessionError.message);
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
        if (rpcError) setError(rpcError.message);
        else setIsTester(data === true);
      });
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const value = useMemo<AuthState>(() => {
    const user = session?.user;
    return {
      session,
      loading,
      error,
      isTester,
      email: user?.email ?? null,

      async signInWithGoogle() {
        const redirectTo = AuthSession.makeRedirectUri({ scheme: "bizjadrill" });
        const { data, error: signInError } = await supabase.auth.signInWithOAuth({
          provider: "google",
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== "web" },
        });
        if (signInError) throw signInError;
        if (Platform.OS === "web" || !data?.url) return; // the browser handles it

        const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
        if (result.type !== "success") return;

        // Native gets the tokens back in the callback URL fragment and has to
        // install them itself; there is no page load to pick them up.
        const params = new URLSearchParams(result.url.split("#")[1] ?? "");
        const access_token = params.get("access_token");
        const refresh_token = params.get("refresh_token");
        if (access_token && refresh_token) {
          await supabase.auth.setSession({ access_token, refresh_token });
        }
        const { data: refreshed } = await supabase.auth.getSession();
        setSession(refreshed.session);
      },

      async signOut() {
        await supabase.auth.signOut();
        setSession(null);
        setIsTester(null);
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
