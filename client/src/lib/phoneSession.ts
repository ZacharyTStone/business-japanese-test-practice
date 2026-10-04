/**
 * A phone's sign-in, kept: the signed session token the Worker answered a
 * Google sign-in with (lib/phoneSignIn.ts), in the system's encrypted storage
 * (expo-secure-store, backed by Android's Keystore), and sent as
 * `Authorization: Bearer` with every query, clip and picture. The Worker
 * takes it exactly as it takes the web's session cookie (worker/who.ts).
 *
 * A phone sends no cookies at all (`credentials: "omit"`). React Native keeps
 * a cookie jar of its own, which would catch the Worker's session cookie too,
 * and Better Auth refuses a request that carries a cookie and no Origin — the
 * phone's sign-out would be refused.
 *
 * On the web there is nothing here: the browser keeps the session in a cookie
 * on the Worker's origin and sends it by itself.
 */
import * as SecureStore from "expo-secure-store";
import { Platform, type ImageURISource } from "react-native";

import { bearerHeaders } from "./signin";

const KEY = "session_token";

/** A native build: the token, not a cookie, is who the learner is. */
export const onPhone = Platform.OS !== "web";

/** What fetch does with cookies: the browser's are the session; a phone's
 *  are none of our business. */
export const credentialsMode: RequestCredentials = onPhone ? "omit" : "include";

let token: string | null = null;
let loading: Promise<string | null> | null = null;

/** The kept token, read from storage once per launch; null on the web. */
export function loadToken(): Promise<string | null> {
  if (!onPhone) return Promise.resolve(null);
  loading ??= SecureStore.getItemAsync(KEY).then(
    (kept) => (token = kept),
    () => null
  );
  return loading;
}

export async function saveToken(signed: string): Promise<void> {
  token = signed;
  loading = Promise.resolve(signed);
  await SecureStore.setItemAsync(KEY, signed);
}

export async function forgetToken(): Promise<void> {
  token = null;
  loading = Promise.resolve(null);
  await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
}

/** The headers that say who is asking: the bearer on a phone that has one,
 *  nothing on the web. Read after loadToken(); every screen that sends
 *  anything comes after the door, which waits for it. */
export function authHeaders(): Record<string, string> {
  return bearerHeaders(token);
}

/** A clip, as expo-audio takes it: on a phone with the bearer, since the
 *  player fetches it itself and the Worker serves no clip to somebody it does
 *  not know. The same address gives an equal source, and useAudioPlayer
 *  compares sources by value, so a player is not rebuilt each render. */
export function clipSource(url: string): string | { uri: string; headers: Record<string, string> } {
  return onPhone ? { uri: url, headers: authHeaders() } : url;
}

/** A picture, as React Native's Image takes it, on the same terms. */
export function pictureSource(url: string): ImageURISource | ImageURISource[] {
  return pictureSourceFor(url, onPhone ? authHeaders() : null);
}

/**
 * On a phone, a one-element array. Image.android.js hands `headers` to the
 * native view only from an array source; from a single object it drops them,
 * the picture is asked for without the bearer, and the Worker answers 401 —
 * the first Android build (2026-10-04) played every clip and showed no
 * picture.
 */
export function pictureSourceFor(url: string, headers: Record<string, string> | null): ImageURISource | ImageURISource[] {
  return headers ? [{ uri: url, headers }] : { uri: url };
}
