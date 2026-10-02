/**
 * No test reaches a vendor: no credential in the environment, and every
 * function that would open a connection replaced by one that fails loudly
 * (tests/helpers.ts `registerSeam`). A test that wants a reply fakes the seam
 * itself, on top of this; a test that fakes what sits behind a seam calls
 * `useRealSeams()` first.
 */
import { afterEach, beforeEach } from "vitest";
import * as http from "../bjt/http.ts";
import { delEnv, refuseSeams, registerSeam, restoreAll } from "./helpers.ts";

/** Environment variables that hold a credential or point at a live service.
 *  `bjt/config.ts` loads `.env` at import, and a developer's shell or a CI job
 *  may carry any of these; a test must never see them, so a model call nobody
 *  faked cannot quietly find a key and spend it. */
const LIVE_ENV_PREFIXES = ["ANTHROPIC_", "OPENAI_", "TYPESAFE_", "R2_", "CLOUDFLARE_", "GEMINI_", "GOOGLE_"];
const LIVE_ENV_NAMES = ["BJT_SPEND_LEDGER"];

registerSeam(http.seams, "open", "http.seams.open (Jev, TTS, images, storage)");

beforeEach(() => {
  for (const name of Object.keys(process.env)) {
    if (LIVE_ENV_PREFIXES.some((p) => name.startsWith(p)) || LIVE_ENV_NAMES.includes(name)) delEnv(name);
  }
  refuseSeams();
});

afterEach(() => {
  restoreAll();
});
