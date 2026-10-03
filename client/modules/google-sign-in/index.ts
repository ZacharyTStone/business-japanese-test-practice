/**
 * Sign in with Google on Android, through the system's Credential Manager
 * (android/src/main/java/…/GoogleSignInModule.kt). A module of our own rather
 * than a library: the free Google sign-in libraries for React Native wrap
 * Google's older, deprecated SDK, and the one that wraps Credential Manager is
 * paid (2026-10-03).
 *
 * `signIn` shows Google's account sheet and answers with an ID token issued
 * for the client id it is given — the Web client the Worker already checks
 * (worker/auth.ts), never an Android one — and the nonce it put in the
 * token. Nothing else of the account reaches the app. lib/phoneSignIn.ts
 * hands both to the Worker.
 *
 * Null wherever the native half is not in the build: the web, Expo Go, iOS.
 */
import { requireOptionalNativeModule } from "expo";

export type GoogleIdToken = { idToken: string; nonce: string };

/** The codes `signIn` rejects with, besides anything unexpected. */
export const SIGN_IN_CANCELLED = "ERR_SIGN_IN_CANCELLED";
export const NO_GOOGLE_ACCOUNT = "ERR_NO_GOOGLE_ACCOUNT";

type GoogleSignInModule = {
  signIn(serverClientId: string): Promise<GoogleIdToken>;
  /** Forget which account was chosen, so the next sign-in asks again. */
  signOut(): Promise<void>;
};

export default requireOptionalNativeModule<GoogleSignInModule>("GoogleSignIn");
