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

/**
 * What went wrong, in words somebody can act on.
 *
 * Every screen used to write `e instanceof Error ? e.message : String(e)`, and
 * a supabase-js failure is not an `Error` — it is a plain object carrying
 * `message`, `details`, `hint` and a Postgres `code`. So `String(e)` rendered
 * the one line the user was shown as "[object Object]", for every failure in
 * the app, and a real one (the app asking a view for a column the database did
 * not have yet) was invisible until somebody went and read the server's logs.
 *
 * The `code` is kept because it is the part worth searching for: `42703` is
 * "undefined column", which says "this client is newer than this database"
 * far more precisely than any wording of ours would.
 */
export function errorText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e && typeof e === "object") {
    const { message, details, hint, code } = e as Record<string, unknown>;
    const said = [message, details, hint].filter(
      (part): part is string => typeof part === "string" && part.trim() !== ""
    );
    if (said.length > 0) {
      const text = said.join(" — ");
      return typeof code === "string" && code !== "" ? `${text} (${code})` : text;
    }
  }
  return String(e);
}
