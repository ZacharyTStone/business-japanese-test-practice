/**
 * The Supabase client.
 *
 * The anon key here is public on purpose — it identifies the project, it does
 * not authorise anything. Every table is behind row-level security, so what a
 * holder of this key can see is exactly what an anonymous visitor is allowed to
 * see: the published item library and nothing else. The key that *would* matter
 * (the service role) never ships in this app; it is used from a laptop to apply
 * `bjt publish` output and nowhere else.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";
import { Platform } from "react-native";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/** True when the app has been pointed at a project. Screens check this and show
 *  setup instructions rather than a stack trace, so a fresh clone runs. */
export const isConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "public-anon-key", {
  auth: {
    // On web, supabase-js uses localStorage by default and AsyncStorage's web
    // shim would be a second, redundant copy of the same thing.
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps have no URL bar to read a callback out of; the OAuth flow
    // hands us the tokens explicitly instead (see auth.tsx).
    detectSessionInUrl: Platform.OS === "web",
  },
});

export const MISSING_CONFIG_MESSAGE =
  "EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY が設定されていません。client/.env.example を .env にコピーしてください。";
