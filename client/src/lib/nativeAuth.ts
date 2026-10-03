/**
 * A native build's sign-in: Cloudflare Access in a browser tab, and the token
 * it comes back with kept in the device's secure storage.
 *
 * The tab opens the Worker's start page, which Access stands in front of like
 * every page, so the person signs in there exactly as on the web. The tab
 * comes back to the app (bizjadrill://auth) with a one-time code, and the code
 * buys the token only with the secret made here, which never left the app
 * (PKCE). worker/native.ts is the other half, and says why it has this shape;
 * lib/signin.ts holds the parts that are only strings.
 *
 * Nothing here runs on the web, where the browser is the app and the Access
 * cookie does all of this by itself.
 */
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import * as WebBrowser from "expo-web-browser";

import { apiUrl, setNativeToken, SIGN_OUT_URL } from "./api";
import { base64ToUrl, base64url, codeFromCallback, NATIVE_REDIRECT, signInUrl } from "./signin";

const TOKEN_KEY = "cf_access_token";

/** Put the token this device last signed in with where api.ts reads it. */
export async function restoreSignIn(): Promise<void> {
  try {
    setNativeToken(await SecureStore.getItemAsync(TOKEN_KEY));
  } catch {
    setNativeToken(null);
  }
}

export type SignInResult = "signed_in" | "cancelled" | "failed";

/** Sign in through Access in a browser tab. "cancelled" is the tab closed by
 *  the person; "failed" is anything else that did not end signed in. */
export async function signIn(): Promise<SignInResult> {
  const verifier = base64url(Crypto.getRandomBytes(32));
  const state = base64url(Crypto.getRandomBytes(16));
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, verifier, {
    encoding: Crypto.CryptoEncoding.BASE64,
  });
  const result = await WebBrowser.openAuthSessionAsync(signInUrl(apiUrl(""), base64ToUrl(digest), state), NATIVE_REDIRECT);
  if (result.type !== "success") return "cancelled";
  const code = codeFromCallback(result.url, state);
  if (!code) return "failed";
  try {
    const res = await fetch(apiUrl("/auth/native/token"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, verifier }),
    });
    const body = (await res.json()) as { data?: { token?: unknown } };
    const token = body?.data?.token;
    if (!res.ok || typeof token !== "string") return "failed";
    await SecureStore.setItemAsync(TOKEN_KEY, token);
    setNativeToken(token);
    return "signed_in";
  } catch {
    return "failed";
  }
}

/** Out of the app on this device, and out of Access in the browser the tab
 *  shares — or the next sign-in would go straight back in as the same person. */
export async function signOut(): Promise<void> {
  setNativeToken(null);
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
  await WebBrowser.openBrowserAsync(apiUrl(SIGN_OUT_URL)).catch(() => undefined);
}
