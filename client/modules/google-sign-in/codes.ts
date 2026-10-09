/**
 * The codes `signIn` rejects with, besides anything unexpected — the ones
 * GoogleSignInModule.kt throws. A file of their own so that lib/signin.ts,
 * which is plain and tested in Node, can read them without loading the
 * native module's half (index.ts imports Expo).
 */
export const SIGN_IN_CANCELLED = "ERR_SIGN_IN_CANCELLED";
export const NO_GOOGLE_ACCOUNT = "ERR_NO_GOOGLE_ACCOUNT";
