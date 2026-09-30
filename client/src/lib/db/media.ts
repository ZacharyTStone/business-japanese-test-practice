/**
 * Where a clip or a picture is served from. Both are public objects in
 * storage, looked up by the path the database holds; null is the ordinary
 * answer — no audio yet, no picture yet — and each screen shows the text
 * instead.
 */
import { supabase } from "../supabase";

/** Public URL for a clip that has been synthesised. Null means "no audio yet" —
 *  the screen shows the text instead, which is how the app works until the TTS
 *  step has run. */
export function clipUrl(audioPath: string | null): string | null {
  if (!audioPath) return null;
  return supabase.storage.from("audio").getPublicUrl(audioPath).data.publicUrl;
}

/** Public URL for a scene illustration, on exactly the same terms: null is the
 *  ordinary case, because items are published long before their artwork. */
export function sceneUrl(imagePath: string | null): string | null {
  if (!imagePath) return null;
  return supabase.storage.from("scenes").getPublicUrl(imagePath).data.publicUrl;
}
