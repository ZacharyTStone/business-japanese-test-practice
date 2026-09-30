/**
 * The Supabase client.
 *
 * The anon key here is public on purpose — it identifies the project, it does
 * not authorise anything. Every table is behind row-level security, so a holder
 * of this key sees exactly what a policy allows them. The key that *would* matter
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

/**
 * The address the web app was opened at, read before the client exists.
 *
 * supabase-js reads a session out of the address when it starts
 * (`detectSessionInUrl`) and then wipes it, and a password-reset link is one
 * of those. By the time anything else could ask, the address no longer says
 * whether this launch was a reset — so it is kept here, first
 * (lib/authlink.ts reads it). Null on a phone, which has no address bar.
 */
export const LAUNCH_URL: string | null =
  Platform.OS === "web" && typeof window !== "undefined" ? window.location.href : null;

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "public-anon-key", {
  auth: {
    // On web, supabase-js uses localStorage by default and AsyncStorage's web
    // shim would be a second, redundant copy of the same thing.
    storage: Platform.OS === "web" ? undefined : AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    // Native apps have no URL bar to read a callback out of.
    detectSessionInUrl: Platform.OS === "web",
  },
});

export const MISSING_CONFIG_MESSAGE =
  "EXPO_PUBLIC_SUPABASE_URL と EXPO_PUBLIC_SUPABASE_ANON_KEY が設定されていません。client/.env.example を .env にコピーしてください。";

/** Kept here for the screens that import it from this module; the definition
 *  lives in `errors.ts`, which does not create a client when imported. */
export { errorText } from "./errors";
