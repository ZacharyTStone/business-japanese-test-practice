/**
 * Where a clip or a picture is served from: the Worker's `/media/` route,
 * which reads R2 (client/worker/media.ts), looked up by the path the database
 * holds. Null is the ordinary answer — no audio yet, no picture yet — and each
 * screen shows the text instead.
 */
import { apiUrl, authHeaders } from "../api";

/** Each segment encoded, the slashes kept: the path is a key, not a word. */
function mediaUrl(bucket: "audio" | "scenes", path: string): string {
  return apiUrl(`/media/${bucket}/${path.split("/").map(encodeURIComponent).join("/")}`);
}

/** URL for a clip that has been synthesised. Null means "no audio yet" — the
 *  screen shows the text instead, which is how the app works until the TTS
 *  step has run. */
export function clipUrl(audioPath: string | null): string | null {
  if (!audioPath) return null;
  return mediaUrl("audio", audioPath);
}

/** URL for a scene illustration, on exactly the same terms: null is the
 *  ordinary case, because items are published long before their artwork. */
export function sceneUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return mediaUrl("scenes", imagePath);
}

/** A clip as the player asks for it. On the web the address alone, as it
 *  always was (the cookie goes with it); on a native build the address and
 *  the sign-in token, since there is no cookie (lib/api.ts). */
export function audioSource(url: string): string | { uri: string; headers: Record<string, string> } {
  const headers = authHeaders();
  return Object.keys(headers).length ? { uri: url, headers } : url;
}

/** A picture as an <Image> asks for it, on the same terms as `audioSource`. */
export function imageSource(url: string): { uri: string; headers?: Record<string, string> } {
  const headers = authHeaders();
  return Object.keys(headers).length ? { uri: url, headers } : { uri: url };
}
