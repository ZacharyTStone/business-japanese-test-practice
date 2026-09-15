/**
 * Who the user is — which, at first launch, is nobody in particular.
 *
 * The app signs in anonymously before it shows anything. That gives every
 * visitor a real row in the database from the first question, so history,
 * streak and weakness profile are server-side from the start, and nobody is
 * stopped at a login wall to try five questions. Linking Google later keeps the
 * SAME user id, so nothing needs merging — that is the entire reason to do it
 * in this order rather than storing progress locally and reconciling it after.
 *
 * The one thing that must not happen is losing an anonymous session: until it
 * is linked, that session token is the only key to the person's history. It
 * lives in AsyncStorage (localStorage on web) and is refreshed on resume.
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
  /** Set when even anonymous sign-in failed — offline, or no project configured. */
  error: string | null;
  isAnonymous: boolean;
  email: string | null;
  linkGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    (async () => {
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;

      if (data.session) {
        setSession(data.session);
        setLoading(false);
        return;
      }

      // First launch on this device: become somebody, quietly.
      const { data: anon, error: anonError } = await supabase.auth.signInAnonymously();
      if (cancelled) return;
      if (anonError) setError(anonError.message);
      setSession(anon.session ?? null);
      setLoading(false);
    })();

    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next);
    });

    // Supabase's auto-refresh timer does not run while the app is backgrounded;
    // without this, coming back after a long pause can mean a dead token and,
    // for an anonymous user, a silently lost history.
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

  const value = useMemo<AuthState>(() => {
    const user = session?.user;
    return {
      session,
      loading,
      error,
      // A user with no identities is still anonymous. Supabase also exposes
      // is_anonymous on the JWT; either works, and the profile row mirrors it.
      isAnonymous: user ? user.is_anonymous !== false : true,
      email: user?.email ?? null,

      async linkGoogle() {
        // linkIdentity attaches Google to the CURRENT user rather than creating
        // a new one — this is what carries the anonymous history across.
        const redirectTo = AuthSession.makeRedirectUri({ scheme: "bizjadrill" });
        const { data, error: linkError } = await supabase.auth.linkIdentity({
          provider: "google",
          options: { redirectTo, skipBrowserRedirect: Platform.OS !== "web" },
        });
        if (linkError) throw linkError;
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
        // Never leave the app without a user: sign straight back in as a new
        // anonymous one, so the next screen has somewhere to write.
        const { data: anon } = await supabase.auth.signInAnonymously();
        setSession(anon.session ?? null);
      },
    };
  }, [session, loading, error]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
