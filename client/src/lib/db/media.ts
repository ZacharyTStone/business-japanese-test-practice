/**
 * Where a clip or a picture is served from: the Worker's `/media/` route,
 * which reads R2 (client/worker/media.ts), looked up by the path the database
 * holds. Null is the ordinary answer — no audio yet, no picture yet — and each
 * screen shows the text instead.
 */
import { apiUrl } from "../api";

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
