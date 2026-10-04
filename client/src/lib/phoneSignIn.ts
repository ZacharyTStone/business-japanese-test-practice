/**
 * Signing in and out on a phone (Android). Google's account sheet, through
 * Credential Manager (modules/google-sign-in), gives an ID token for the Web
 * client; the Worker checks it and answers with a session token, which
 * lib/phoneSession.ts keeps and sends from then on. No browser on the way, so
 * the app claims no custom scheme and nothing can intercept a redirect.
 *
 * The Web client id is public — it is in every Google sign-in address — and
 * comes into the build as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, beside
 * `EXPO_PUBLIC_API_BASE` (client/README.md, Android).
 */
import GoogleSignIn from "../../modules/google-sign-in";
import { apiUrl } from "./api";
import { authHeaders, credentialsMode, forgetToken, saveToken } from "./phoneSession";
import { googleRefusal, phoneSignInAnswer, type PhoneSignInRefusal } from "./signin";

const WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? "").trim();

/** Null once signed in (the door then asks who this is again), or why not. */
export async function signInOnPhone(): Promise<PhoneSignInRefusal | null> {
  if (!GoogleSignIn || !WEB_CLIENT_ID) return "not_configured";

  let google: { idToken: string; nonce: string };
  try {
    google = await GoogleSignIn.signIn(WEB_CLIENT_ID);
  } catch (e) {
    return googleRefusal(e && typeof e === "object" ? (e as { code?: unknown }).code : undefined);
  }

  try {
    const res = await fetch(apiUrl("/api/auth/sign-in/social"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", idToken: { token: google.idToken, nonce: google.nonce } }),
      credentials: credentialsMode,
    });
    const body: unknown = await res.json().catch(() => null);
    const answer = phoneSignInAnswer(res.status, res.headers.get("set-auth-token"), body);
    if ("refused" in answer) return answer.refused;
    await saveToken(answer.token);
    return null;
  } catch {
    return "failed";
  }
}

/** Out of the Worker's session, then forget the token and the chosen Google
 *  account, so the next sign-in asks which account again. Each step is tried
 *  whatever the one before did: offline, the token is still forgotten. */
export async function signOutOnPhone(): Promise<void> {
  await fetch(apiUrl("/api/auth/sign-out"), {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: "{}",
    credentials: credentialsMode,
  }).catch(() => undefined);
  await forgetToken();
  await GoogleSignIn?.signOut().catch(() => undefined);
}
