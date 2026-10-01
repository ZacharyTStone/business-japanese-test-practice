/**
 * The clips and the pictures, served from R2 at `/media/<bucket>/<path>`.
 *
 * `<path>` is exactly what the database holds (`audio_clips.audio_path`,
 * `scenes.image_path`), so nothing stored changes. The R2 key is
 * `<bucket>/<path>` — `audio/openai/ab/ab12….wav`.
 *
 * Read-through while the pipeline still uploads to Supabase Storage: a key R2
 * does not have yet is fetched from the Supabase public bucket of the same
 * name, stored in R2 under the same key, and served. So the library moves over
 * as it is listened to, and `bjt synth --upload` / `bjt scenes --upload` need
 * not change on the day the app does. Once the pipeline writes to R2 itself,
 * `SUPABASE_URL` is unset and the fallback is gone; a miss is then a 404.
 *
 * A clip's id hashes its text and voice, and a live clip is never re-made, so
 * a clip is served as immutable. A picture can be redrawn under its own name
 * (`bjt scenes --force`), so it is cached for a day.
 */

const BUCKETS = new Set(["audio", "scenes"]);

/** One path segment: what the pipeline writes (provider, hash prefix, id,
 *  extension) and nothing that could climb out of the bucket. */
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/;

export type MediaKey = { bucket: string; path: string; key: string };

/** The bucket and path a `/media/...` URL names, or null if it names nothing
 *  servable. */
export function parseMediaPath(pathname: string): MediaKey | null {
  const parts = pathname.split("/").filter((p) => p !== "");
  if (parts.length < 3 || parts.length > 6 || parts[0] !== "media") return null;
  const bucket = parts[1];
  if (!BUCKETS.has(bucket)) return null;
  const segments = parts.slice(2).map((s) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return "";
    }
  });
  if (!segments.every((s) => SEGMENT.test(s) && !s.includes(".."))) return null;
  const path = segments.join("/");
  return { bucket, path, key: `${bucket}/${path}` };
}

export function cacheControl(bucket: string): string {
  return bucket === "audio" ? "public, max-age=31536000, immutable" : "public, max-age=86400";
}

const TYPES: Record<string, string> = {
  wav: "audio/wav",
  mp3: "audio/mpeg",
  m4a: "audio/mp4",
  ogg: "audio/ogg",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
};

export function contentTypeFor(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  return TYPES[ext] ?? "application/octet-stream";
}

export type MediaEnv = { MEDIA: R2Bucket; SUPABASE_URL?: string };

export async function serveMedia(request: Request, env: MediaEnv, ctx: ExecutionContext): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") {
    return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
  }
  const media = parseMediaPath(new URL(request.url).pathname);
  if (!media) return new Response("not found", { status: 404 });

  const headers = new Headers({ "cache-control": cacheControl(media.bucket) });
  const stored = await env.MEDIA.get(media.key);
  if (stored) {
    stored.writeHttpMetadata(headers);
    if (!headers.has("content-type")) headers.set("content-type", contentTypeFor(media.path));
    headers.set("etag", stored.httpEtag);
    return new Response(request.method === "HEAD" ? null : stored.body, { headers });
  }

  // Not in R2 yet: the Supabase public bucket, while there is one.
  const origin = (env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (!origin) return new Response("not found", { status: 404 });
  const upstream = await fetch(`${origin}/storage/v1/object/public/${media.bucket}/${media.path}`);
  if (!upstream.ok) return new Response("not found", { status: upstream.status === 404 || upstream.status === 400 ? 404 : 502 });

  const body = await upstream.arrayBuffer();
  const contentType = upstream.headers.get("content-type") || contentTypeFor(media.path);
  // Kept for next time without making this listener wait for the write.
  ctx.waitUntil(env.MEDIA.put(media.key, body, { httpMetadata: { contentType } }));
  headers.set("content-type", contentType);
  return new Response(request.method === "HEAD" ? null : body, { headers });
}
